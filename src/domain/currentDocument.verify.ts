/**
 * WS2-R3 - which document a tab opens, and how that is carried in the URL.
 */
import {
  resolveDocumentId,
  readDocumentParam,
  withDocumentParam,
  isValidDocumentId,
  sessionDocumentId,
  DEFAULT_DOCUMENT_ID,
} from "./currentDocument.ts";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log("=== Resolution order ===");
assert(resolveDocumentId({ urlDocId: "abc", lastDocId: "def" }).docId === "abc", "the URL wins, so each tab keeps its own document");
assert(resolveDocumentId({ urlDocId: null, lastDocId: "def" }).source === "last-opened", "a bare URL reopens the last document");
assert(
  resolveDocumentId({ urlDocId: null, lastDocId: null }).docId === DEFAULT_DOCUMENT_ID && DEFAULT_DOCUMENT_ID === "local",
  "with neither, the pre-existing 'local' document - so existing work opens without migration"
);
assert(resolveDocumentId({ urlDocId: "../../x", lastDocId: "ok-1" }).docId === "ok-1", "an invalid URL id is ignored, not trusted");
assert(resolveDocumentId({ urlDocId: "", lastDocId: "" }).docId === "local", "empty values count as absent");

console.log("\n=== Validation ===");
for (const bad of ["", "a b", "a/b", "<x>", "-leading", "x".repeat(129), 42, null]) {
  assert(!isValidDocumentId(bad), `rejects ${JSON.stringify(bad)?.slice(0, 20)}`);
}
for (const good of ["local", "3f2b1c9e-8a7d-4c1e-9f00-123456789abc", "session:room_1", "doc-lx9.abc"]) {
  assert(isValidDocumentId(good), `accepts ${good}`);
}

console.log("\n=== URL handling ===");
const base = "https://example.test/system-design/";
const withSession = `${base}#session=session-abc&key=k&relay=ws%3A%2F%2Fx`;
const set = withDocumentParam(withSession, "alpha");
assert(readDocumentParam(set) === "alpha", "the document id is written to the query string");
assert(new URL(set).hash === new URL(withSession).hash, "a session link in the hash is preserved exactly");
assert(withDocumentParam(set, "alpha") === set, "already correct: returned unchanged (no history write)");
assert(readDocumentParam(withDocumentParam(`${base}?view=timeline`, "b")) === "b" && new URL(withDocumentParam(`${base}?view=timeline`, "b")).searchParams.get("view") === "timeline", "other query parameters survive");
assert(readDocumentParam("not a url") === null && withDocumentParam("not a url", "x") === "not a url", "a malformed href is left alone");

console.log("\n=== Session replica ids ===");
assert(sessionDocumentId("session-abc123") === "session:session-abc123", "derived from the room, so rejoining updates one entry");
assert(isValidDocumentId(sessionDocumentId("weird room/name?x")), "and always a valid id, whatever the room name");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log("\nAll current-document checks passed.");
}
