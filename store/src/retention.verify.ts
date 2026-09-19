/** WS10-R4: the retention setting. */
import { DEFAULT_RETENTION, describeRetention, parseRetentionPeriod, purgeDueAt, RetentionConfigError } from "./retention.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log("=== Parsing ===");
assert(parseRetentionPeriod(undefined).kind === "duration", `unset means the default (${DEFAULT_RETENTION})`);
assert(parseRetentionPeriod("immediate").kind === "immediate", "immediate");
assert(parseRetentionPeriod("indefinite").kind === "indefinite", "indefinite");
for (const [input, days] of [["7d", 7], ["12w", 84], ["6m", 180], ["7y", 2555]] as const) {
  const period = parseRetentionPeriod(input);
  assert(period.kind === "duration" && period.ms === days * 86_400_000, `${input} is ${days} days`);
}
assert(parseRetentionPeriod(" 30D ").kind === "duration", "spacing and case do not matter");
for (const bad of ["30", "thirty days", "0d", "-5d", "30x", ""]) {
  let threw = false;
  try {
    parseRetentionPeriod(bad);
  } catch (error) {
    threw = error instanceof RetentionConfigError;
  }
  // A typo must not silently become the default: a deployment meaning seven
  // years should never discover it kept records for thirty days.
  assert(threw, `"${bad}" is refused rather than defaulted`);
}

console.log("\n=== When purge becomes due ===");
{
  const deletedAt = new Date("2026-09-17T12:00:00Z");
  assert(purgeDueAt(parseRetentionPeriod("immediate"), deletedAt)?.getTime() === deletedAt.getTime(), "immediately, under immediate");
  assert(purgeDueAt(parseRetentionPeriod("indefinite"), deletedAt) === null, "never on its own, under indefinite");
  const due = purgeDueAt(parseRetentionPeriod("30d"), deletedAt);
  assert(due?.toISOString() === "2026-10-17T12:00:00.000Z", `thirty days later, under 30d (${due?.toISOString()})`);
}

console.log("\n=== What an operator is told ===");
for (const value of ["immediate", "30d", "indefinite"]) {
  const description = describeRetention(parseRetentionPeriod(value));
  assert(description.length > 20 && /deleted/i.test(description), `${value}: ${description}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log("\nAll retention checks passed.");
}
