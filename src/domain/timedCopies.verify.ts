/**
 * WS13-R6 - timed copies: settings, naming, and when a copy is due.
 */
import { parseTimedCopies, timedCopyFileName, isCopyDue, DEFAULT_TIMED_COPIES } from "./timedCopies.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log("=== Settings ===");
assert(!parseTimedCopies(null).enabled, "off unless turned on");
assert(JSON.stringify(parseTimedCopies('{"enabled":true,"minutes":10}')) === '{"enabled":true,"minutes":10}', "a valid setting is kept");
assert(!parseTimedCopies('{"enabled":"yes","minutes":10}').enabled, "only a literal true enables it");
for (const bad of ['{"enabled":true,"minutes":0}', '{"enabled":true,"minutes":999}', '{"enabled":true,"minutes":"5"}', "not json"]) {
  const parsed = parseTimedCopies(bad);
  assert(parsed.minutes === DEFAULT_TIMED_COPIES.minutes, `an invalid interval falls back to the default (${bad})`);
}
assert(parseTimedCopies("not json").enabled === false, "an unreadable setting never enables copies");

console.log("\n=== Naming ===");
const at = new Date(2026, 8, 17, 9, 5, 3);
assert(timedCopyFileName("Payments: v2 / draft", at) === "payments-v2-draft-2026-09-17T09-05-03.json", "safe, sortable and timestamped");
assert(timedCopyFileName("   ", at).startsWith("diagram-"), "an empty title still names the file");
assert(timedCopyFileName("A", at) !== timedCopyFileName("A", new Date(at.getTime() + 1000)), "copies a second apart do not collide");

console.log("\n=== When a copy is due ===");
assert(isCopyDue("{a}", null), "the first copy is always due");
assert(!isCopyDue("{a}", "{a}"), "an unchanged document is not copied again");
assert(isCopyDue("{b}", "{a}"), "a changed document is");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log("\nAll timed copy checks passed.");
}
