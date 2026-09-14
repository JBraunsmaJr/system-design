/**
 * WS13-R8, WS13-R9, WS13-R11, WS2-R4, NFR-10.
 *
 * Every case here is about precedence. The bug this guards against is a
 * reassuring label shown while writes are failing, which is the state the
 * previous single-slot autosave left users in with no indication at all.
 */
import {
  deriveDurability,
  isSoleReplicaHolder,
  type DurabilitySignals,
} from "./durability.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const base: DurabilitySignals = { localPersistence: "active" };

console.log("=== A failure outranks every reassuring signal ===");
{
  const everythingGood: DurabilitySignals = {
    localPersistence: "active",
    fileBacked: true,
    serverSync: "synced",
    replicaCount: 5,
  };
  const withQuota = deriveDurability({
    ...everythingGood,
    storageFailure: { reason: "quota", message: "no space" },
  });
  assert(
    withQuota.level === "at-risk" && withQuota.tone === "alert",
    "a quota failure wins over file-backed, synced and five replicas",
  );
  assert(
    withQuota.persistent,
    "and it cannot be dismissed - the user has to act on it",
  );
  assert(
    withQuota.action === "export",
    "the offered action is the one that actually saves the work",
  );
  assert(
    /export a copy/i.test(withQuota.detail),
    "the message says what to do rather than describing the error (WS2-R4)",
  );
}

console.log("=== Unavailable storage reads as not saving, not as saved ===");
{
  const denied = deriveDurability({ localPersistence: "unavailable" });
  assert(denied.level === "at-risk", "private browsing reports at-risk");
  assert(
    denied.persistent && denied.action === "export",
    "and offers an export, because nothing else will preserve the work",
  );

  const alsoFileBacked = deriveDurability({
    localPersistence: "unavailable",
    fileBacked: true,
  });
  assert(
    alsoFileBacked.level === "at-risk",
    "unavailable storage still wins even with a file attached - NFR-10 means " +
      "the lower level is the honest one when signals disagree",
  );
}

console.log("=== A blocked autosave surfaces its own reason ===");
{
  const blocked = deriveDurability({
    ...base,
    autosaveBlockedReason: "The draft was written by a newer version.",
  });
  assert(blocked.level === "at-risk", "a blocked autosave is at-risk");
  assert(
    blocked.detail.includes("newer version"),
    "the specific reason is shown, not a generic message",
  );
}

console.log("=== Loading is never reported as saved ===");
{
  const loading = deriveDurability({ localPersistence: "loading" });
  assert(loading.level === "loading", "while loading, durability is unknown");
  assert(loading.tone === "caution", "and is not presented as reassuring");
}

console.log("=== Ordinary states ===");
{
  assert(
    deriveDurability(base).level === "local",
    "browser storage alone reports local",
  );
  assert(
    deriveDurability({ ...base, fileBacked: true }).level === "file",
    "a file-backed document reports file",
  );
  assert(
    deriveDurability({ ...base, serverSync: "synced" }).level === "synced",
    "a synced document reports synced",
  );
  assert(
    deriveDurability({ ...base, fileBacked: false }).action === "choose-file",
    "browser-only storage offers to attach a file",
  );
}

console.log("=== Offline queue is described in the user's terms ===");
{
  const offline = deriveDurability({
    ...base,
    serverSync: "offline",
    pendingUpdates: 7,
  });
  assert(offline.tone === "caution", "offline is a caution, not an alert");
  assert(
    offline.detail.includes("7"),
    "the queued count is shown so a week offline is legible (WS8-R12)",
  );
  assert(
    /saved on this device/i.test(offline.detail),
    "and it reassures that the work is not lost, only unsynced",
  );

  const one = deriveDurability({
    ...base,
    serverSync: "offline",
    pendingUpdates: 1,
  });
  assert(
    one.detail.includes("1 change is"),
    "a single queued change is not described as '1 changes'",
  );

  const none = deriveDurability({ ...base, serverSync: "offline" });
  assert(
    !/\d/.test(none.detail),
    "with nothing queued, no count is invented",
  );
}

console.log("=== Replica count (WS13-R9) ===");
{
  const alone = deriveDurability({ ...base, replicaCount: 1 });
  assert(
    /only person/i.test(alone.detail),
    "being the sole holder is stated plainly",
  );
  const crowd = deriveDurability({ ...base, replicaCount: 4 });
  assert(crowd.detail.includes("4"), "otherwise the number of copies is shown");
  assert(
    !/only person/i.test(deriveDurability(base).detail),
    "outside a session, nothing is claimed about other people",
  );
}

console.log("=== Sole replica holder gate (WS13-R11) ===");
{
  assert(
    isSoleReplicaHolder({ ...base, replicaCount: 1 }),
    "the only holder in a session is warned before leaving",
  );
  assert(
    !isSoleReplicaHolder({ ...base, replicaCount: 3 }),
    "someone whose copy is not the only one is not warned",
  );
  assert(
    !isSoleReplicaHolder({ ...base, replicaCount: 1, serverSync: "synced" }),
    "nobody is warned when the server already has it",
  );
  assert(
    !isSoleReplicaHolder({ ...base, replicaCount: 1, fileBacked: true }),
    "nor when the work is already on disk in a file the user chose",
  );
  assert(
    !isSoleReplicaHolder({ localPersistence: "unavailable", replicaCount: 1 }),
    "someone whose storage is denied holds no replica to lose",
  );
  assert(
    isSoleReplicaHolder({ ...base, replicaCount: 0 }),
    "a session reporting no replicas still warns - erring toward warning",
  );
}

console.log("=== Every state has usable copy ===");
{
  const cases: DurabilitySignals[] = [
    base,
    { localPersistence: "loading" },
    { localPersistence: "unavailable" },
    { ...base, fileBacked: true },
    { ...base, serverSync: "synced" },
    { ...base, serverSync: "offline" },
    { ...base, serverSync: "pending" },
    { ...base, storageFailure: { reason: "quota", message: "x" } },
    { ...base, autosaveBlockedReason: "because" },
  ];
  assert(
    cases.every((c) => {
      const s = deriveDurability(c);
      return (
        s.label.length > 0 &&
        s.label.length <= 16 &&
        s.detail.length > 0 &&
        s.label[0] === s.label[0].toUpperCase()
      );
    }),
    "every state yields a chip-length sentence-case label and a detail line",
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} durability check(s) failed`);
}
console.log("\nAll durability checks passed.");
