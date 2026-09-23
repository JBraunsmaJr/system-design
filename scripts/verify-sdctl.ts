/**
 * Comprehensive verification test suite for `sdctl` (Phase 1 & Phase 2):
 * - Phase 1: Release manifest, schema validation, artifact generation, secret isolation, host detection, state management, CLI wizard.
 * - Phase 2: TLS certificate validation, preflight checks suite, layered deployment verification (L1-L4), client diagnostics page.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULT_MANIFEST, getResolvedImages } from '../sdctl/src/manifest.js';
import { validateDeploymentSpec } from '../sdctl/src/schema.js';
import { dumpDeploymentSpecYaml, parseSimpleYaml } from '../sdctl/src/yaml.js';
import { generateComposeYaml } from '../sdctl/src/generators/compose.js';
import { generateCaddyfile } from '../sdctl/src/generators/caddy.js';
import { generateCoturnConfig } from '../sdctl/src/generators/coturn.js';
import { loadOrCreateSecrets } from '../sdctl/src/generators/secrets.js';
import { generateHeader, isManuallyModified } from '../sdctl/src/generators/header.js';
import { checkDockerSocket, checkMountPathParity } from '../sdctl/src/host.js';
import {
  loadState,
  recordAppliedRevision,
  getPreviousRevision,
  MIN_RETAINED_REVISIONS,
} from '../sdctl/src/state.js';
import { buildDeploymentSpec, loadAnswersFile } from '../sdctl/src/wizard.js';
import { validateCertificates } from '../sdctl/src/cert.js';
import { runPreflightChecks } from '../sdctl/src/preflight.js';
import { runDeploymentVerification } from '../sdctl/src/verify.js';
import { calculatePlan, formatPlanText } from '../sdctl/src/plan.js';
import { applyDeployment } from '../sdctl/src/apply.js';
import { upgradeDeployment, rollbackDeployment } from '../sdctl/src/lifecycle.js';
import { runCli } from '../sdctl/src/cli.js';
import { generateTestCertificate } from './certHelper.js';
import type { DeploymentSpec, ReleaseManifest } from '../sdctl/src/types.js';

let failures = 0;

function check(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    failures++;
    console.error(`  FAIL: ${description}`);
  }
}

console.log('=== SDCTL Phase 1 & 2 Verification Suite ===\n');

// 1. Release Manifest & Registry Prefix Rewriting
console.log('1. Release Manifest and Registry Rewriting');
{
  check(DEFAULT_MANIFEST.version === '0.1.0', 'Manifest carries valid version 0.1.0');
  check(
    Boolean(DEFAULT_MANIFEST.images.editor.digest.startsWith('sha256:')),
    'Editor image pinned by digest',
  );
  check(
    Boolean(DEFAULT_MANIFEST.images.relay.digest.startsWith('sha256:')),
    'Relay image pinned by digest',
  );
  check(
    Boolean(DEFAULT_MANIFEST.images.proxy.digest.startsWith('sha256:')),
    'Proxy image pinned by digest',
  );
  check(
    Boolean(DEFAULT_MANIFEST.images.turn.digest.startsWith('sha256:')),
    'Coturn image pinned by digest',
  );

  const defaultResolved = getResolvedImages(DEFAULT_MANIFEST);
  check(
    defaultResolved.editor ===
      `${DEFAULT_MANIFEST.images.editor.image}@${DEFAULT_MANIFEST.images.editor.digest}`,
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

  const invalidIsolatedStun: DeploymentSpec = {
    version: '1',
    mode: 'isolated',
    topology: 'lan',
    tls: {
      mode: 'provided',
      certificatePath: 'certs/cert.pem',
      privateKeyPath: 'certs/key.pem',
    },
    iceServers: 'stun:stun.l.google.com:19302',
    relay: {},
  };
  const res3 = validateDeploymentSpec(invalidIsolatedStun);
  check(!res3.valid, 'Isolated mode with public STUN is rejected');
}

// 3. Artifact Generation (compose.yaml, Caddyfile, turnserver.conf)
console.log('\n3. Artifact Generation');
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
      realm: 'turn.example.com',
      externalIp: '198.51.100.1',
    },
  };

  const compose = generateComposeYaml(spec, DEFAULT_MANIFEST);
  check(compose.includes('services:'), 'Generated compose.yaml contains services');
  check(
    compose.includes('sdctl.managed: "true"'),
    'Containers labelled with sdctl ownership label',
  );
  check(compose.includes(DEFAULT_MANIFEST.images.editor.digest), 'Compose pins editor by digest');
  check(
    compose.includes('networks:\n  sdctl-net:\n    name: sdctl-net'),
    'Generated compose.yaml defines sdctl-net network',
  );
  check(compose.includes('networks:\n      - sdctl-net'), 'Services connect to sdctl-net network');

  const caddy = generateCaddyfile(spec);
  check(caddy.includes('design.example.com'), 'Caddyfile configures editor host');
  check(caddy.includes('relay.example.com'), 'Caddyfile configures relay host');
  check(
    caddy.includes('@relay_blocked not client_ip 192.168.1.0/24'),
    'Caddyfile configures CIDR allowlist',
  );

  const coturn = generateCoturnConfig(spec);
  check(coturn.includes('realm=turn.example.com'), 'Coturn config contains realm');
  check(coturn.includes('external-ip=198.51.100.1'), 'Coturn config contains external IP');

  // Single host Caddy routing without CIDRs
  const singleHostSpec: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'lan',
    tls: {
      mode: 'acme',
      domain: 'collab.example.com',
    },
    relay: {},
  };
  const singleHostCaddy = generateCaddyfile(singleHostSpec);
  check(
    singleHostCaddy.includes('handle @relay_path') &&
      singleHostCaddy.includes('reverse_proxy relay:4444'),
    'Single-host Caddyfile unconditionality routes @relay_path to relay:4444',
  );
}

// 4. Secret Isolation & Management (secrets.env)
console.log('\n4. Secret Isolation');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-test-'));
  const secretsPath = join(testDir, 'secrets.env');
  const sec = loadOrCreateSecrets(secretsPath, true);
  check(existsSync(secretsPath), 'secrets.env created on disk');
  check(
    sec.TURN_SECRET !== undefined && sec.TURN_SECRET.length >= 32,
    'TURN shared secret generated with >= 32 hex chars',
  );
  rmSync(testDir, { recursive: true, force: true });
}

// 5. Header Generation & Manual Edit Detection
console.log('\n5. Header Generation & Edit Detection');
{
  const header = generateHeader('#');
  check(
    header.includes('THIS FILE IS AUTOMATICALLY GENERATED BY SDCTL'),
    'Generated header has banner',
  );
  const content = `${header}\nsome config content\n`;
  check(!isManuallyModified(content, content), 'Unmodified content detected as pristine');
  const modified = content.replace('some config content', 'tampered content');
  check(isManuallyModified(modified, content), 'Manual edit correctly detected');
}

// 6. Host & Environment Detection
console.log('\n6. Host Checks');
{
  const socketCheck = checkDockerSocket();
  check(socketCheck.ok, 'Docker socket check handles host environment gracefully');

  const parityCheck = checkMountPathParity();
  check(parityCheck.ok, 'Mount path parity check validates current working directory');
}

// 7. State History Retention
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

  for (let i = 1; i <= 7; i++) {
    recordAppliedRevision({ ...spec, version: `${i}` }, testDir, '0.1.0', true);
  }

  const finalState = loadState(testDir);
  check(finalState.currentRevision === 7, 'Current revision number tracked incrementally (7)');
  check(
    finalState.revisions.length === MIN_RETAINED_REVISIONS,
    `State file preserves exactly last ${MIN_RETAINED_REVISIONS} revisions`,
  );
  check(
    finalState.revisions[0].revision === 3,
    'Oldest revisions pruned correctly (revisions 3-7 retained)',
  );

  const prev = getPreviousRevision(testDir);
  check(prev?.revision === 6, 'Previous revision helper retrieves correct prior state');

  rmSync(testDir, { recursive: true, force: true });
}

// 8. Wizard Answers & Non-Interactive Input
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

// 9. Phase 2: TLS Certificate & Key Validation
console.log('\n9. TLS Certificate Validation (FR-PRE-03)');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-certs-'));
  const validPair = generateTestCertificate({
    commonName: 'editor.test.com',
    sanHosts: ['editor.test.com', 'relay.test.com'],
    daysValid: 90,
  });

  const certPath = join(testDir, 'cert.pem');
  const keyPath = join(testDir, 'key.pem');
  writeFileSync(certPath, validPair.certPem, 'utf8');
  writeFileSync(keyPath, validPair.keyPem, 'utf8');

  // Test 1: Valid Certificate & Key
  const validRes = validateCertificates({
    certPath,
    keyPath,
    expectedHostnames: ['editor.test.com', 'relay.test.com'],
  });
  check(validRes.valid, 'Valid certificate and matching private key pass validation');
  check(
    Boolean(validRes.details.sans?.includes('editor.test.com')),
    'Subject Alternative Names extracted properly',
  );

  // Test 2: Hostname Mismatch
  const mismatchHostRes = validateCertificates({
    certPath,
    keyPath,
    expectedHostnames: ['other.uncovered.com'],
  });
  check(!mismatchHostRes.valid, 'Hostname not covered in SANs triggers validation failure');

  // Test 3: Key Mismatch
  const otherPair = generateTestCertificate({ commonName: 'other.com' });
  const wrongKeyPath = join(testDir, 'wrong-key.pem');
  writeFileSync(wrongKeyPath, otherPair.keyPem, 'utf8');

  const mismatchKeyRes = validateCertificates({
    certPath,
    keyPath: wrongKeyPath,
  });
  check(!mismatchKeyRes.valid, 'Mismatched private key triggers validation error');

  // Test 4: Expired Certificate
  const expiredPair = generateTestCertificate({
    commonName: 'editor.test.com',
    expired: true,
  });
  const expCertPath = join(testDir, 'expired-cert.pem');
  writeFileSync(expCertPath, expiredPair.certPem, 'utf8');

  const expiredRes = validateCertificates({
    certPath: expCertPath,
    keyPath,
  });
  check(!expiredRes.valid, 'Expired certificate triggers validation error');

  rmSync(testDir, { recursive: true, force: true });
}

// 10. Phase 2: Preflight Checks Suite (FR-PRE-01 to FR-PRE-04)
console.log('\n10. Preflight Checks Suite & Force Bypass');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-preflight-'));
  const spec: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'lan',
    tls: { mode: 'none' },
    relay: {},
  };

  // Preflight without bypass
  const report1 = runPreflightChecks({
    workingDir: testDir,
    spec,
  });
  check(report1.checks.length >= 4, 'Preflight runs all standard host and config checks');
  check(
    report1.checks.some((c) => c.id === 'PRE-REG-DIGESTS' && c.status === 'pass'),
    'Manifest image digests verified in preflight',
  );

  // Preflight with force bypass of invalid spec
  const invalidSpec: DeploymentSpec = {
    version: '1',
    mode: 'isolated',
    topology: 'lan',
    tls: { mode: 'acme' }, // Invalid for isolated
    relay: {},
  };
  const reportForced = runPreflightChecks({
    workingDir: testDir,
    spec: invalidSpec,
    force: ['PRE-CFG-SPEC'],
  });
  check(
    reportForced.forcedCheckIds.includes('PRE-CFG-SPEC'),
    'Force bypass registers bypassed check IDs',
  );

  rmSync(testDir, { recursive: true, force: true });
}

// 11. Phase 2: Layered Deployment Verification (FR-VER-01 to FR-VER-06)
console.log('\n11. Layered Deployment Verification (Live & Mock Endpoints)');
{
  // Setup a mock HTTP & WebSocket relay server for end-to-end verification test
  const MOCK_PORT = 19444;
  const mockHttpServer = http.createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>System Design Editor</title></head><body>OK</body></html>');
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  const wss = new WebSocketServer({ server: mockHttpServer });
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on('connection', (ws) => {
    let currentRoom: string | null = null;
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe' && Array.isArray(msg.topics)) {
          for (const topic of msg.topics) {
            currentRoom = topic;
            if (!rooms.has(topic)) rooms.set(topic, new Set());
            rooms.get(topic)!.add(ws);
          }
        } else if (msg.type === 'publish' && msg.topic) {
          const subscribers = rooms.get(msg.topic);
          if (subscribers) {
            for (const client of subscribers) {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(msg));
              }
            }
          }
        }
      } catch {
        // ignore
      }
    });

    ws.on('close', () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
      }
    });
  });

  await new Promise<void>((resolve) => mockHttpServer.listen(MOCK_PORT, () => resolve()));

  const verifyReport = await runDeploymentVerification({
    editorUrl: `http://localhost:${MOCK_PORT}`,
    relayUrl: `ws://localhost:${MOCK_PORT}`,
    all: true,
  });

  check(
    verifyReport.checks.some((c) => c.id === 'L3-EDGE-EDITOR-HTTP' && c.status === 'pass'),
    'Layer 3: Editor HTTP endpoint probe verified (HTTP 200)',
  );
  check(
    verifyReport.checks.some((c) => c.id === 'L4-RELAY-HANDSHAKE' && c.status === 'pass'),
    'Layer 4: Relay WebSocket handshake verified',
  );
  check(
    verifyReport.checks.some((c) => c.id === 'L4-RELAY-PUBSUB' && c.status === 'pass'),
    'Layer 4: Relay subscribe & publish delivered to room subscribers',
  );
  check(
    verifyReport.checks.some((c) => c.id === 'L4-RELAY-INTEGRITY' && c.status === 'pass'),
    'Layer 4: Relay message integrity confirmed bit-for-bit',
  );
  check(
    verifyReport.checks.some((c) => c.id === 'L4-RELAY-ISOLATION' && c.status === 'pass'),
    'Layer 4: Relay room topic isolation verified (0 leak to unsubscribed clients)',
  );

  wss.close();
  mockHttpServer.close();
}

// 12. Phase 2: Client Diagnostics Page (FR-DIAG-01 to FR-DIAG-06)
console.log('\n12. Client Diagnostics Page (/diag.html)');
{
  const diagPath = join(process.cwd(), 'public', 'diag.html');
  check(existsSync(diagPath), 'public/diag.html exists for static serving');

  const diagContent = readFileSync(diagPath, 'utf8');
  check(diagContent.includes('Client Diagnostics'), 'diag.html contains diagnostics title');
  check(diagContent.includes('/env-config.js'), 'diag.html loads runtime environment config');
  check(
    diagContent.includes('checkMixedContent'),
    'diag.html contains mixed-content security check',
  );
  check(diagContent.includes('probeRelayWebSocket'), 'diag.html contains relay WebSocket probe');
  check(
    diagContent.includes('testIceGathering'),
    'diag.html contains STUN/TURN ICE candidate gathering',
  );
  check(diagContent.includes('testP2PDataChannel'), 'diag.html contains WebRTC DataChannel test');
  check(
    diagContent.includes('publishDiagnosticReport'),
    'diag.html contains diagnostic report publisher',
  );
  check(
    !diagContent.includes('cdn.jsdelivr') && !diagContent.includes('unpkg.com'),
    'diag.html has zero external CDN dependencies',
  );
}

// 13. Phase 3: Plan Engine and Diff Reporting (FR-APPLY-01)
console.log('\n13. Plan Engine and Diff Reporting');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-plan-'));
  const specV1: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'lan',
    tls: { mode: 'none' },
    relay: {},
  };

  // Initial plan with no prior state
  const initialPlan = calculatePlan({ desiredSpec: specV1, workingDir: testDir });
  check(initialPlan.hasChanges, 'Initial deployment plan detects pending changes');
  check(
    initialPlan.componentsAdded.includes('editor') && initialPlan.componentsAdded.includes('relay'),
    'Plan lists editor and relay as components added',
  );

  // Record applied revision
  recordAppliedRevision(specV1, testDir, '0.1.0', true);

  // Same spec should produce no diff (idempotent, FR-APPLY-03)
  const unchangedPlan = calculatePlan({ desiredSpec: specV1, workingDir: testDir });
  check(!unchangedPlan.hasChanges, 'Idempotent plan detects zero changes for matching spec');

  // Modified spec: adding TLS proxy and coturn
  const specV2: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'nat',
    tls: { mode: 'acme', domain: 'design.example.com' },
    turn: { enabled: true, realm: 'turn.example.com' },
    relay: { allowedCidrs: ['10.0.0.0/8'] },
  };

  const modifiedPlan = calculatePlan({ desiredSpec: specV2, workingDir: testDir });
  check(modifiedPlan.hasChanges, 'Modified plan detects differences');
  check(modifiedPlan.componentsAdded.includes('proxy'), 'Plan detects proxy component added');
  check(modifiedPlan.componentsAdded.includes('turn'), 'Plan detects turn component added');
  check(
    modifiedPlan.proxyChanges.some((p) => p.property.includes('TLS Mode')),
    'Plan detects TLS mode transition',
  );
  check(
    modifiedPlan.proxyChanges.some((p) => p.property.includes('Relay Allowed CIDRs')),
    'Plan detects Relay CIDR allowlist addition',
  );

  const planText = formatPlanText(modifiedPlan);
  check(
    planText.includes('+ Components Added: proxy, turn'),
    'Plan formatter includes added components',
  );

  rmSync(testDir, { recursive: true, force: true });
}

// 14. Phase 3: Apply Engine and Lifecycle Operations (FR-APPLY-02 to FR-APPLY-07)
console.log('\n14. Apply Engine, Secret Generation and Diagnostics Output');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-apply-'));
  const spec: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'lan',
    tls: { mode: 'none' },
    relay: {},
  };

  const applyRes = await applyDeployment({
    workingDir: testDir,
    spec,
    force: ['PRE-HOST-SOCK', 'PRE-HOST-MOUNT'],
    skipVerify: true,
    executeDocker: false,
  });

  check(applyRes.success, 'applyDeployment executes successfully');
  check(existsSync(join(testDir, 'compose.yaml')), 'applyDeployment generates compose.yaml');
  check(existsSync(join(testDir, 'secrets.env')), 'applyDeployment generates secrets.env');
  check(
    applyRes.diagnosticsUrl.includes('/diag.html'),
    'apply prints diagnostics URL (FR-APPLY-07)',
  );
  check(
    Boolean(applyRes.testCode && applyRes.testCode.startsWith('DIAG-')),
    'apply prints diagnostics test code (FR-APPLY-07)',
  );

  const state = loadState(testDir);
  check(state.revisions.length === 1, 'apply records state revision in .sdctl/state.json');
  check(state.revisions[0].revision === 1, 'Recorded revision has index 1');

  rmSync(testDir, { recursive: true, force: true });
}

// 15. Phase 3: Upgrade Engine and Schema Migration (FR-UPG-01 to FR-UPG-07)
console.log('\n15. Upgrade Engine and Safety Validations');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-upg-'));
  const specPath = join(testDir, 'deployment.yaml');
  const specV1: DeploymentSpec = {
    version: '0.1.0',
    mode: 'public',
    topology: 'lan',
    tls: { mode: 'none' },
    relay: {},
  };
  writeFileSync(specPath, dumpDeploymentSpecYaml(specV1), 'utf8');
  recordAppliedRevision(specV1, testDir, '0.1.0', true);

  // Downgrade protection (FR-UPG-07)
  const olderManifest: ReleaseManifest = {
    ...DEFAULT_MANIFEST,
    version: '0.0.9',
  };
  let downgradeRejected = false;
  try {
    await upgradeDeployment({
      workingDir: testDir,
      manifest: olderManifest,
      force: ['PRE-HOST-SOCK', 'PRE-HOST-MOUNT'],
      executeDocker: false,
    });
  } catch (err) {
    downgradeRejected = (err as Error).message.includes('Downgrade');
  }
  check(downgradeRejected, 'Upgrade refuses downgrades (FR-UPG-07)');

  // minUpgradeFrom check (FR-UPG-02)
  const jumpManifest: ReleaseManifest = {
    ...DEFAULT_MANIFEST,
    version: '0.3.0',
    minUpgradeFrom: '0.2.0',
  };
  let minUpgradeRejected = false;
  try {
    await upgradeDeployment({
      workingDir: testDir,
      manifest: jumpManifest,
      force: ['PRE-HOST-SOCK', 'PRE-HOST-MOUNT'],
      executeDocker: false,
    });
  } catch (err) {
    minUpgradeRejected = (err as Error).message.includes('minimum upgrade version');
  }
  check(minUpgradeRejected, 'Upgrade enforces minimum upgrade-from version path (FR-UPG-02)');

  // Valid upgrade with automatic backup (FR-UPG-03, FR-UPG-04)
  const targetManifest: ReleaseManifest = {
    ...DEFAULT_MANIFEST,
    version: '0.2.0',
    minUpgradeFrom: '0.1.0',
  };

  const upgRes = await upgradeDeployment({
    workingDir: testDir,
    manifest: targetManifest,
    force: ['PRE-HOST-SOCK', 'PRE-HOST-MOUNT'],
    executeDocker: false,
  });

  check(upgRes.success, 'Upgrade succeeds to target version');
  check(
    existsSync(join(testDir, 'deployment.yaml.bak')),
    'Upgrade creates deployment.yaml.bak backup (FR-UPG-03)',
  );
  check(upgRes.newVersion === '0.2.0', 'Upgrade updates version in state and specification');

  rmSync(testDir, { recursive: true, force: true });
}

// 16. Phase 3: Rollback Engine (FR-UPG-05)
console.log('\n16. Rollback Engine');
{
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-rollback-'));
  const specV1: DeploymentSpec = {
    version: '0.1.0',
    mode: 'public',
    topology: 'lan',
    tls: { mode: 'none' },
    relay: {},
  };
  const specV2: DeploymentSpec = {
    version: '0.2.0',
    mode: 'public',
    topology: 'nat',
    tls: { mode: 'acme', domain: 'new.domain.com' },
    relay: {},
  };

  recordAppliedRevision(specV1, testDir, '0.1.0', true);
  recordAppliedRevision(specV2, testDir, '0.2.0', true);

  const rbRes = await rollbackDeployment({
    workingDir: testDir,
    toRevision: 1,
    executeDocker: false,
  });

  check(rbRes.success, 'rollbackDeployment succeeds to target revision');
  check(
    rbRes.restoredRevision.installerVersion === '0.1.0',
    'Restored revision reflects revision 1 spec',
  );

  const finalState = loadState(testDir);
  check(finalState.currentRevision === 3, 'Rollback records a new revision transition in state');

  rmSync(testDir, { recursive: true, force: true });
}

// 17. End-to-End CLI Invocation for all Phase 1-3 commands
console.log('\n17. Full CLI Command Lifecycle Execution');
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

  let code = await runCli(['--version', '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl --version` exits 0');

  code = await runCli(['init', '--answers', answersPath, '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl init --answers ...` exits 0');
  check(existsSync(join(testDir, 'deployment.yaml')), 'CLI `sdctl init` writes deployment.yaml');

  code = await runCli(['validate', '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl validate` exits 0 on generated deployment.yaml');

  code = await runCli(['preflight', '--force', 'PRE-HOST-SOCK', '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl preflight` exits 0');

  code = await runCli(['plan', '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl plan` exits 0');

  code = await runCli(['generate', '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl generate` exits 0');
  check(existsSync(join(testDir, 'compose.yaml')), 'CLI `sdctl generate` creates compose.yaml');
  check(existsSync(join(testDir, 'Caddyfile')), 'CLI `sdctl generate` creates Caddyfile');
  check(
    existsSync(join(testDir, 'turnserver.conf')),
    'CLI `sdctl generate` creates turnserver.conf',
  );
  check(existsSync(join(testDir, 'secrets.env')), 'CLI `sdctl generate` creates secrets.env');

  code = await runCli(
    ['apply', '--force', 'PRE-HOST-SOCK,PRE-HOST-MOUNT', '--skip-verify', '--output', 'json'],
    testDir,
  );
  check(code === 0, 'CLI `sdctl apply` exits 0');

  code = await runCli(['status', '--output', 'json'], testDir);
  check(code === 0, 'CLI `sdctl status` exits 0');

  rmSync(testDir, { recursive: true, force: true });
}

// 18. Cloudflare DNS-01 ACME & Wildcard Support with Configurable Resolvers & Custom Proxy Image
console.log('\n18. Cloudflare DNS-01 ACME & Wildcard Support');
{
  // A. Schema validation
  const cloudflareSpec: DeploymentSpec = {
    version: '1',
    mode: 'public',
    topology: 'routed',
    proxy: {
      image: 'slothcroissant/caddy-cloudflaredns:latest',
    },
    tls: {
      mode: 'acme-dns',
      domain: '*.home.jbraunsma.dev',
      editorHost: 'design.home.jbraunsma.dev',
      relayHost: 'relay.home.jbraunsma.dev',
      dnsProvider: {
        name: 'cloudflare',
        apiTokenEnvVar: 'CLOUDFLARE_API_TOKEN',
        resolvers: ['1.1.1.1', '1.0.0.1'],
        propagationDelay: '30s',
        propagationTimeout: '10m',
      },
    },
    relay: {
      allowedCidrs: ['192.168.1.0/24'],
    },
  };

  const schemaRes = validateDeploymentSpec(cloudflareSpec);
  check(
    schemaRes.valid && schemaRes.errors.length === 0,
    'Cloudflare DNS-01 spec passes schema validation',
  );

  const invalidSpec = {
    ...cloudflareSpec,
    tls: {
      mode: 'acme-dns',
      dnsProvider: {
        name: 'cloudflare',
        resolvers: [123], // invalid resolver type
      },
    },
  };
  const invalidRes = validateDeploymentSpec(invalidSpec);
  check(!invalidRes.valid, 'Schema catches invalid resolvers array elements');

  // B. YAML serialization & recursive parsing
  const dumpedYaml = dumpDeploymentSpecYaml(cloudflareSpec);
  check(dumpedYaml.includes('mode: "acme-dns"'), 'YAML includes mode: "acme-dns"');
  check(
    dumpedYaml.includes('slothcroissant/caddy-cloudflaredns:latest'),
    'YAML includes custom proxy image',
  );
  check(dumpedYaml.includes('- "1.1.1.1"'), 'YAML dumps resolver list correctly');

  const parsedSpec = parseSimpleYaml(dumpedYaml) as unknown as DeploymentSpec;
  check(parsedSpec.tls.mode === 'acme-dns', 'Parsed spec preserves acme-dns mode');
  check(
    Array.isArray(parsedSpec.tls.dnsProvider?.resolvers) &&
      parsedSpec.tls.dnsProvider?.resolvers?.[0] === '1.1.1.1',
    'Parsed spec preserves configurable resolvers array',
  );

  // C. Caddyfile Generation with Configurable Resolvers
  const caddyfile = generateCaddyfile(cloudflareSpec);
  check(caddyfile.includes('*.home.jbraunsma.dev {'), 'Caddyfile contains wildcard block');
  check(
    caddyfile.includes('dns cloudflare {env.CLOUDFLARE_API_TOKEN}'),
    'Caddyfile contains cloudflare dns directive with env token',
  );
  check(
    caddyfile.includes('resolvers 1.1.1.1 1.0.0.1'),
    'Caddyfile contains configurable resolvers directive',
  );
  check(caddyfile.includes('propagation_delay 30s'), 'Caddyfile contains propagation_delay');
  check(caddyfile.includes('propagation_timeout 10m'), 'Caddyfile contains propagation_timeout');
  check(
    caddyfile.includes('@relay host relay.home.jbraunsma.dev'),
    'Caddyfile routes relay host in wildcard block',
  );
  check(caddyfile.includes('reverse_proxy editor:80'), 'Caddyfile falls back to editor');

  // Test custom operator nameservers / resolvers
  const customNsSpec: DeploymentSpec = {
    ...cloudflareSpec,
    tls: {
      ...cloudflareSpec.tls,
      dnsProvider: {
        name: 'cloudflare',
        resolvers: ['clyde.ns.cloudflare.com', 'mckenzie.ns.cloudflare.com'],
      },
    },
  };
  const caddyCustomNs = generateCaddyfile(customNsSpec);
  check(
    caddyCustomNs.includes('resolvers clyde.ns.cloudflare.com mckenzie.ns.cloudflare.com'),
    'Caddyfile generates custom operator nameservers when configured',
  );

  // D. Compose YAML Generation with Custom Image & Proxy Environment
  const composeYaml = generateComposeYaml(cloudflareSpec);
  check(
    composeYaml.includes('image: slothcroissant/caddy-cloudflaredns:latest'),
    'Compose YAML uses custom proxy image override',
  );
  check(
    composeYaml.includes('CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}'),
    'Compose YAML passes CLOUDFLARE_API_TOKEN to proxy',
  );
  check(composeYaml.includes('ACME_AGREE=true'), 'Compose YAML passes ACME_AGREE=true to proxy');

  // E. Secrets Management with Cloudflare Token
  const testDir = mkdtempSync(join(tmpdir(), 'sdctl-cf-'));
  const secretsPath = join(testDir, 'secrets.env');
  loadOrCreateSecrets(secretsPath, false, { CLOUDFLARE_API_TOKEN: 'secret-token-12345' });
  const writtenSecrets = readFileSync(secretsPath, 'utf8');
  check(
    writtenSecrets.includes('CLOUDFLARE_API_TOKEN=secret-token-12345'),
    'secrets.env stores CLOUDFLARE_API_TOKEN',
  );

  // F. Wizard Answers Spec Generation
  const wizardSpec = buildDeploymentSpec({
    mode: 'public',
    topology: 'routed',
    tlsMode: 'acme-dns',
    domain: '*.home.jbraunsma.dev',
    editorHost: 'design.home.jbraunsma.dev',
    relayHost: 'relay.home.jbraunsma.dev',
    cloudflareResolvers: '8.8.8.8, 8.8.4.4',
    cloudflareApiToken: 'token-abc',
    proxyImage: 'slothcroissant/caddy-cloudflaredns:latest',
  });
  check(wizardSpec.tls.mode === 'acme-dns', 'Wizard generates acme-dns spec');
  check(
    wizardSpec.tls.dnsProvider?.resolvers?.[0] === '8.8.8.8' &&
      wizardSpec.tls.dnsProvider?.resolvers?.[1] === '8.8.4.4',
    'Wizard parses comma-separated configurable resolvers',
  );
  check(
    wizardSpec.proxy?.image === 'slothcroissant/caddy-cloudflaredns:latest',
    'Wizard records proxy image',
  );

  rmSync(testDir, { recursive: true, force: true });
}

console.log('\n==================================================');
if (failures === 0) {
  console.log('All SDCTL Phase 1, 2, and 3 verification checks passed successfully!');
  process.exit(0);
} else {
  console.error(`FAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
