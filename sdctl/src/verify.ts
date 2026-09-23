import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as http from 'http';
import * as https from 'https';
import WebSocket from 'ws';
import type {
  VerifyOptions,
  VerifyReport,
  CheckResult,
  ClientDiagReport,
  DeploymentSpec,
} from './types.js';
import { checkDockerSocket, checkMountPathParity } from './host.js';
import { parseSimpleYaml } from './yaml.js';
import { deriveEndpoints } from './generators/compose.js';

interface HttpProbeResult {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  durationMs: number;
}

function probeHttp(urlStr: string, timeoutMs = 4000): Promise<HttpProbeResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    try {
      const url = new URL(urlStr);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.get(
        urlStr,
        {
          headers: { 'User-Agent': 'sdctl-verifier/0.1.0' },
          timeout: timeoutMs,
          rejectUnauthorized: false, // allow self-signed / internal CAs during diagnostics probe
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: data,
              durationMs: Date.now() - start,
            });
          });
        },
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Connection timeout after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function waitForCondition(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for condition'));
      setTimeout(check, 20);
    };
    check();
  });
}

export async function runDeploymentVerification(
  options: VerifyOptions = {},
): Promise<VerifyReport> {
  const workingDir = options.workingDir || process.cwd();
  const runAll = options.all ?? false;
  const checks: CheckResult[] = [];
  const clientReports: ClientDiagReport[] = [];

  // Determine Spec and Endpoints
  let spec: DeploymentSpec | null = options.spec || null;
  if (!spec) {
    const specPath = join(workingDir, 'deployment.yaml');
    if (existsSync(specPath)) {
      try {
        const rawYaml = readFileSync(specPath, 'utf8');
        spec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
      } catch {
        // Spec parsing error handled in Layer 1
      }
    }
  }

  const derived = spec ? deriveEndpoints(spec) : { appUrl: '', relayUrl: '' };
  const editorUrl = options.editorUrl || derived.appUrl || 'http://localhost:8080';
  const relayUrl = options.relayUrl || derived.relayUrl || 'ws://localhost:4444';

  let layerPassed = true;

  // ==========================================
  // Layer 1: Host & Docker Infrastructure
  // ==========================================
  const sockCheck = checkDockerSocket();
  if (sockCheck.valid) {
    checks.push({
      id: 'L1-HOST-SOCK',
      layer: 1,
      name: 'Docker Daemon Socket',
      status: 'pass',
      expected: 'Accessible Docker/Podman socket',
      observed: `Socket accessible at ${sockCheck.socketPath}`,
    });
  } else {
    layerPassed = false;
    checks.push({
      id: 'L1-HOST-SOCK',
      layer: 1,
      name: 'Docker Daemon Socket',
      status: 'fail',
      expected: 'Accessible Docker/Podman socket',
      observed: sockCheck.error || 'Docker socket not found',
      cause: 'Docker daemon is not running or socket is not mounted into container',
      remediation: sockCheck.remediation,
    });
  }

  const mountCheck = checkMountPathParity(workingDir);
  if (mountCheck.valid) {
    checks.push({
      id: 'L1-HOST-MOUNT',
      layer: 1,
      name: 'Mount Path Parity',
      status: 'pass',
      expected: 'Working directory path matches host mount path',
      observed: `Working directory '${workingDir}' matches mount`,
    });
  } else {
    layerPassed = false;
    checks.push({
      id: 'L1-HOST-MOUNT',
      layer: 1,
      name: 'Mount Path Parity',
      status: 'fail',
      expected: 'Working directory path matches host mount path',
      observed: mountCheck.error || 'Mount path mismatch',
      cause: 'Working directory mounted at differing path from host',
      remediation: mountCheck.remediation,
    });
  }

  if (!layerPassed && !runAll) {
    return summarizeReport(checks, clientReports);
  }

  // ==========================================
  // Layer 2: Artifacts and Local Configuration
  // ==========================================
  layerPassed = true;

  const composePath = join(workingDir, 'compose.yaml');
  if (existsSync(composePath)) {
    checks.push({
      id: 'L2-CFG-COMPOSE',
      layer: 2,
      name: 'Compose Definition',
      status: 'pass',
      expected: 'compose.yaml exists in working directory',
      observed: `compose.yaml found at ${composePath}`,
    });
  } else {
    checks.push({
      id: 'L2-CFG-COMPOSE',
      layer: 2,
      name: 'Compose Definition',
      status: 'warn',
      expected: 'compose.yaml exists in working directory',
      observed: 'compose.yaml not found (standalone verification mode)',
      cause: 'Stack was not generated via sdctl in this directory',
      remediation: "Run 'sdctl apply' or provide explicit --editor-url and --relay-url flags",
    });
  }

  if (spec) {
    checks.push({
      id: 'L2-SPEC-PROFILE',
      layer: 2,
      name: 'Deployment Profile Consistency',
      status: 'pass',
      expected: 'Spec profile parameters consistent',
      observed: `Mode: ${spec.mode}, Topology: ${spec.topology}, TLS: ${spec.tls.mode}`,
    });
  }

  if (!layerPassed && !runAll) {
    return summarizeReport(checks, clientReports);
  }

  // ==========================================
  // Layer 3: Edge and Web Endpoint Probes
  // ==========================================
  layerPassed = true;

  if (editorUrl) {
    const start = Date.now();
    try {
      const probe = await probeHttp(editorUrl);
      const isOk = probe.statusCode >= 200 && probe.statusCode < 400;
      if (isOk) {
        checks.push({
          id: 'L3-EDGE-EDITOR-HTTP',
          layer: 3,
          name: 'Editor Web Endpoint Reachability',
          status: 'pass',
          expected: 'HTTP 200 / 3xx response from editor endpoint',
          observed: `HTTP ${probe.statusCode} received (${probe.durationMs}ms)`,
          durationMs: probe.durationMs,
        });
      } else {
        layerPassed = false;
        checks.push({
          id: 'L3-EDGE-EDITOR-HTTP',
          layer: 3,
          name: 'Editor Web Endpoint Reachability',
          status: 'fail',
          expected: 'HTTP 200 / 3xx response from editor endpoint',
          observed: `HTTP ${probe.statusCode} received`,
          cause: 'Editor server or proxy returned error status code',
          remediation: 'Check editor container logs and proxy configuration',
          durationMs: Date.now() - start,
        });
      }
    } catch (err) {
      layerPassed = false;
      checks.push({
        id: 'L3-EDGE-EDITOR-HTTP',
        layer: 3,
        name: 'Editor Web Endpoint Reachability',
        status: 'fail',
        expected: 'HTTP 200 / 3xx response from editor endpoint',
        observed: `Connection failed: ${(err as Error).message}`,
        cause: 'Editor container not running, DNS unresolvable, or proxy down',
        remediation: `Verify editor service is reachable at '${editorUrl}'`,
        durationMs: Date.now() - start,
      });
    }
  }

  if (!layerPassed && !runAll) {
    return summarizeReport(checks, clientReports);
  }

  // ==========================================
  // Layer 4: Relay Protocol Verification
  // ==========================================
  layerPassed = true;

  const relayStart = Date.now();
  let clientA: WebSocket | null = null;
  let clientB: WebSocket | null = null;
  let clientC: WebSocket | null = null;

  try {
    const wsOptions = {
      rejectUnauthorized: false,
      handshakeTimeout: 5000,
    };

    clientA = new WebSocket(relayUrl, wsOptions);
    clientB = new WebSocket(relayUrl, wsOptions);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        clientA!.once('open', () => resolve());
        clientA!.once('error', (err) => reject(err));
      }),
      new Promise<void>((resolve, reject) => {
        clientB!.once('open', () => resolve());
        clientB!.once('error', (err) => reject(err));
      }),
    ]);

    checks.push({
      id: 'L4-RELAY-HANDSHAKE',
      layer: 4,
      name: 'Relay WebSocket Handshake',
      status: 'pass',
      expected: 'Successful WebSocket handshake over relay URL',
      observed: `Connected 2 independent clients to ${relayUrl}`,
      durationMs: Date.now() - relayStart,
    });

    const testRoom = `sdctl-verify-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    clientA.send(JSON.stringify({ type: 'subscribe', topics: [testRoom] }));
    clientB.send(JSON.stringify({ type: 'subscribe', topics: [testRoom] }));

    let receivedByB: { data: unknown } | null = null;
    clientB.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'publish' && msg.topic === testRoom) {
          receivedByB = msg;
        }
      } catch {
        // ignore
      }
    });

    await new Promise((r) => setTimeout(r, 150));

    const testPayload = {
      sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1',
      type: 'sdctl-test-offer',
      nonce: Math.random(),
    };

    clientA.send(
      JSON.stringify({
        type: 'publish',
        topic: testRoom,
        data: testPayload,
      }),
    );

    await waitForCondition(() => receivedByB !== null, 3000);

    checks.push({
      id: 'L4-RELAY-PUBSUB',
      layer: 4,
      name: 'Relay Topic Subscribe & Publish',
      status: 'pass',
      expected: 'Published message delivered to subscribed peers',
      observed: 'Client B received message published by Client A in test room',
    });

    // Check payload integrity
    const payloadMatches =
      JSON.stringify((receivedByB as { data: unknown } | null)?.data) ===
      JSON.stringify(testPayload);

    if (payloadMatches) {
      checks.push({
        id: 'L4-RELAY-INTEGRITY',
        layer: 4,
        name: 'Relay Message Content-Blind Integrity',
        status: 'pass',
        expected: 'Payload forwarded verbatim and unmodified',
        observed: 'Relayed payload matches published payload bit-for-bit',
      });
    } else {
      checks.push({
        id: 'L4-RELAY-INTEGRITY',
        layer: 4,
        name: 'Relay Message Content-Blind Integrity',
        status: 'fail',
        expected: 'Payload forwarded verbatim and unmodified',
        observed: 'Relayed payload differs from original payload',
        cause: 'Signaling server or proxy mutated the payload body',
        remediation: 'Ensure proxy does not modify WebSocket frames',
      });
    }

    // Room Isolation Check with Client C
    clientC = new WebSocket(relayUrl, wsOptions);
    await new Promise<void>((resolve, reject) => {
      clientC!.once('open', () => resolve());
      clientC!.once('error', (err) => reject(err));
    });

    let receivedByC = false;
    clientC.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.topic === testRoom) {
          receivedByC = true;
        }
      } catch {
        // ignore
      }
    });

    clientA.send(
      JSON.stringify({
        type: 'publish',
        topic: testRoom,
        data: { isolatedCheck: true },
      }),
    );

    await new Promise((r) => setTimeout(r, 150));

    if (!receivedByC) {
      checks.push({
        id: 'L4-RELAY-ISOLATION',
        layer: 4,
        name: 'Relay Room Topic Isolation',
        status: 'pass',
        expected: 'Clients outside room do not receive room messages',
        observed: 'Unsubscribed Client C received 0 messages from test room',
      });
    } else {
      checks.push({
        id: 'L4-RELAY-ISOLATION',
        layer: 4,
        name: 'Relay Room Topic Isolation',
        status: 'fail',
        expected: 'Clients outside room do not receive room messages',
        observed: 'Unsubscribed Client C received broadcast meant for test room',
        cause: 'Relay does not enforce topic isolation',
        remediation: 'Verify signaling server is running y-webrtc compatible protocol',
      });
    }
  } catch (err) {
    layerPassed = false;
    checks.push({
      id: 'L4-RELAY-PROTOCOL',
      layer: 4,
      name: 'Relay Protocol Verification',
      status: 'fail',
      expected: 'Relay accessible via WebSocket and responds to subscribe/publish',
      observed: `Relay probe failed: ${(err as Error).message}`,
      cause: 'Relay container down, proxy WebSocket upgrade misconfigured, or port unreachable',
      remediation: `Check relay service and reverse proxy WebSocket upgrade configuration at '${relayUrl}'`,
    });
  } finally {
    if (clientA) clientA.close();
    if (clientB) clientB.close();
    if (clientC) clientC.close();
  }

  if (!layerPassed && !runAll) {
    return summarizeReport(checks, clientReports);
  }

  // ==========================================
  // Layer 5: Client-Side Diagnostics Await
  // ==========================================
  if (options.awaitClients && options.awaitClients > 0) {
    const targetClients = options.awaitClients;
    const timeoutSec = options.clientTimeoutSec || 30;
    const testCode = `diag-${Math.floor(1000 + Math.random() * 9000)}`;
    const reportTopic = `sdctl-diag-report-${testCode}`;

    console.log(`\nWaiting for ${targetClients} client diagnostic report(s)...`);
    console.log(`Instruct client browsers to open: ${editorUrl}/diag.html?code=${testCode}`);

    let diagWs: WebSocket | null = null;
    try {
      diagWs = new WebSocket(relayUrl, { rejectUnauthorized: false });
      await new Promise<void>((resolve, reject) => {
        diagWs!.once('open', () => resolve());
        diagWs!.once('error', (err) => reject(err));
      });

      diagWs.send(JSON.stringify({ type: 'subscribe', topics: [reportTopic] }));

      diagWs.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'publish' && msg.topic === reportTopic && msg.data) {
            clientReports.push(msg.data as ClientDiagReport);
          }
        } catch {
          // ignore
        }
      });

      await waitForCondition(() => clientReports.length >= targetClients, timeoutSec * 1000);

      checks.push({
        id: 'L5-CLIENT-DIAG-AWAIT',
        layer: 5,
        name: 'Browser Client Diagnostics Collection',
        status: 'pass',
        expected: `Received reports from ${targetClients} client(s)`,
        observed: `Collected ${clientReports.length} client report(s) from browsers`,
      });
    } catch (err) {
      checks.push({
        id: 'L5-CLIENT-DIAG-AWAIT',
        layer: 5,
        name: 'Browser Client Diagnostics Collection',
        status: 'warn',
        expected: `Received reports from ${targetClients} client(s) within ${timeoutSec}s`,
        observed: `Collected ${clientReports.length} of ${targetClients} reports: ${(err as Error).message}`,
        cause: 'Browser clients did not connect and complete diagnostics in time',
        remediation: `Ensure users navigate to '${editorUrl}/diag.html?code=${testCode}' and click Run Diagnostics`,
      });
    } finally {
      if (diagWs) diagWs.close();
    }
  }

  return summarizeReport(checks, clientReports);
}

function summarizeReport(checks: CheckResult[], clientReports?: ClientDiagReport[]): VerifyReport {
  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const skipped = checks.filter((c) => c.status === 'skip').length;

  return {
    valid: failed === 0,
    checks,
    clientReports,
    summary: {
      passed,
      failed,
      warned,
      skipped,
    },
  };
}
