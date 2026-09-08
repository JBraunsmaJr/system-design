/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/iceServerConfig.verify.ts
 */
import { parseIceServers, NO_ICE_SERVERS } from "./iceServerConfig";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// === Part 1: unconfigured means "leave the defaults alone" ===
// undefined and [] are NOT interchangeable here. undefined tells the
// caller to omit peerOpts entirely so simple-peer keeps its own public
// STUN servers; [] means an explicit, deliberate empty list. Collapsing
// them would silently turn "I didn't configure this" into "use no ICE
// servers at all", which changes behavior on every ordinary network.
{
  assert(parseIceServers(null) === undefined, "never configured returns undefined, not an empty list");
  assert(parseIceServers(undefined) === undefined, "an absent value returns undefined");
  assert(parseIceServers("") === undefined, "an empty string returns undefined - an unset VITE_ICE_SERVERS arrives as \"\"");
  assert(parseIceServers("   ") === undefined, "whitespace only returns undefined");
}

// === Part 2: the explicit "none" token ===
// The case an isolated network needs, and the reason a token exists at
// all: an empty string can't express it, because an unset env var and a
// deliberately-emptied one are both "" by the time they get here.
{
  const result = parseIceServers(NO_ICE_SERVERS);
  assert(Array.isArray(result) && result.length === 0, "\"none\" returns an EMPTY ARRAY - host candidates only, no waiting on unreachable public STUN");
  assert(parseIceServers("NONE")?.length === 0, "the token is case-insensitive");
  assert(parseIceServers("  none  ")?.length === 0, "and tolerates surrounding whitespace");
}

// === Part 3: a plain STUN server ===
{
  const result = parseIceServers("stun:stun.internal:3478");
  assert(result?.length === 1 && result[0].urls === "stun:stun.internal:3478", "a single STUN URL parses to one server entry");
  assert(result?.[0].username === undefined, "with no credentials attached");
}

// === Part 4: TURN with credentials ===
// The case that makes this feature worth having - TURN essentially
// always needs authentication, so a format that couldn't carry
// credentials would be useless for the deployments this exists for.
{
  const result = parseIceServers("turn:turn.internal:3478|alice|s3cret");
  assert(result?.length === 1, "a TURN entry with credentials parses to one server");
  assert(result?.[0].urls === "turn:turn.internal:3478", "the URL excludes the credential portion");
  assert(result?.[0].username === "alice", "the username is picked up");
  assert(result?.[0].credential === "s3cret", "and the credential");
}

// === Part 5: multiple servers, mixed forms ===
{
  const result = parseIceServers("stun:stun.internal:3478, turn:turn.internal:3478|bob|pw");
  assert(result?.length === 2, "comma-separated entries each become a server, matching how signaling URLs are already configured");
  assert(result?.[0].username === undefined && result?.[1].username === "bob", "credentials attach only to the entry that declared them");
  assert(result?.[1].urls === "turn:turn.internal:3478", "surrounding whitespace is trimmed from each entry");
}

// === Part 6: a half-specified credential is ignored ===
// RTCPeerConnection rejects a server carrying a username without a
// credential, so accepting one here would just defer the failure to
// connection time, where it's far harder to trace back to a typo.
{
  const result = parseIceServers("turn:turn.internal:3478|alice");
  assert(result?.length === 1 && result[0].urls === "turn:turn.internal:3478", "the server itself is still kept");
  assert(result?.[0].username === undefined && result?.[0].credential === undefined, "but a username with no credential is dropped rather than passed through to fail later");
}

// === Part 7: stray separators don't produce bogus entries ===
{
  const result = parseIceServers("stun:a.internal:3478,,  , stun:b.internal:3478,");
  assert(result?.length === 2, "empty entries from doubled or trailing commas are dropped, same as parseSignalingUrls");
}

// === Part 8: entirely malformed input falls back to undefined ===
// Important that this is undefined and not []: a typo that produced no
// usable servers should leave the working defaults in place, not
// silently disable ICE for everyone.
{
  assert(parseIceServers(",,,") === undefined, "input with no usable URL at all is treated as unconfigured, leaving the defaults in place rather than disabling ICE");
}

// === Part 9: pipe is safe as the credential delimiter ===
// RFC 7064/7065 don't permit a pipe in a STUN/TURN URI, so it can never
// appear inside the URL and never needs escaping.
{
  const result = parseIceServers("turns:turn.internal:5349?transport=tcp|user|pass");
  assert(result?.[0].urls === "turns:turn.internal:5349?transport=tcp", "a URL with query parameters survives intact alongside credentials");
  assert(result?.[0].username === "user", "and the credentials still split correctly");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
