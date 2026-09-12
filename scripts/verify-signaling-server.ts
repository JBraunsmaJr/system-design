/**
 * Verifies the signaling server's own rendezvous protocol - the one
 * piece of the WebRTC transport layer that's genuinely testable without
 * a real browser. Run with:
 *
 *   npx tsx scripts/verify-signaling-server.ts
 *
 * Lives outside src/ deliberately, not alongside the other stores'
 * verify scripts - this one genuinely needs Node's own process/network
 * APIs (spawning the signaling server as a subprocess, talking to it
 * over a real WebSocket) to do its job, unlike the pure-yjs-logic
 * verify scripts in src/collab/, which run against browser-compatible
 * code with no Node-specific APIs involved. src/'s own tsconfig has no
 * Node types configured (correctly, since none of the actual app code
 * should ever use them) - this lives here for the same reason
 * vite.config.ts does, rather than requiring a project config change to
 * carve out an exception.
 *
 * This does NOT verify actual WebRTC peer-to-peer data flow between two
 * browser tabs - that's a browser API (RTCPeerConnection) with no
 * equivalent in plain Node, and needs manual verification in a real
 * browser before being treated as proven. See src/collab/session.ts's
 * own doc comment for the full explanation of where that line falls.
 *
 * What this DOES prove, against the real, unmodified signaling server
 * y-webrtc ships (node_modules/y-webrtc/bin/server.js, run exactly as a
 * self-hoster would run it): the topic-based subscribe/publish
 * rendezvous mechanism actually works, a published message reaches
 * every OTHER subscriber of the same room and no one outside it, and
 * the relayed payload arrives unmodified - confirming the server really
 * is the content-blind relay its own source suggests, not just assumed
 * to be from reading the code.
 */
import { spawn, type ChildProcess } from "child_process";
import WebSocket from "ws";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok:", msg);
  }
}

function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout waiting for condition"));
      setTimeout(check, 20);
    };
    check();
  });
}

const PORT = 14444;
let server: ChildProcess | null = null;

// Hard safety net regardless of what happens below - a hung WebSocket
// connection or an unresolved promise should never be able to leave a
// process (or the spawned server) running indefinitely.
const hardExit = setTimeout(() => {
  console.error("HARD TIMEOUT - forcing exit");
  server?.kill("SIGKILL");
  process.exit(1);
}, 8000);

try {
  server = spawn("node", ["node_modules/y-webrtc/bin/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
  });
  let ready = false;
  server.stdout?.on("data", (d) => {
    if (d.toString().includes("Signaling server running")) ready = true;
  });

  await waitFor(() => ready);
  assert(true, "the real, unmodified signaling server (y-webrtc's own bin/server.js) starts and reports ready");

  const clientA = new WebSocket(`ws://localhost:${PORT}`);
  const clientB = new WebSocket(`ws://localhost:${PORT}`);
  await Promise.all([
    new Promise((res) => clientA.on("open", res)),
    new Promise((res) => clientB.on("open", res)),
  ]);
  assert(true, "two independent WebSocket clients connect to the signaling server");

  const ROOM = "verify-room-xyz";
  clientA.send(JSON.stringify({ type: "subscribe", topics: [ROOM] }));
  clientB.send(JSON.stringify({ type: "subscribe", topics: [ROOM] }));

  let receivedByB: { data: unknown } | null = null;
  clientB.on("message", (raw: { toString: () => string }) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "publish") receivedByB = msg;
  });

  await new Promise((res) => setTimeout(res, 200)); // let subscriptions land

  // Structurally similar to what y-webrtc itself actually sends (an SDP
  // offer/answer or ICE candidate) - the point is the server never
  // inspects or cares what this payload means, it just relays it.
  const opaquePayload = { sdp: "v=0\r\no=- fake-session-id ...", type: "offer" };
  clientA.send(JSON.stringify({ type: "publish", topic: ROOM, data: opaquePayload }));

  await waitFor(() => receivedByB !== null);
  assert(true, "a message published by client A to the shared room is received by client B, who's subscribed to the same room");
  assert(
    JSON.stringify((receivedByB as { data: unknown } | null)?.data) === JSON.stringify(opaquePayload),
    "the relayed payload arrives at client B completely unmodified - confirming the server is genuinely content-blind, just forwarding whatever bytes it's given by topic"
  );

  const clientC = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise((res) => clientC.on("open", res));
  let receivedByC = false;
  clientC.on("message", () => {
    receivedByC = true;
  });
  clientA.send(JSON.stringify({ type: "publish", topic: ROOM, data: { second: "message" } }));
  await new Promise((res) => setTimeout(res, 200));
  assert(!receivedByC, "a client NOT subscribed to the room receives nothing from it - topic-based isolation works, rooms don't leak into each other");

  clientA.close();
  clientB.close();
  clientC.close();
} catch (err) {
  console.error("FAIL:", (err as Error).message);
  failures++;
} finally {
  clearTimeout(hardExit);
  server?.kill("SIGKILL");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
