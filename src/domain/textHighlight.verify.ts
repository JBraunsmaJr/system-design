/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/textHighlight.verify.ts
 */
import { splitByHighlight, computeTruncationWithHighlight } from "./textHighlight";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
    console.error(`FAIL: ${message}`);
  }
}

console.log("=== splitByHighlight ===");
{
  const segs = splitByHighlight("Hello World, hello universe", "hello");
  assert(segs.length === 4, `splits into 4 segments: got ${segs.length}`);
  assert(segs[0].text === "Hello" && segs[0].isMatch, "first match 'Hello'");
  assert(segs[1].text === " World, " && !segs[1].isMatch, "middle text");
  assert(segs[2].text === "hello" && segs[2].isMatch, "second match 'hello'");
  assert(segs[3].text === " universe" && !segs[3].isMatch, "trailing text");
}

{
  const empty = splitByHighlight("Just some text", "");
  assert(empty.length === 1 && empty[0].text === "Just some text" && !empty[0].isMatch, "empty query gives single non-matching segment");
}

{
  const noMatch = splitByHighlight("Just some text", "xyz");
  assert(noMatch.length === 1 && noMatch[0].text === "Just some text" && !noMatch[0].isMatch, "no match gives single non-matching segment");
}

console.log("\n=== computeTruncationWithHighlight ===");
// Measure by character count for pure unit tests
const charMeasure = (s: string) => s.length;

// Case 1: Fits entirely without truncation
{
  const res = computeTruncationWithHighlight("Short title", "title", 50, charMeasure);
  assert(!res.isTruncated, "not truncated when it fits available width");
  assert(res.visibleText === "Short title", "visibleText is full text");
  assert(res.hasMatchInVisible, "has match in visible text");
  assert(!res.hasMatchInTruncated, "no match in truncated");
}

// Case 2: Truncated, match is only in visible part
{
  // availableWidth = 20, "..." takes 3 chars, so targetWidth = 17 chars fits "User authenticati"
  const title = "User authentication with OAuth2 and SAML";
  const res = computeTruncationWithHighlight(title, "User", 20, charMeasure);
  assert(res.isTruncated, "is truncated");
  assert(res.visibleText === "User authenticati", `visible text is truncated: ${res.visibleText}`);
  assert(res.hasMatchInVisible, "has match in visible");
  assert(!res.hasMatchInTruncated, "no match in truncated");
}

// Case 3: Truncated, match is only after the ...
{
  const title = "User authentication with OAuth2 and SAML";
  const res = computeTruncationWithHighlight(title, "SAML", 20, charMeasure);
  assert(res.isTruncated, "is truncated");
  assert(res.visibleText === "User authenticati", "visible text prefix");
  assert(!res.hasMatchInVisible, "no match in visible");
  assert(res.hasMatchInTruncated, "has match in truncated (after the ...)");
}

// Case 4: Truncated, matches both in visible part and after the ...
{
  const title = "Auth service with Auth token verification";
  const res = computeTruncationWithHighlight(title, "Auth", 20, charMeasure);
  assert(res.isTruncated, "is truncated");
  assert(res.hasMatchInVisible, "has match in visible");
  assert(res.hasMatchInTruncated, "has match in truncated (after the ...)");
}

// Case 5: Truncated, match straddles across truncation boundary
{
  const title = "User authentication with OAuth2";
  // cutIndex will fall in the middle of "authentication"
  // e.g. targetWidth = 10 -> visibleText = "User authe"
  const res = computeTruncationWithHighlight(title, "authentication", 13, charMeasure);
  assert(res.isTruncated, "is truncated");
  assert(res.visibleText === "User authe", `visibleText: ${res.visibleText}`);
  assert(res.hasMatchInVisible, "straddling match is in visible");
  assert(res.hasMatchInTruncated, "straddling match also extends into truncated (after ...)");
}

// Case 6: Truncated, query does not match title at all
{
  const title = "User authentication with OAuth2";
  const res = computeTruncationWithHighlight(title, "Database", 20, charMeasure);
  assert(res.isTruncated, "is truncated");
  assert(!res.hasMatchInVisible, "no match in visible");
  assert(!res.hasMatchInTruncated, "no match in truncated");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
