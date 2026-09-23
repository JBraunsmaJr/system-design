import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { ApplyOptions, ApplyResult, DeploymentSpec, ReleaseManifest } from './types.js';
import { DEFAULT_MANIFEST } from './manifest.js';
import { validateDeploymentSpec } from './schema.js';
import { parseSimpleYaml } from './yaml.js';
import { generateComposeYaml } from './generators/compose.js';
import { generateCaddyfile } from './generators/caddy.js';
import { generateCoturnConfig } from './generators/coturn.js';
import { loadOrCreateSecrets } from './generators/secrets.js';
import { isManuallyModified } from './generators/header.js';
import { runPreflightChecks } from './preflight.js';
import { runDeploymentVerification } from './verify.js';
import { calculatePlan } from './plan.js';
import { recordAppliedRevision, getPreviousRevision } from './state.js';
import { checkDockerSocket } from './host.js';
import { rollbackDeployment } from './lifecycle.js';

export async function applyDeployment(options: ApplyOptions = {}): Promise<ApplyResult> {
  const workingDir = options.workingDir || process.cwd();
  const manifest: ReleaseManifest = options.manifest || DEFAULT_MANIFEST;

  // 1. Load and validate deployment spec
  let spec = options.spec;
  const specPath = join(workingDir, 'deployment.yaml');
  if (!spec) {
    if (!existsSync(specPath)) {
      throw new Error(
        `Deployment specification not found at '${specPath}'. Run 'sdctl init' first.`,
      );
    }
    const rawYaml = readFileSync(specPath, 'utf8');
    spec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
  }

  const validation = validateDeploymentSpec(spec);
  if (!validation.valid) {
    const msgs = validation.errors
      .map((e) => `${e.path}: ${e.message} (${e.suggestedFix})`)
      .join('; ');
    throw new Error(`Invalid deployment.yaml specification: ${msgs}`);
  }

  // 2. Preflight checks (FR-PRE-04)
  const preflightReport = runPreflightChecks({
    workingDir,
    spec,
    manifest,
    force: options.force,
  });

  if (!preflightReport.valid) {
    const failedIds = preflightReport.checks
      .filter((c) => c.status === 'fail')
      .map((c) => c.id)
      .join(', ');
    throw new Error(
      `Preflight check failed [${failedIds}]. Use --force with check IDs or resolve the issues before applying.`,
    );
  }

  // 3. Calculate plan difference (FR-APPLY-01)
  const plan = calculatePlan({
    desiredSpec: spec,
    manifest,
    workingDir,
  });

  // 4. Generate artifacts (FR-APPLY-02, FR-CFG-03, FR-CFG-05)
  const secretsPath = join(workingDir, 'secrets.env');
  const extraSecrets: Record<string, string> = {};
  if (spec.tls.dnsProvider?.apiToken) {
    const tokenVar = spec.tls.dnsProvider.apiTokenEnvVar || 'CLOUDFLARE_API_TOKEN';
    extraSecrets[tokenVar] = spec.tls.dnsProvider.apiToken;
  }
  loadOrCreateSecrets(secretsPath, Boolean(spec.turn?.enabled), extraSecrets);

  const composeContent = generateComposeYaml(spec, manifest);
  const composePath = join(workingDir, 'compose.yaml');
  if (existsSync(composePath)) {
    const existing = readFileSync(composePath, 'utf8');
    if (isManuallyModified(existing, composeContent)) {
      console.warn('Warning: compose.yaml had manual edits which will be overwritten.');
    }
  }
  writeFileSync(composePath, composeContent, 'utf8');

  if (spec.tls.mode === 'acme' || spec.tls.mode === 'acme-dns' || spec.tls.mode === 'provided') {
    const caddyContent = generateCaddyfile(spec);
    const caddyPath = join(workingDir, 'Caddyfile');
    if (existsSync(caddyPath)) {
      const existing = readFileSync(caddyPath, 'utf8');
      if (isManuallyModified(existing, caddyContent)) {
        console.warn('Warning: Caddyfile had manual edits which will be overwritten.');
      }
    }
    writeFileSync(caddyPath, caddyContent, 'utf8');
  }

  if (spec.turn?.enabled) {
    const coturnContent = generateCoturnConfig(spec);
    const coturnPath = join(workingDir, 'turnserver.conf');
    if (existsSync(coturnPath)) {
      const existing = readFileSync(coturnPath, 'utf8');
      if (isManuallyModified(existing, coturnContent)) {
        console.warn('Warning: turnserver.conf had manual edits which will be overwritten.');
      }
    }
    writeFileSync(coturnPath, coturnContent, 'utf8');
  }

  // 5. Execute Docker Compose up if enabled / socket available
  const hasDockerSocket = checkDockerSocket().valid;
  const shouldExec = options.executeDocker !== undefined ? options.executeDocker : hasDockerSocket;

  if (shouldExec) {
    try {
      execSync('docker compose up -d --remove-orphans', {
        cwd: workingDir,
        stdio: 'pipe',
      });
    } catch (err) {
      console.warn(`Docker compose execution warning: ${(err as Error).message}`);
    }
  }

  // 6. Record applied revision in state (FR-CFG-04)
  const revision = recordAppliedRevision(spec, workingDir, manifest.version, false);

  // 7. Diagnostics URL & Test Code generation (FR-APPLY-07, FR-DIAG)
  const diagHost = spec.tls.editorHost || spec.tls.domain || 'localhost';
  const diagProto = spec.tls.mode === 'none' ? 'http://' : 'https://';
  const diagPort = spec.tls.mode === 'none' || spec.tls.mode === 'external' ? ':8080' : '';
  const diagnosticsUrl = `${diagProto}${diagHost}${diagPort}/diag.html`;
  const testCode = `DIAG-${Date.now().toString(36).toUpperCase()}`;

  // 8. Post-apply verification (FR-APPLY-04)
  let verifyReport = undefined;
  let rolledBack = false;
  let rollbackReason = undefined;

  if (!options.skipVerify) {
    verifyReport = await runDeploymentVerification({
      workingDir,
      spec,
      editorUrl: options.editorUrl,
      relayUrl: options.relayUrl,
    });

    revision.verified = verifyReport.valid;
    revision.verificationResults = verifyReport.checks.map((c) => ({
      id: c.id,
      status: c.status === 'fail' ? 'fail' : c.status === 'warn' ? 'warn' : 'pass',
      message: c.observed,
    }));

    // Check failure and auto-rollback (FR-APPLY-05)
    if (!verifyReport.valid) {
      const prevRev = getPreviousRevision(workingDir);
      if (prevRev && prevRev.verified) {
        if (options.autoRollback) {
          try {
            await rollbackDeployment({
              workingDir,
              toRevision: prevRev.revision,
              manifest,
              executeDocker: shouldExec,
            });
            rolledBack = true;
            rollbackReason = `Post-apply verification failed. Automatically rolled back to revision #${prevRev.revision}.`;
          } catch (rbErr) {
            rollbackReason = `Post-apply verification failed and auto-rollback failed: ${(rbErr as Error).message}`;
          }
        } else {
          rollbackReason = `Post-apply verification failed. A previous healthy revision (#${prevRev.revision}) is available. Run 'sdctl rollback' to restore.`;
        }
      }
    }
  }

  return {
    success: verifyReport ? verifyReport.valid && !rolledBack : true,
    revision,
    plan,
    verifyReport,
    diagnosticsUrl,
    testCode,
    rolledBack,
    rollbackReason,
  };
}
