import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type {
  DeploymentSpec,
  RollbackOptions,
  RollbackResult,
  StateRevision,
  UpgradeOptions,
  UpgradeResult,
} from './types.js';
import { DEFAULT_MANIFEST } from './manifest.js';
import { loadState, saveState } from './state.js';
import { dumpDeploymentSpecYaml, parseSimpleYaml } from './yaml.js';
import { generateComposeYaml } from './generators/compose.js';
import { generateCaddyfile } from './generators/caddy.js';
import { generateCoturnConfig } from './generators/coturn.js';
import { loadOrCreateSecrets } from './generators/secrets.js';
import { runDeploymentVerification } from './verify.js';
import { applyDeployment } from './apply.js';
import { calculatePlan } from './plan.js';
import { checkDockerSocket } from './host.js';
import { calculateContentHash } from './generators/header.js';

export async function rollbackDeployment(options: RollbackOptions = {}): Promise<RollbackResult> {
  const workingDir = options.workingDir || process.cwd();
  const manifest = options.manifest || DEFAULT_MANIFEST;
  const state = loadState(workingDir);

  if (state.revisions.length === 0) {
    throw new Error('No recorded revisions found to roll back.');
  }

  let targetRev: StateRevision | undefined;
  if (options.toRevision !== undefined) {
    targetRev = state.revisions.find((r) => r.revision === options.toRevision);
    if (!targetRev) {
      throw new Error(`Revision #${options.toRevision} not found in state history.`);
    }
  } else {
    // Default to previous revision
    if (state.revisions.length < 2) {
      throw new Error('No previous revision found in history to roll back to.');
    }
    targetRev = state.revisions[state.revisions.length - 2];
  }

  const restoredSpec = targetRev.spec;
  const specPath = join(workingDir, 'deployment.yaml');
  const yamlContent = dumpDeploymentSpecYaml(restoredSpec);
  writeFileSync(specPath, yamlContent, 'utf8');

  // Generate artifacts with the restored spec and manifest/digests
  const secretsPath = join(workingDir, 'secrets.env');
  loadOrCreateSecrets(secretsPath, Boolean(restoredSpec.turn?.enabled));

  const composeContent = generateComposeYaml(restoredSpec, manifest);
  writeFileSync(join(workingDir, 'compose.yaml'), composeContent, 'utf8');

  if (
    restoredSpec.tls.mode === 'acme' ||
    restoredSpec.tls.mode === 'acme-dns' ||
    restoredSpec.tls.mode === 'provided' ||
    restoredSpec.tls.mode === 'self-signed'
  ) {
    const caddyContent = generateCaddyfile(restoredSpec);
    writeFileSync(join(workingDir, 'Caddyfile'), caddyContent, 'utf8');
  }

  if (restoredSpec.turn?.enabled) {
    const coturnContent = generateCoturnConfig(restoredSpec);
    writeFileSync(join(workingDir, 'turnserver.conf'), coturnContent, 'utf8');
  }

  // Execute docker compose up
  const hasDockerSocket = checkDockerSocket().valid;
  const shouldExec = options.executeDocker !== undefined ? options.executeDocker : hasDockerSocket;

  if (shouldExec) {
    try {
      execSync('docker compose up -d --remove-orphans', {
        cwd: workingDir,
        stdio: 'pipe',
      });
    } catch (err) {
      console.warn(`Docker compose execution warning during rollback: ${(err as Error).message}`);
    }
  }

  // Record restoration as new state revision
  const nextRevNum = (state.currentRevision || 0) + 1;
  const specHash = calculateContentHash(JSON.stringify(restoredSpec));
  const newRev = {
    revision: nextRevNum,
    timestamp: new Date().toISOString(),
    installerVersion: targetRev.installerVersion,
    specHash,
    spec: restoredSpec,
    resolvedDigests: targetRev.resolvedDigests,
    verified: false,
  };

  state.revisions.push(newRev);
  state.currentRevision = nextRevNum;
  saveState(state, workingDir);

  // Run verification
  const verifyReport = await runDeploymentVerification({
    workingDir,
    spec: restoredSpec,
  });

  newRev.verified = verifyReport.valid;
  saveState(state, workingDir);

  return {
    success: verifyReport.valid,
    restoredRevision: newRev,
    verifyReport,
  };
}

export async function upgradeDeployment(options: UpgradeOptions = {}): Promise<UpgradeResult> {
  const workingDir = options.workingDir || process.cwd();
  const manifest = options.manifest || DEFAULT_MANIFEST;
  const specPath = join(workingDir, 'deployment.yaml');

  if (!existsSync(specPath)) {
    throw new Error(`Deployment specification not found at '${specPath}'.`);
  }

  const rawYaml = readFileSync(specPath, 'utf8');
  const currentSpec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
  const state = loadState(workingDir);
  const currentRevision =
    state.revisions.length > 0 ? state.revisions[state.revisions.length - 1] : undefined;

  const currentVersion = currentRevision?.installerVersion || currentSpec.version || '0.1.0';
  const targetVersion = manifest.version;

  // 1. Check version order / prevent downgrade (FR-UPG-07)
  const isDowngrade = compareSemver(targetVersion, currentVersion) < 0;
  if (isDowngrade) {
    throw new Error(
      `Downgrade from v${currentVersion} to v${targetVersion} is refused. Use 'sdctl rollback' to restore an earlier revision.`,
    );
  }

  // 2. Check minUpgradeFrom (FR-UPG-02)
  if (manifest.minUpgradeFrom) {
    if (compareSemver(currentVersion, manifest.minUpgradeFrom) < 0) {
      throw new Error(
        `Direct upgrade from v${currentVersion} to v${targetVersion} is not supported. Manifest requires minimum upgrade version v${manifest.minUpgradeFrom}. Upgrade incrementally first.`,
      );
    }
  }

  // 3. Backup deployment.yaml (FR-UPG-03)
  const backupPath = join(workingDir, 'deployment.yaml.bak');
  copyFileSync(specPath, backupPath);

  // 4. Migrate deployment.yaml schema if needed
  const migratedSpec: DeploymentSpec = {
    ...currentSpec,
    version: targetVersion,
  };
  const updatedYaml = dumpDeploymentSpecYaml(migratedSpec);
  writeFileSync(specPath, updatedYaml, 'utf8');

  // 5. Detect changes to RELAY or ICE_SERVERS for override warnings (FR-UPG-06)
  const overrideWarnings: string[] = [];
  const currentRelay = currentSpec.tls.relayHost || currentSpec.tls.domain || 'localhost';
  const migratedRelay = migratedSpec.tls.relayHost || migratedSpec.tls.domain || 'localhost';
  if (currentRelay !== migratedRelay) {
    overrideWarnings.push(
      `Relay endpoint changed from '${currentRelay}' to '${migratedRelay}'. Users who manually configured browser relay overrides will not automatically receive this change.`,
    );
  }

  if (currentSpec.iceServers !== migratedSpec.iceServers) {
    overrideWarnings.push(
      'ICE server configuration changed. Users with saved browser ICE overrides will retain their custom ICE settings.',
    );
  }

  // 6. Calculate plan
  const plan = calculatePlan({
    desiredSpec: migratedSpec,
    manifest,
    workingDir,
  });

  // 7. Apply deployment with autoRollback enabled by default for upgrade (FR-UPG-04)
  const applyResult = await applyDeployment({
    workingDir,
    spec: migratedSpec,
    manifest,
    force: options.force,
    autoRollback: options.autoRollback !== false,
    editorUrl: options.editorUrl,
    relayUrl: options.relayUrl,
    executeDocker: options.executeDocker,
  });

  return {
    success: applyResult.success,
    oldVersion: currentVersion,
    newVersion: targetVersion,
    appliedRevision: applyResult.revision,
    backupPath,
    overrideWarnings: overrideWarnings.length > 0 ? overrideWarnings : undefined,
    plan,
    verifyReport: applyResult.verifyReport,
    rolledBack: applyResult.rolledBack,
    rollbackReason: applyResult.rollbackReason,
  };
}

function compareSemver(v1: string, v2: string): number {
  const clean1 = v1
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const clean2 = v2
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(clean1.length, clean2.length); i++) {
    const num1 = clean1[i] || 0;
    const num2 = clean2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}
