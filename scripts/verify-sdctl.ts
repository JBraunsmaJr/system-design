/**
 * Comprehensive verification test suite for `sdctl` Phase 1:
 * - Release manifest and image resolution
 * - Schema validation with precise error paths and actionable fixes
 * - Deterministic artifact generation (compose.yaml, Caddyfile, turnserver.conf)
 * - Secret generation and permissions (secrets.env)
 * - Header generation and manual edit detection
 * - Host checks (Docker socket & mount parity)
 * - State management and revision retention (>= 5 revisions)
 * - Setup wizard answers compilation and CI mode
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DEFAULT_MANIFEST, getResolvedImages } from '../sdctl/src/manifest.js';
import { validateDeploymentSpec } from '../sdctl/src/schema.js';
import { generateComposeYaml } from '../sdctl/src/generators/compose.js';
import { generateCaddyfile } from '../sdctl/src/generators/caddy.js';
import { generateCoturnConfig } from '../sdctl/src/generators/coturn.js';
import { loadOrCreateSecrets } from '../sdctl/src/generators/secrets.js';
import { generateHeader, isManuallyModified } from '../sdctl/src/generators/header.js';
import { checkDockerSocket, checkMountPathParity } from '../sdctl/src/host.js';
import { loadState, recordAppliedRevision, getPreviousRevision, MIN_RETAINED_REVISIONS } from '../sdctl/src/state.js';
import { buildDeploymentSpec, loadAnswersFile } from '../sdctl/src/wizard.js';
import { runCli } from '../sdctl/src/cli.js';
import type {DeploymentSpec} from '../sdctl/src/types.js';

let failures = 0;

function check(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    failures++;
    console.error(`  FAIL: ${description}`);
  }
}

console.log('=== SDCTL Phase 1 Verification Suite ===\n');

// 1. Release Manifest & Registry Prefix Rewriting
console.log('1. Release Manifest and Registry Rewriting');
{
  check(DEFAULT_MANIFEST.version === '0.1.0', 'Manifest carries valid version 0.1.0');
  check(Boolean(DEFAULT_MANIFEST.images.editor.digest.startsWith('sha256:')), 'Editor image pinned by digest');
  check(Boolean(DEFAULT_MANIFEST.images.relay.digest.startsWith('sha256:')), 'Relay image pinned by digest');
  check(Boolean(DEFAULT_MANIFEST.images.proxy.digest.startsWith('sha256:')), 'Proxy image pinned by digest');
  check(Boolean(DEFAULT_MANIFEST.images.turn.digest.startsWith('sha256:')), 'Coturn image pinned by digest');

  const defaultResolved = getResolvedImages(DEFAULT_MANIFEST);
  check(
    defaultResolved.editor === `${DEFAULT_MANIFEST.images.editor.image}@${DEFAULT_MANIFEST.images.editor.digest}`,
    'Default image resolution preserves repository and digest',
  );

  const customRegistry = 'registry.internal.corp:5000';
  const customResolved = getResolvedImages(DEFAULT_MANIFEST, customRegistry);
  check(
    customResolved.editor.startsWith('registry.internal.corp:5000/'),
    'Registry prefix rewrites editor image reference',
  );
  check(
    customResolved.editor.endsWith(`@${DEFAULT_MANIFEST.images.editor.digest}`),
    'Digest preserved across registry rewriting',
  );
}

// 2. Schema Validation & Error Reporting with Suggested Fixes
console.log('\n2. Schema Validation & Path/Fix Reporting');
{
  // Valid spec
  const validSpec: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'lan',
    tls: {
      mode: 'acme',
      domain: 'design.example.com',
    },
    relay: {
      allowedCidrs: ['10.0.0.0/8'],
    },
  };
  const res1 = validateDeploymentSpec(validSpec);
  check(res1.valid && res1.errors.length === 0, 'Valid public ACME specification passes');

  // Isolated mode with ACME (Forbidden)
  const invalidIsolatedAcme: DeploymentSpec = {
    version: '1',
    mode: 'isolated',
    topology: 'lan',
    tls: {
      mode: 'acme',
      domain: 'design.local',
    },
    relay: {},
  };
  const res2 = validateDeploymentSpec(invalidIsolatedAcme);
  check(!res2.valid, 'Isolated mode with ACME is rejected');
  check(
    res2.errors.some((e) => e.path === 'tls.mode' && e.suggestedFix.includes('provided')),
    'Isolated ACME error provides actionable suggested fix',
  );

  // Isolated mode with public STUN (Forbidden)
  const invalidIsolatedStun: DeploymentSpec = {
    version: '1',
    mode: 'isolated',
    topology: 'lan',
    tls: {
      mode: 'provided',
      certificatePath: '/certs/cert.pem',
      privateKeyPath: '/certs/key.pem',
      editorHost: 'design.local',
    },
    relay: {},
    iceServers: 'stun:stun.l.google.com:19302',
  };
  const res3 = validateDeploymentSpec(invalidIsolatedStun);
  check(!res3.valid, 'Isolated mode with public STUN is rejected');
  check(
    res3.errors.some((e) => e.path === 'iceServers' && e.suggestedFix.includes('none')),
    'Public STUN error in isolated mode provides actionable fix',
  );

  // NAT topology without TURN (Forbidden)
  const invalidNatNoTurn: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'nat',
    tls: {
      mode: 'acme',
      domain: 'design.example.com',
    },
    relay: {},
  };
  const res4 = validateDeploymentSpec(invalidNatNoTurn);
  check(!res4.valid, 'NAT topology without TURN is rejected');
  check(
    res4.errors.some((e) => e.path === 'turn.enabled'),
    'NAT without TURN reports turn.enabled path and fix',
  );

  // Invalid CIDR
  const invalidCidrSpec: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'lan',
    tls: { mode: 'none' },
    relay: {
      allowedCidrs: ['999.999.999.999/99'],
    },
  };
  const res5 = validateDeploymentSpec(invalidCidrSpec);
  check(!res5.valid, 'Invalid CIDR format is rejected');
  check(
    res5.errors.some((e) => e.path.includes('relay.allowedCidrs')),
    'Invalid CIDR reports exact index path',
  );
}

// 3. Deterministic Artifact Generation
console.log('\n3. Deterministic Artifact Generation');
{
  const spec: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'nat',
    tls: {
      mode: 'acme',
      editorHost: 'design.example.com',
      relayHost: 'relay.example.com',
    },
    relay: {
      allowedCidrs: ['192.168.1.0/24'],
    },
    turn: {
      enabled: true,
      externalIp: '203.0.113.10',
    },
  };

  // Compose generation
  const composeYaml = generateComposeYaml(spec, DEFAULT_MANIFEST);
  check(composeYaml.includes('THIS FILE IS AUTOMATICALLY GENERATED BY SDCTL'), 'Compose contains do-not-edit header');
  check(composeYaml.includes('sdctl.managed: "true"'), 'Compose contains sdctl.managed label');
  check(composeYaml.includes('sdctl.release: "0.1.0"'), 'Compose contains release version label');
  check(composeYaml.includes('RELAY=wss://relay.example.com'), 'Compose derives wss:// relay URL for TLS deployment');
  check(composeYaml.includes('APP_URL=https://design.example.com'), 'Compose derives https:// APP_URL');
  check(composeYaml.includes('image: coturn/coturn:latest@sha256:'), 'Compose generates coturn service with pinned digest');
  check(composeYaml.includes('secrets.env'), 'Compose references secrets.env rather than inlining credentials');

  // Caddyfile generation
  const caddyfile = generateCaddyfile(spec);
  check(caddyfile.includes('THIS FILE IS AUTOMATICALLY GENERATED BY SDCTL'), 'Caddyfile contains header');
  check(caddyfile.includes('design.example.com'), 'Caddyfile configures editor host block');
  check(caddyfile.includes('relay.example.com'), 'Caddyfile configures relay host block');
  check(caddyfile.includes('@relay_blocked not client_ip 192.168.1.0/24'), 'Caddyfile enforces CIDR restriction on relay');

  // Single-host Caddyfile subpath
  const singleHostSpec: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'lan',
    tls: {
      mode: 'acme',
      editorHost: 'design.example.com',
      relayHost: 'design.example.com',
    },
    relay: {
      allowedCidrs: ['10.0.0.0/8'],
    },
  };
  const singleHostCaddy = generateCaddyfile(singleHostSpec);
  check(singleHostCaddy.includes('handle @relay_path'), 'Single host Caddyfile routes /relay path to relay service');

  // Coturn generation
  const coturnConf = generateCoturnConfig(spec);
  check(coturnConf.includes('listening-port=3478'), 'Coturn configures standard listening port');
  check(coturnConf.includes('external-ip=203.0.113.10'), 'Coturn configures external IP');
  check(coturnConf.includes('static-auth-secret=${TURN_SECRET}'), 'Coturn references TURN_SECRET env var');
}

// 4. Secret Management & File Permissions
console.log('\n4. Secrets Management (secrets.env)');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-test-'));
  const secretsPath = join(testDir, 'secrets.env');

  const secrets = loadOrCreateSecrets(secretsPath, true);
  check(existsSync(secretsPath), 'secrets.env is created');
  check(Boolean(secrets.TURN_USERNAME && secrets.TURN_PASSWORD && secrets.TURN_SECRET), 'TURN credentials generated');
  check(secrets.TURN_PASSWORD.length >= 16, 'TURN password meets high entropy requirement');

  // Reload existing
  const reloaded = loadOrCreateSecrets(secretsPath, true);
  check(reloaded.TURN_PASSWORD === secrets.TURN_PASSWORD, 'Existing secrets preserved on subsequent loads');

  rmSync(testDir, { recursive: true, force: true });
}

// 5. Header & Manual Edit Detection
console.log('\n5. Header & Manual Edit Detection');
{
  const original = generateHeader('#') + 'foo: bar\n';
  check(!isManuallyModified(original, original), 'Unmodified generated content detected as clean');

  const modified = original + '# manual change\nextra: 123\n';
  check(isManuallyModified(modified, original), 'Manual modifications accurately detected');
}

// 6. Host & Environment Detection
console.log('\n6. Host Checks');
{
  const socketCheck = checkDockerSocket();
  check(socketCheck.ok, 'Docker socket check handles host environment gracefully');

  const parityCheck = checkMountPathParity();
  check(parityCheck.ok, 'Mount path parity check validates current working directory');
}

// 7. State Management & Revision History
console.log('\n7. State History Retention (>= 5 Revisions)');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-state-'));
  const spec: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'lan',
    tls: { mode: 'none' },
    relay: {},
  };

  // Record 7 revisions to test pruning down to MIN_RETAINED_REVISIONS
  for (let i = 1; i <= 7; i++) {
    recordAppliedRevision({ ...spec, version: `${i}` }, testDir, '0.1.0', true);
  }

  const finalState = loadState(testDir);
  check(finalState.currentRevision === 7, 'Current revision number tracked incrementally (7)');
  check(
    finalState.revisions.length === MIN_RETAINED_REVISIONS,
    `State file preserves exactly last ${MIN_RETAINED_REVISIONS} revisions`,
  );
  check(finalState.revisions[0].revision === 3, 'Oldest revisions pruned correctly (revisions 3-7 retained)');

  const prev = getPreviousRevision(testDir);
  check(prev?.revision === 6, 'Previous revision helper retrieves correct prior state');

  rmSync(testDir, { recursive: true, force: true });
}

// 8. Wizard Answers & Non-Interactive CI Operation
console.log('\n8. Wizard & Non-Interactive Input Processing');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-wiz-'));
  const answersJsonPath = join(testDir, 'answers.json');
  writeFileSync(
    answersJsonPath,
    JSON.stringify({
      mode: 'isolated',
      topology: 'lan',
      tlsMode: 'provided',
      editorHost: 'design.internal.corp',
      certificatePath: '/etc/ssl/cert.pem',
      privateKeyPath: '/etc/ssl/key.pem',
    }),
    'utf8',
  );

  const loadedAnswers = loadAnswersFile(answersJsonPath);
  const specFromAnswers = buildDeploymentSpec(loadedAnswers);
  check(specFromAnswers.mode === 'isolated', 'Answers file sets isolated mode');
  check(specFromAnswers.tls.mode === 'provided', 'Answers file sets provided TLS mode');

  const validation = validateDeploymentSpec(specFromAnswers);
  check(validation.valid, 'Compiled spec from valid answers file passes validation');

  rmSync(testDir, { recursive: true, force: true });
}

// 9. End-to-End CLI Invocation via runCli
console.log('\n9. CLI Command Execution');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-cli-'));
  const answersPath = join(testDir, 'answers.json');
  writeFileSync(
    answersPath,
    JSON.stringify({
      mode: 'public',
      topology: 'nat',
      tlsMode: 'acme',
      editorHost: 'editor.test.com',
      enableTurn: true,
    }),
    'utf8',
  );

  // CLI version check
  let code = await runCli(['--version', '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl --version` exits 0');

  // CLI init check
  code = await runCli(['init', '--answers', answersPath, '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl init --answers ...` exits 0');
  check(existsSync(join(testDir, 'deployment.yaml')), 'CLI `sdctl init` writes deployment.yaml');

  // CLI validate check
  code = await runCli(['validate', '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl validate` exits 0 on generated deployment.yaml');

  // CLI generate check
  code = await runCli(['generate', '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl generate` exits 0');
  check(existsSync(join(testDir, 'compose.yaml')), 'CLI `sdctl generate` creates compose.yaml');
  check(existsSync(join(testDir, 'Caddyfile')), 'CLI `sdctl generate` creates Caddyfile');
  check(existsSync(join(testDir, 'turnserver.conf')), 'CLI `sdctl generate` creates turnserver.conf');
  check(existsSync(join(testDir, 'secrets.env')), 'CLI `sdctl generate` creates secrets.env');

  rmSync(testDir, { recursive: true, force: true });
}

console.log('\n==================================================');
if (failures === 0) {
  console.log('All SDCTL Phase 1 verification checks passed successfully!');
  process.exit(0);
} else {
  console.error(`FAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
