/**
 * Standalone verification for sessionLink.ts. Run with:
 *
 *   npx tsx src/domain/sessionLink.verify.ts
 */
let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  } else {
    console.log("ok:", msg);
  }
}

const { createSessionLink, parseSessionLink, generateSessionKey, getBaseAppUrl } = await import("./sessionLink");

// === generateSessionKey ===
{
  const k1 = generateSessionKey();
  const k2 = generateSessionKey();
  assert(typeof k1 === "string" && k1.length >= 16, "generateSessionKey generates non-empty string key");
  assert(k1 !== k2, "generateSessionKey generates unique keys");
}

// === getBaseAppUrl ===
{
  (globalThis as unknown as { window?: { __APP_CONFIG__?: { APP_URL?: string } } }).window = {
    __APP_CONFIG__: {
      APP_URL: "https://collab.company.internal/system-design/",
    },
  };
  assert(
    getBaseAppUrl() === "https://collab.company.internal/system-design",
    "getBaseAppUrl returns sanitized runtime config URL"
  );
  (globalThis as unknown as { window?: { __APP_CONFIG__?: { APP_URL?: string } } }).window = undefined;
}

// === createSessionLink ===
{
  const link1 = createSessionLink({
    roomName: "session-12345",
    baseUrl: "https://example.com/app",
  });
  assert(link1 === "https://example.com/app#session=session-12345", "link without key or custom relay contains only session");

  const link2 = createSessionLink({
    roomName: "session-12345",
    key: "secret-key-123",
    baseUrl: "https://example.com/app",
  });
  assert(link2 === "https://example.com/app#session=session-12345&key=secret-key-123", "link with key includes key parameter");

  const link2b = createSessionLink({
    roomName: "session-12345",
    password: "compat-password",
    baseUrl: "https://example.com/app",
  });
  assert(link2b === "https://example.com/app#session=session-12345&key=compat-password", "link with password option sets key parameter for consistency");

  const link3 = createSessionLink({
    roomName: "session-12345",
    key: "k_abc",
    signalingUrlsInput: "wss://custom-relay.example.com",
    defaultSignalingUrls: "wss://default-relay.example.com",
    baseUrl: "https://example.com/app",
  });
  assert(
    link3 === "https://example.com/app#session=session-12345&key=k_abc&relay=wss%3A%2F%2Fcustom-relay.example.com",
    "link with custom relay includes relay parameter"
  );

  const link4 = createSessionLink({
    roomName: "session-12345",
    signalingUrlsInput: "wss://default-relay.example.com",
    defaultSignalingUrls: "wss://default-relay.example.com",
    baseUrl: "https://example.com/app",
  });
  assert(
    link4 === "https://example.com/app#session=session-12345",
    "link when relay matches default does not include relay parameter"
  );

  const link5 = createSessionLink({
    roomName: "session-12345",
    key: "P@ssw0rd!#$ %& emoji🔑",
    baseUrl: "https://example.com/app",
  });
  assert(
    link5.includes("key="),
    "key with special chars is encoded"
  );
  const parsed5 = parseSessionLink(link5);
  assert(
    parsed5.key === "P@ssw0rd!#$ %& emoji🔑" && parsed5.password === "P@ssw0rd!#$ %& emoji🔑",
    "encoded key with special chars and emojis roundtrips accurately"
  );
}

// === parseSessionLink ===
{
  // 1. Bare room names
  const p1 = parseSessionLink("session-abc123");
  assert(p1.roomName === "session-abc123" && p1.password === undefined && p1.relay === undefined, "bare session code parsed");

  const p2 = parseSessionLink("   session-abc123   ");
  assert(p2.roomName === "session-abc123", "whitespace trimmed for bare session code");

  // 2. Full URL with hash params (key or password)
  const p3 = parseSessionLink("https://host.com/system-design/#session=session-xyz&key=mysecret&relay=wss%3A%2F%2Frelay.org");
  assert(
    p3.roomName === "session-xyz" &&
      p3.key === "mysecret" &&
      p3.password === "mysecret" &&
      p3.relay === "wss://relay.org",
    "full URL with hash key param parsed"
  );

  const p3b = parseSessionLink("https://host.com/system-design/#session=session-xyz&password=mysecret&relay=wss%3A%2F%2Frelay.org");
  assert(
    p3b.roomName === "session-xyz" &&
      p3b.key === "mysecret" &&
      p3b.password === "mysecret" &&
      p3b.relay === "wss://relay.org",
    "full URL with hash password param parsed"
  );

  // 3. Full URL with query params
  const p4 = parseSessionLink("https://host.com/system-design/?session=session-xyz&key=mysecret");
  assert(
    p4.roomName === "session-xyz" && p4.key === "mysecret" && p4.password === "mysecret" && p4.relay === undefined,
    "full URL with query key param parsed"
  );

  // 4. Hash fragment alone
  const p5 = parseSessionLink("#session=session-xyz&key=pass123");
  assert(p5.roomName === "session-xyz" && p5.key === "pass123" && p5.password === "pass123", "hash fragment alone parsed");

  // 5. Query fragment alone
  const p6 = parseSessionLink("?session=session-xyz&key=pass123");
  assert(p6.roomName === "session-xyz" && p6.key === "pass123" && p6.password === "pass123", "query fragment alone parsed");

  // 6. Key-value string
  const p7 = parseSessionLink("session=session-xyz&key=pass123");
  assert(p7.roomName === "session-xyz" && p7.key === "pass123" && p7.password === "pass123", "raw key-value string parsed");

  // 7. Aliases (room, id, pwd, signaling)
  const p8 = parseSessionLink("#room=session-alias&pwd=alias-pass&signaling=ws%3A%2F%2Flocal%3A4444");
  assert(
    p8.roomName === "session-alias" &&
      p8.key === "alias-pass" &&
      p8.password === "alias-pass" &&
      p8.relay === "ws://local:4444",
    "aliases (room, pwd, signaling) parsed correctly"
  );

  // 8. Markdown link format
  const pMd = parseSessionLink("[Join Session](https://host.com/system-design/#session=session-md&key=md-pass&relay=wss%3A%2F%2Fmd-relay.org)");
  assert(
    pMd.roomName === "session-md" && pMd.key === "md-pass" && pMd.password === "md-pass" && pMd.relay === "wss://md-relay.org",
    "markdown link parsed correctly"
  );

  // 9. Angle bracket URL format
  const pAngle = parseSessionLink("<https://host.com/system-design/#session=session-angle&key=angle-pass&relay=wss%3A%2F%2Fangle-relay.org>");
  assert(
    pAngle.roomName === "session-angle" && pAngle.key === "angle-pass" && pAngle.password === "angle-pass" && pAngle.relay === "wss://angle-relay.org",
    "angle bracket wrapped URL parsed correctly"
  );

  // 10. Quoted URL format
  const pQuoted = parseSessionLink("\"https://host.com/system-design/#session=session-quoted&key=quoted-pass&relay=wss%3A%2F%2Fquoted-relay.org\"");
  assert(
    pQuoted.roomName === "session-quoted" && pQuoted.key === "quoted-pass" && pQuoted.password === "quoted-pass" && pQuoted.relay === "wss://quoted-relay.org",
    "quoted URL parsed correctly"
  );

  // 11. JSON object payload
  const pJson = parseSessionLink(JSON.stringify({
    session: "session-json123",
    key: "secret-json-key",
    relay: "wss://json-relay.org",
  }));
  assert(
    pJson.roomName === "session-json123" && pJson.key === "secret-json-key" && pJson.password === "secret-json-key" && pJson.relay === "wss://json-relay.org",
    "JSON object string parsed correctly"
  );

  // 12. Formatted multi-line DM text
  const pDmText = parseSessionLink(`
    Session: session-dm-multiline
    Key: dm-secret-code
    Relay: wss://dm-relay.net
  `);
  assert(
    pDmText.roomName === "session-dm-multiline" && pDmText.key === "dm-secret-code" && pDmText.password === "dm-secret-code" && pDmText.relay === "wss://dm-relay.net",
    "formatted multi-line DM text parsed correctly"
  );

  // 13. Inline DM text
  const pDmInline = parseSessionLink("Session ID: session-dm-inline, Key: inline-secret, Relay URL: wss://inline-relay.org");
  assert(
    pDmInline.roomName === "session-dm-inline" && pDmInline.key === "inline-secret" && pDmInline.password === "inline-secret" && pDmInline.relay === "wss://inline-relay.org",
    "formatted inline DM text parsed correctly"
  );

  // 14. Pipe-delimited string
  const pPipe = parseSessionLink("session-pipe123 | pipe-key | wss://pipe-relay.org");
  assert(
    pPipe.roomName === "session-pipe123" && pPipe.key === "pipe-key" && pPipe.password === "pipe-key" && pPipe.relay === "wss://pipe-relay.org",
    "pipe-separated string parsed correctly"
  );

  // 15. Empty input
  const p9 = parseSessionLink("");
  assert(p9.roomName === "", "empty input returns empty roomName");

  const p10 = parseSessionLink("   ");
  assert(p10.roomName === "", "whitespace-only input returns empty roomName");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
