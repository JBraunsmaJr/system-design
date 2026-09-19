/**
 * The store as a process (WS8-R9).
 *
 * Starts the real entry point the container runs, and checks it comes up,
 * serves, and shuts down cleanly - and that a misconfigured one refuses to
 * start with a sentence an operator can act on rather than a stack trace.
 */
import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const root = resolve(".");
const PORT = Number(process.env.STORE_TEST_PORT ?? 8099);

function start(env: Record<string, string>): { child: ChildProcess; output: () => string; exit: Promise<number> } {
  const child = spawn(process.execPath, ["--experimental-strip-types", "store/src/main.ts"], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => (output += String(chunk)));
  child.stderr?.on("data", (chunk) => (output += String(chunk)));
  const exit = new Promise<number>((resolveExit) => child.on("exit", (code) => resolveExit(code ?? -1)));
  return { child, output: () => output, exit };
}

async function waitForHealth(port: number, timeoutMs = 20000): Promise<Response | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`);
      if (response.ok) return response;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

console.log("=== It starts, serves, and stops ===");
{
  const running = start({
    PORT: String(PORT),
    PUBLIC_URL: `http://localhost:${PORT}`,
    ALLOW_UNAUTHENTICATED: "true",
    RETENTION_PERIOD: "7y",
    ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
  });
  const health = await waitForHealth(PORT);
  check(health !== null, "the process comes up and serves /v1/health");
  if (health) {
    const body = (await health.json()) as { status: string; cryptoMode: string; authentication: string };
    check(body.status === "ok" && body.cryptoMode === "webcrypto", "reporting its mode");
    check(body.authentication === "none", "and that this one has no sign-in, which it was told to allow");
  }
  const printed = running.output();
  check(/Deleted documents are kept.*7y/.test(printed), `startup prints the retention it will apply (${/(Deleted documents[^\n]*)/.exec(printed)?.[1] ?? "nothing"})`);
  check(/Sign-in: NONE/.test(printed), "and says plainly that it has no sign-in");
  check(
    process.env.DATABASE_URL ? /Storage: PostgreSQL/.test(printed) : /Storage: in memory/.test(printed),
    "and which storage it is using"
  );

  running.child.kill("SIGTERM");
  const code = await running.exit;
  check(code === 0, `SIGTERM shuts it down cleanly (exit ${code})`);
  check(/shutting down/.test(running.output()), "saying so");
}

console.log("\n=== It refuses to start badly configured ===");
{
  const cases: [string, Record<string, string>, RegExp][] = [
    ["with no public address", { PORT: String(PORT + 1), ALLOW_UNAUTHENTICATED: "true" }, /PUBLIC_URL is required/],
    ["with no sign-in configured", { PORT: String(PORT + 1), PUBLIC_URL: `http://localhost:${PORT + 1}` }, /No sign-in is configured/],
    [
      "with a cross-origin editor over plain HTTP",
      {
        PORT: String(PORT + 1),
        PUBLIC_URL: "http://store.example.gov",
        ALLOWED_ORIGINS: "http://design.example.gov",
        ALLOW_UNAUTHENTICATED: "true",
      },
      /HTTPS/,
    ],
    [
      "with an unparseable retention period",
      { PORT: String(PORT + 1), PUBLIC_URL: `http://localhost:${PORT + 1}`, ALLOW_UNAUTHENTICATED: "true", RETENTION_PERIOD: "forever-ish" },
      /Unrecognised retention period/,
    ],
  ];
  for (const [description, env, expected] of cases) {
    const attempt = start(env);
    const code = await attempt.exit;
    const printed = attempt.output();
    check(code === 2 && expected.test(printed), `${description}: exits 2 with an explanation`);
    check(!/at Object|\.ts:\d+:\d+/.test(printed), `${description}: and no stack trace`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll store startup checks passed.");
