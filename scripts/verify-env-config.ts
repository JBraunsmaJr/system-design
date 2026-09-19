import { execFileSync } from "child_process";
import { readFileSync, rmSync } from "fs";
import vm from "vm";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function runScript(env: Record<string, string>): { code: number; stdout: string; stderr: string; targetContent?: string } {
  const targetFile = `.temp-env-config-${Math.random().toString(36).slice(2)}.js`;
  const exportStatements = Object.entries(env)
    .map(([k, v]) => {
      const escaped = v
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
      return `export ${k}=$'${escaped}'`;
    })
    .join("; ");

  try {
    const cmd = `${exportStatements ? exportStatements + "; " : ""}TARGET_FILE='${targetFile}' bash docker/docker-entrypoint.d/40-env-config.sh`;
    const stdout = execFileSync("bash", ["-c", cmd], {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const targetContent = readFileSync(targetFile, "utf-8");
    return { code: 0, stdout, stderr: "", targetContent };
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: execErr.status ?? 1,
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? (execErr.message ?? ""),
    };
  } finally {
    try {
      rmSync(targetFile, { force: true });
    } catch {}
  }
}

function evaluateConfig(jsContent: string): Record<string, string> {
  const context: { window: { __APP_CONFIG__?: Record<string, string> } } = { window: {} };
  vm.createContext(context);
  vm.runInContext(jsContent, context);
  assert(!!context.window.__APP_CONFIG__, "window.__APP_CONFIG__ must be defined");
  return context.window.__APP_CONFIG__!;
}

console.log("Testing 40-env-config.sh entrypoint script...\n");

// Test 1: Empty environment defaults
{
  const res = runScript({
    RELAY: "",
    RELAY_URL: "",
    SIGNALING_URL: "",
    VITE_SIGNALING_URL: "",
    VITE_RELAY_URL: "",
    VITE_RELAY: "",
    APP_URL: "",
    STORE_URL: "",
    BASE_URL: "",
    VITE_APP_URL: "",
    VITE_BASE_URL: "",
    ICE_SERVERS: "",
    VITE_ICE_SERVERS: "",
  });
  if (res.code !== 0) {
    console.error("Test 1 failed with stderr:", res.stderr, "stdout:", res.stdout);
  }
  assert(res.code === 0, "Empty environment runs successfully");
  const config = evaluateConfig(res.targetContent!);
  assert(config.SIGNALING_URL === "", "SIGNALING_URL is empty by default");
  assert(config.RELAY_URL === "", "RELAY_URL is empty by default");
  assert(config.RELAY === "", "RELAY is empty by default");
  assert(config.APP_URL === "", "APP_URL is empty by default");
  assert(config.BASE_URL === "", "BASE_URL is empty by default");
  assert(config.ICE_SERVERS === "", "ICE_SERVERS is empty by default");
  console.log("✓ Empty environment defaults passed");
}

// Test 2: Standard env vars
{
  const res = runScript({
    RELAY: "wss://relay.example.com",
    APP_URL: "https://app.example.com/subpath",
    ICE_SERVERS: "stun:stun.example.com:3478",
  });
  if (res.code !== 0) {
    console.error("Test 2 failed with stderr:", res.stderr, "stdout:", res.stdout);
  }
  assert(res.code === 0, "Standard env vars run successfully");
  const config = evaluateConfig(res.targetContent!);
  assert(config.SIGNALING_URL === "wss://relay.example.com", "SIGNALING_URL set correctly");
  assert(config.RELAY === "wss://relay.example.com", "RELAY set correctly");
  assert(config.APP_URL === "https://app.example.com/subpath", "APP_URL set correctly");
  assert(config.BASE_URL === "https://app.example.com/subpath", "BASE_URL set correctly");
  assert(config.ICE_SERVERS === "stun:stun.example.com:3478", "ICE_SERVERS set correctly");
  console.log("✓ Standard environment variables passed");
}

// Test 3: Fallback priority
{
  const res = runScript({
    VITE_RELAY_URL: "wss://fallback-relay.example.com",
    VITE_BASE_URL: "https://fallback-app.example.com",
    VITE_ICE_SERVERS: "stun:fallback.example.com:3478",
  });
  if (res.code !== 0) {
    console.error("Test 3 failed with stderr:", res.stderr, "stdout:", res.stdout);
  }
  assert(res.code === 0, "Fallback env vars run successfully");
  const config = evaluateConfig(res.targetContent!);
  assert(config.SIGNALING_URL === "wss://fallback-relay.example.com", "SIGNALING_URL fallback works");
  assert(config.APP_URL === "https://fallback-app.example.com", "APP_URL fallback works");
  assert(config.ICE_SERVERS === "stun:fallback.example.com:3478", "ICE_SERVERS fallback works");
  console.log("✓ Fallback priority passed");
}

// Test 4: Carriage return characters in env vars (e.g. from Windows CRLF .env files)
{
  const res = runScript({
    RELAY: "wss://crlf-relay.example.com\r",
    APP_URL: "https://crlf-app.example.com\r\r",
    ICE_SERVERS: "stun:crlf-stun.example.com\r",
  });
  if (res.code !== 0) {
    console.error("Test 4 failed with stderr:", res.stderr, "stdout:", res.stdout);
  }
  assert(res.code === 0, "Carriage return in env values is accepted without error");
  const config = evaluateConfig(res.targetContent!);
  assert(config.SIGNALING_URL === "wss://crlf-relay.example.com", "CR stripped from SIGNALING_URL");
  assert(config.APP_URL === "https://crlf-app.example.com", "CR stripped from APP_URL");
  assert(config.ICE_SERVERS === "stun:crlf-stun.example.com", "CR stripped from ICE_SERVERS");
  console.log("✓ Carriage-return stripping passed");
}

// Test 5: JS string escaping (quotes and backslashes)
{
  const res = runScript({
    RELAY: `wss://relay.example.com/"test"\\path`,
    APP_URL: `https://app.example.com/test\\"quote"`,
    ICE_SERVERS: `[{"urls":"stun:stun.l.google.com:19302"}]`,
  });
  if (res.code !== 0) {
    console.error("Test 5 failed with stderr:", res.stderr, "stdout:", res.stdout);
  }
  assert(res.code === 0, "Escaping quotes and backslashes runs successfully");
  const config = evaluateConfig(res.targetContent!);
  assert(config.SIGNALING_URL === `wss://relay.example.com/"test"\\path`, "Quotes and backslashes preserved");
  assert(config.APP_URL === `https://app.example.com/test\\"quote"`, "Quotes and backslashes preserved in APP_URL");
  assert(config.ICE_SERVERS === `[{"urls":"stun:stun.l.google.com:19302"}]`, "JSON string escaped and parsed cleanly");
  console.log("✓ JavaScript string escaping passed");
}

// Test 6: Rejection of unescaped line feeds (\n)
{
  const res = runScript({
    RELAY: "wss://relay.example.com\ninvalid",
  });
  assert(res.code !== 0, "Line-feed in env values triggers non-zero exit code");
  assert(res.stderr.includes("line-feed"), "Error message mentions line-feed characters");
  console.log("✓ Line-feed rejection passed");
}

console.log("\nAll 40-env-config.sh tests passed successfully!");
