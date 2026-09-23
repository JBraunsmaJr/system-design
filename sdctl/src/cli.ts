import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_MANIFEST } from './manifest.js';
import { validateDeploymentSpec } from './schema.js';
import { dumpDeploymentSpecYaml, parseSimpleYaml } from './yaml.js';
import { generateComposeYaml } from './generators/compose.js';
import { generateCaddyfile } from './generators/caddy.js';
import { generateCoturnConfig } from './generators/coturn.js';
import { loadOrCreateSecrets } from './generators/secrets.js';
import { isManuallyModified } from './generators/header.js';
import { runInteractiveWizard, loadAnswersFile, buildDeploymentSpec } from './wizard.js';
import { runPreflightChecks } from './preflight.js';
import { runDeploymentVerification } from './verify.js';
import { calculatePlan, formatPlanText } from './plan.js';
import { applyDeployment } from './apply.js';
import { upgradeDeployment, rollbackDeployment } from './lifecycle.js';
import { loadState } from './state.js';
import type { DeploymentSpec, CheckResult } from './types.js';

export interface CliOptions {
  command: string;
  args: string[];
  flags: {
    version?: boolean;
    help?: boolean;
    registry?: string;
    answers?: string;
    yes?: boolean;
    output?: 'json' | 'text';
    force?: string[] | boolean;
    spec?: string;
    all?: boolean;
    awaitClients?: number;
    timeoutSec?: number;
    editorUrl?: string;
    relayUrl?: string;
    autoRollback?: boolean;
    skipVerify?: boolean;
    to?: number;
  };
}

export function parseArgs(argv: string[]): CliOptions {
  const flags: CliOptions['flags'] = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--yes' || arg === '-y') {
      flags.yes = true;
    } else if (arg === '--all') {
      flags.all = true;
    } else if (arg === '--auto-rollback') {
      flags.autoRollback = true;
    } else if (arg === '--skip-verify') {
      flags.skipVerify = true;
    } else if (arg === '--to' && i + 1 < argv.length) {
      flags.to = parseInt(argv[++i], 10);
    } else if (arg.startsWith('--to=')) {
      flags.to = parseInt(arg.slice('--to='.length), 10);
    } else if (arg === '--force') {
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags.force = argv[++i].split(',').map((s) => s.trim());
      } else {
        flags.force = true;
      }
    } else if (arg.startsWith('--force=')) {
      flags.force = arg
        .slice('--force='.length)
        .split(',')
        .map((s) => s.trim());
    } else if (arg === '--registry' && i + 1 < argv.length) {
      flags.registry = argv[++i];
    } else if (arg.startsWith('--registry=')) {
      flags.registry = arg.slice('--registry='.length);
    } else if (arg === '--answers' && i + 1 < argv.length) {
      flags.answers = argv[++i];
    } else if (arg.startsWith('--answers=')) {
      flags.answers = arg.slice('--answers='.length);
    } else if (arg === '--output' && i + 1 < argv.length) {
      flags.output = argv[++i] as 'json' | 'text';
    } else if (arg.startsWith('--output=')) {
      flags.output = arg.slice('--output='.length) as 'json' | 'text';
    } else if (arg === '--spec' && i + 1 < argv.length) {
      flags.spec = argv[++i];
    } else if (arg.startsWith('--spec=')) {
      flags.spec = arg.slice('--spec='.length);
    } else if (arg === '--await-clients' && i + 1 < argv.length) {
      flags.awaitClients = parseInt(argv[++i], 10);
    } else if (arg.startsWith('--await-clients=')) {
      flags.awaitClients = parseInt(arg.slice('--await-clients='.length), 10);
    } else if (arg === '--timeout-sec' && i + 1 < argv.length) {
      flags.timeoutSec = parseInt(argv[++i], 10);
    } else if (arg.startsWith('--timeout-sec=')) {
      flags.timeoutSec = parseInt(arg.slice('--timeout-sec='.length), 10);
    } else if (arg === '--editor-url' && i + 1 < argv.length) {
      flags.editorUrl = argv[++i];
    } else if (arg.startsWith('--editor-url=')) {
      flags.editorUrl = arg.slice('--editor-url='.length);
    } else if (arg === '--relay-url' && i + 1 < argv.length) {
      flags.relayUrl = argv[++i];
    } else if (arg.startsWith('--relay-url=')) {
      flags.relayUrl = arg.slice('--relay-url='.length);
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  const command = positional[0] || '';
  const args = positional.slice(1);

  return { command, args, flags };
}

function printCheckTable(checks: CheckResult[]) {
  for (const c of checks) {
    const symbol =
      c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : c.status === 'warn' ? '!' : '-';
    const tag = `[${c.status.toUpperCase()}]`.padEnd(8);
    const layerStr = c.layer ? `L${c.layer} ` : '';
    console.log(` ${symbol} ${tag} ${layerStr}${c.id}: ${c.name}`);
    console.log(`     Observed: ${c.observed}`);
    if (c.status === 'fail' || c.status === 'warn') {
      if (c.cause) console.log(`     Cause:    ${c.cause}`);
      if (c.remediation) console.log(`     Fix:      ${c.remediation}`);
    }
  }
}

export async function runCli(argv: string[], workingDir: string = process.cwd()): Promise<number> {
  const { command, flags } = parseArgs(argv);

  if (flags.version) {
    if (flags.output === 'json') {
      console.log(JSON.stringify(DEFAULT_MANIFEST, null, 2));
    } else {
      console.log(
        `sdctl version ${DEFAULT_MANIFEST.version} (released ${DEFAULT_MANIFEST.releaseDate})`,
      );
      console.log('\nRelease Manifest:');
      for (const [comp, img] of Object.entries(DEFAULT_MANIFEST.images)) {
        console.log(`  - ${comp}: ${img.image}@${img.digest}`);
      }
    }
    return 0;
  }

  if (flags.help || (!command && !flags.version)) {
    console.log(`
sdctl - System Design Editor Installer & Operations Tool

Usage:
  sdctl <command> [flags]

Commands:
  init       Initialize a new deployment interactively or from an answers file
  validate   Validate deployment.yaml against specification schema
  preflight  Run non-destructive environment, image, and certificate checks
  generate   Generate all derived configuration files (compose.yaml, Caddyfile, turnserver.conf)
  plan       Preview configuration and container diff before apply
  apply      Render configs, pull digests, launch stack via Compose, and verify
  verify     Run layered deployment verification against live services
  upgrade    Upgrade deployment to the release manifest carried by the installer
  rollback   Restore configuration and digests from a previous known-good revision
  status     Display deployment state and historical revisions
  version    Show version and carried release manifest

Flags:
  --version, -v           Print version information and release manifest
  --help, -h              Print this help message
  --registry <prefix>     Override container registry prefix across all components
  --answers <file>        Provide answers file for non-interactive initialization
  --yes, -y               Non-interactive mode; accept defaults without prompting
  --output json|text      Output format (default: text)
  --spec <file>           Path to deployment spec (default: ./deployment.yaml)
  --force [ids]           Bypass specific failing check IDs in preflight/apply
  --all                   Run all verification checks regardless of early layer failure
  --auto-rollback         Automatically revert to prior healthy revision on apply/upgrade failure
  --skip-verify           Skip post-apply live verification suite
  --to <revision>         Target revision number for rollback
  --await-clients <N>     Wait for N browser diagnostic reports via relay
  --timeout-sec <N>       Timeout in seconds for client diagnostics collection
  --editor-url <url>      Override editor URL during verification
  --relay-url <url>       Override relay URL during verification
`);
    return 0;
  }

  const specPath = flags.spec || join(workingDir, 'deployment.yaml');

  if (command === 'init') {
    let spec: DeploymentSpec;

    if (flags.answers) {
      const answers = loadAnswersFile(flags.answers);
      spec = buildDeploymentSpec(answers);
    } else if (flags.yes) {
      spec = buildDeploymentSpec({ mode: 'public', topology: 'lan', tlsMode: 'none' });
    } else {
      spec = await runInteractiveWizard();
    }

    if (flags.registry) {
      spec.registry = { prefix: flags.registry };
    }

    const validation = validateDeploymentSpec(spec);
    if (!validation.valid) {
      if (flags.output === 'json') {
        console.error(JSON.stringify(validation, null, 2));
      } else {
        console.error('Configuration validation failed during init:');
        for (const err of validation.errors) {
          console.error(`  - [${err.path}] ${err.message}`);
          console.error(`    Suggested fix: ${err.suggestedFix}`);
        }
      }
      return 1;
    }

    const yamlStr = dumpDeploymentSpecYaml(spec);
    writeFileSync(specPath, yamlStr, 'utf8');

    // Save secrets if needed (e.g. Turn credentials or DNS provider API token)
    const secretsPath = join(workingDir, 'secrets.env');
    const extraSecrets: Record<string, string> = {};
    if (spec.tls.dnsProvider?.apiToken) {
      const tokenVar = spec.tls.dnsProvider.apiTokenEnvVar || 'CLOUDFLARE_API_TOKEN';
      extraSecrets[tokenVar] = spec.tls.dnsProvider.apiToken;
    }
    if (spec.turn?.enabled || Object.keys(extraSecrets).length > 0) {
      loadOrCreateSecrets(secretsPath, Boolean(spec.turn?.enabled), extraSecrets);
    }

    // Run Preflight after init (FR-INIT-06)
    const preflight = runPreflightChecks({ workingDir, spec });

    if (flags.output === 'json') {
      console.log(JSON.stringify({ status: 'success', path: specPath, spec, preflight }, null, 2));
    } else {
      console.log(`\n✓ Written deployment specification to ${specPath}`);
      console.log('\n--- Preflight Summary ---');
      printCheckTable(preflight.checks);
      if (!preflight.valid) {
        console.warn(
          '\nWarning: Some preflight checks failed. Review issues before running `sdctl apply`.',
        );
      } else {
        console.log(
          '\n✓ Preflight validation passed. You may now run `sdctl plan` or `sdctl apply`.',
        );
      }
    }
    return 0;
  }

  if (command === 'validate') {
    if (!existsSync(specPath)) {
      console.error(`Error: Deployment spec not found at ${specPath}`);
      return 1;
    }
    let validation;
    try {
      const rawYaml = readFileSync(specPath, 'utf8');
      const spec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
      validation = validateDeploymentSpec(spec);
    } catch (err) {
      console.error(`Error reading ${specPath}: ${(err as Error).message}`);
      return 1;
    }

    if (flags.output === 'json') {
      console.log(JSON.stringify(validation, null, 2));
      return validation.valid ? 0 : 1;
    }

    if (!validation.valid) {
      console.error(`\nValidation failed for ${specPath}:`);
      for (const err of validation.errors) {
        console.error(`  - Path: "${err.path}"`);
        console.error(`    Error: ${err.message}`);
        console.error(`    Suggested fix: ${err.suggestedFix}\n`);
      }
      return 1;
    }

    console.log(`\n✓ Deployment specification ${specPath} is valid.`);
    return 0;
  }

  if (command === 'preflight') {
    let spec: DeploymentSpec | undefined;
    if (existsSync(specPath)) {
      try {
        const rawYaml = readFileSync(specPath, 'utf8');
        spec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
      } catch {
        // Handled in preflight
      }
    }

    const forceList = Array.isArray(flags.force)
      ? flags.force
      : flags.force === true
        ? ['PRE-HOST-SOCK', 'PRE-HOST-MOUNT', 'PRE-CFG-SPEC', 'PRE-REG-DIGESTS', 'PRE-TLS-CERTS']
        : [];

    const report = runPreflightChecks({
      workingDir,
      spec,
      force: forceList,
    });

    if (flags.output === 'json') {
      console.log(JSON.stringify(report, null, 2));
      return report.valid ? 0 : 1;
    }

    console.log('\n================ sdctl Preflight Checks ================');
    printCheckTable(report.checks);
    console.log('--------------------------------------------------------');
    console.log(
      `Summary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warned} warnings, ${report.summary.skipped} skipped.`,
    );

    if (report.valid) {
      console.log('✓ Preflight passed successfully.\n');
      return 0;
    } else {
      console.error(
        '✗ Preflight failed. Resolve the errors above or use --force with check IDs to bypass.\n',
      );
      return 1;
    }
  }

  if (command === 'generate') {
    if (!existsSync(specPath)) {
      console.error(`Error: Deployment spec not found at ${specPath}`);
      return 1;
    }
    const rawYaml = readFileSync(specPath, 'utf8');
    const spec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
    const validation = validateDeploymentSpec(spec);
    if (!validation.valid) {
      console.error('Cannot generate artifacts from invalid deployment.yaml');
      return 1;
    }

    // Check secrets
    const secretsPath = join(workingDir, 'secrets.env');
    const extraSecrets: Record<string, string> = {};
    if (spec.tls.dnsProvider?.apiToken) {
      const tokenVar = spec.tls.dnsProvider.apiTokenEnvVar || 'CLOUDFLARE_API_TOKEN';
      extraSecrets[tokenVar] = spec.tls.dnsProvider.apiToken;
    }
    loadOrCreateSecrets(secretsPath, Boolean(spec.turn?.enabled), extraSecrets);

    // Compose yaml
    const composeContent = generateComposeYaml(spec, DEFAULT_MANIFEST);
    const composePath = join(workingDir, 'compose.yaml');
    if (existsSync(composePath)) {
      const existing = readFileSync(composePath, 'utf8');
      if (isManuallyModified(existing, composeContent)) {
        console.warn('Warning: compose.yaml had manual edits which will be overwritten.');
      }
    }
    writeFileSync(composePath, composeContent, 'utf8');

    // Caddyfile if proxy needed
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

    // Coturn config if turn enabled
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

    if (flags.output === 'json') {
      console.log(JSON.stringify({ status: 'generated', path: workingDir }, null, 2));
    } else {
      console.log(`\n✓ Generated deployment artifacts in ${workingDir}`);
      console.log('  - compose.yaml');
      if (
        spec.tls.mode === 'acme' ||
        spec.tls.mode === 'acme-dns' ||
        spec.tls.mode === 'provided'
      ) {
        console.log('  - Caddyfile');
      }
      if (spec.turn?.enabled) console.log('  - turnserver.conf');
      console.log('  - secrets.env');
    }
    return 0;
  }

  if (command === 'plan') {
    const plan = calculatePlan({ workingDir });

    if (flags.output === 'json') {
      console.log(JSON.stringify(plan, null, 2));
      return 0;
    }

    console.log('\n================ sdctl Deployment Plan ================');
    console.log(formatPlanText(plan));
    console.log('=======================================================\n');
    return 0;
  }

  if (command === 'apply') {
    const forceList = Array.isArray(flags.force)
      ? flags.force
      : flags.force === true
        ? ['PRE-HOST-SOCK', 'PRE-HOST-MOUNT', 'PRE-CFG-SPEC', 'PRE-REG-DIGESTS', 'PRE-TLS-CERTS']
        : [];

    try {
      const result = await applyDeployment({
        workingDir,
        force: forceList,
        autoRollback: flags.autoRollback,
        skipVerify: flags.skipVerify,
        editorUrl: flags.editorUrl,
        relayUrl: flags.relayUrl,
      });

      if (flags.output === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return result.success ? 0 : 1;
      }

      console.log('\n================ sdctl Apply ================');
      console.log(`✓ Applied revision #${result.revision.revision}`);
      console.log(`  Spec Hash: ${result.revision.specHash}`);
      console.log(`  Diagnostics URL: ${result.diagnosticsUrl}`);
      console.log(`  Client Test Code: ${result.testCode}`);

      if (result.plan && result.plan.hasChanges) {
        console.log('\n--- Applied Plan Changes ---');
        console.log(formatPlanText(result.plan));
      }

      if (result.verifyReport) {
        console.log('\n--- Post-Apply Verification ---');
        printCheckTable(result.verifyReport.checks);
      }

      if (result.rolledBack) {
        console.error(`\n✗ ${result.rollbackReason}`);
        return 1;
      }

      if (!result.success) {
        console.error('\n✗ Post-apply verification failed.');
        if (result.rollbackReason) {
          console.warn(`  ${result.rollbackReason}`);
        }
        return 1;
      }

      console.log('\n✓ Deployment applied and verified successfully.\n');
      return 0;
    } catch (err) {
      console.error(`\n✗ Apply failed: ${(err as Error).message}`);
      return 1;
    }
  }

  if (command === 'upgrade') {
    const forceList = Array.isArray(flags.force)
      ? flags.force
      : flags.force === true
        ? ['PRE-HOST-SOCK', 'PRE-HOST-MOUNT', 'PRE-CFG-SPEC', 'PRE-REG-DIGESTS', 'PRE-TLS-CERTS']
        : [];

    try {
      const result = await upgradeDeployment({
        workingDir,
        force: forceList,
        autoRollback: flags.autoRollback !== false,
        editorUrl: flags.editorUrl,
        relayUrl: flags.relayUrl,
      });

      if (flags.output === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return result.success ? 0 : 1;
      }

      console.log('\n================ sdctl Upgrade ================');
      console.log(`✓ Upgraded from v${result.oldVersion} to v${result.newVersion}`);
      if (result.backupPath) {
        console.log(`  Backup saved: ${result.backupPath}`);
      }

      if (result.overrideWarnings && result.overrideWarnings.length > 0) {
        console.log('\n--- Important Operator Warnings ---');
        for (const w of result.overrideWarnings) {
          console.warn(`  ! ${w}`);
        }
      }

      if (result.plan && result.plan.hasChanges) {
        console.log('\n--- Upgrade Plan Changes ---');
        console.log(formatPlanText(result.plan));
      }

      if (result.verifyReport) {
        console.log('\n--- Post-Upgrade Verification ---');
        printCheckTable(result.verifyReport.checks);
      }

      if (result.rolledBack) {
        console.error(`\n✗ ${result.rollbackReason}`);
        return 1;
      }

      if (!result.success) {
        console.error('\n✗ Post-upgrade verification failed.');
        return 1;
      }

      console.log('\n✓ Upgrade complete and verified.\n');
      return 0;
    } catch (err) {
      console.error(`\n✗ Upgrade failed: ${(err as Error).message}`);
      return 1;
    }
  }

  if (command === 'rollback') {
    try {
      const result = await rollbackDeployment({
        workingDir,
        toRevision: flags.to,
      });

      if (flags.output === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return result.success ? 0 : 1;
      }

      console.log('\n================ sdctl Rollback ================');
      console.log(`✓ Restored deployment to revision #${result.restoredRevision.revision}`);
      console.log(`  Installer Version: v${result.restoredRevision.installerVersion}`);

      if (result.verifyReport) {
        console.log('\n--- Post-Rollback Verification ---');
        printCheckTable(result.verifyReport.checks);
      }

      if (result.success) {
        console.log('\n✓ Rollback completed and verified.\n');
        return 0;
      } else {
        console.error('\n✗ Rollback completed but verification reported issues.\n');
        return 1;
      }
    } catch (err) {
      console.error(`\n✗ Rollback failed: ${(err as Error).message}`);
      return 1;
    }
  }

  if (command === 'status') {
    const state = loadState(workingDir);
    if (flags.output === 'json') {
      console.log(JSON.stringify(state, null, 2));
      return 0;
    }

    console.log('\n================ sdctl Deployment Status ================');
    console.log(`Current Revision: #${state.currentRevision || 0}`);
    console.log(`Total Retained Revisions: ${state.revisions.length}`);
    console.log('\nRevisions History:');
    for (const rev of state.revisions) {
      const vIcon = rev.verified ? '✓' : '✗';
      console.log(
        `  - Rev #${rev.revision} (${rev.timestamp}) [v${rev.installerVersion}] Verified: ${vIcon} (Hash: ${rev.specHash.slice(0, 12)}...)`,
      );
    }
    console.log('=========================================================\n');
    return 0;
  }

  if (command === 'verify') {
    let spec: DeploymentSpec | undefined;
    if (existsSync(specPath)) {
      try {
        const rawYaml = readFileSync(specPath, 'utf8');
        spec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
      } catch {
        // Spec error handled in verify
      }
    }

    const report = await runDeploymentVerification({
      workingDir,
      spec,
      all: flags.all,
      awaitClients: flags.awaitClients,
      clientTimeoutSec: flags.timeoutSec,
      editorUrl: flags.editorUrl,
      relayUrl: flags.relayUrl,
    });

    if (flags.output === 'json') {
      console.log(JSON.stringify(report, null, 2));
      return report.valid ? 0 : 1;
    }

    console.log('\n================ sdctl Deployment Verification ================');
    printCheckTable(report.checks);
    console.log('----------------------------------------------------------------');
    console.log(
      `Summary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warned} warnings, ${report.summary.skipped} skipped.`,
    );

    if (report.clientReports && report.clientReports.length > 0) {
      console.log('\nClient Diagnostic Reports:');
      for (const cr of report.clientReports) {
        console.log(
          `  - [${cr.clientId}] Test Code: ${cr.testCode}, P2P: ${cr.p2pConnected ? 'OK' : 'FAIL'}, Pair: ${cr.selectedCandidatePair || 'N/A'}`,
        );
      }
    }

    if (report.valid) {
      console.log('\n✓ Deployment verification succeeded.');
      return 0;
    } else {
      console.error('\n✗ Deployment verification failed.');
      return 1;
    }
  }

  console.error(`Unknown command: '${command}'. Run 'sdctl --help' for available commands.`);
  return 1;
}
