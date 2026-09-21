/**
 * Starts a signaling relay and an instrumented Vite dev server for a browser
 * verification script, and stops them again.
 *
 * Mirrors the setup in verify-session-link.ts. Kept in lib/ so the test runner
 * (which picks up scripts/verify-*.ts) does not treat it as a suite.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { connect } from 'net';

function tryConnect(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((res) => {
    const socket = connect({ host, port });
    socket.setTimeout(1000);
    const done = (ok: boolean) => {
      socket.destroy();
      res(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Resolves once either loopback family accepts on `port` - see
 * verify-session-link.ts for why both are probed. */
export async function waitForPort(port: number, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const results = await Promise.all([tryConnect('127.0.0.1', port), tryConnect('::1', port)]);
    if (results.some(Boolean)) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for port ${port}`);
    await new Promise((res) => setTimeout(res, 250));
  }
}

export interface DevServers {
  appUrl: string;
  relayUrl: string;
  stop(): void;
}

export async function startDevServers(options: {
  vitePort: number;
  signalingPort: number;
  quiet?: boolean;
}): Promise<DevServers> {
  // A server already on either port would be measured instead of this
  // checkout's - and silently, since waitForPort cannot tell them apart. That
  // is exactly how a previous run's leftover Vite made this suite pass against
  // code that was not in the working tree.
  for (const port of [options.vitePort, options.signalingPort]) {
    const busy = (await Promise.all([tryConnect('127.0.0.1', port), tryConnect('::1', port)])).some(
      Boolean,
    );
    if (busy)
      throw new Error(`Port ${port} is already in use. Stop whatever is serving it and re-run.`);
  }
  const children: ChildProcess[] = [];
  const pipe = (child: ChildProcess, tag: string) => {
    if (options.quiet) return;
    child.stdout?.on('data', (d) => process.stdout.write(`[${tag}] ${d}`));
    child.stderr?.on('data', (d) => process.stderr.write(`[${tag}] ${d}`));
  };

  // Each child leads its own process group so stop() can take down the whole
  // tree: with shell: true, killing the child kills only the shell and leaves
  // Vite running on the port.
  const signaling = spawn(process.execPath, ['node_modules/y-webrtc/bin/server.js'], {
    env: { ...process.env, PORT: String(options.signalingPort) },
    detached: process.platform !== 'win32',
  });
  pipe(signaling, 'signaling');
  children.push(signaling);

  // VITE_PERF_INSTRUMENTATION=1 defines window.__PERF__, which these scripts
  // use to load fixtures and navigate - never rely on a local .env for it.
  const vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--port', String(options.vitePort), '--strictPort'],
    {
      env: { ...process.env, VITE_PERF_INSTRUMENTATION: '1' },
      detached: process.platform !== 'win32',
    },
  );
  pipe(vite, 'vite');
  children.push(vite);

  const stop = () => {
    for (const child of children) {
      if (child.pid === undefined) continue;
      if (process.platform === 'win32') {
        try {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          child.kill();
        }
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill();
        }
      }
    }
  };
  try {
    await Promise.all([waitForPort(options.signalingPort), waitForPort(options.vitePort)]);
  } catch (err) {
    stop();
    throw err;
  }
  return {
    appUrl: `http://localhost:${options.vitePort}`,
    relayUrl: `ws://localhost:${options.signalingPort}`,
    stop,
  };
}
