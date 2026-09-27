/**
 * WS1-R9.
 *
 * The behaviour worth pinning is the defaulting and the ICE-server handling.
 * Both have a failure mode where the wrong answer looks like the right one:
 * an empty transport list silently disabling all collaboration, and an
 * `iceServers: undefined` that overrides the browser defaults with nothing.
 */
import {
  enabledTransports,
  defaultTransport,
  isTransportEnabled,
  buildPeerOpts,
} from './transport.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log('=== Defaults preserve current behaviour ===');
{
  assert(
    JSON.stringify(enabledTransports()) === JSON.stringify(['webrtc']),
    'with nothing configured, peer-to-peer is enabled',
  );
  assert(defaultTransport() === 'webrtc', 'and is the default');
  assert(isTransportEnabled('webrtc'), 'webrtc reports enabled');
  assert(!isTransportEnabled('websocket'), 'websocket does not');
}

console.log('=== Explicit configuration ===');
{
  const serverOnly = { VITE_SYNC_TRANSPORTS: 'websocket' };
  assert(
    !isTransportEnabled('webrtc', serverOnly),
    'a server-only build excludes peer-to-peer, which is the government shape',
  );
  assert(defaultTransport(serverOnly) === 'websocket', 'and defaults to the server transport');

  const both = { VITE_SYNC_TRANSPORTS: 'webrtc,websocket' };
  assert(enabledTransports(both).length === 2, 'a build can ship both');
  assert(
    defaultTransport(both) === 'webrtc',
    'the first entry is the default, so order expresses preference',
  );

  assert(
    JSON.stringify(enabledTransports({ VITE_SYNC_TRANSPORTS: ' websocket , webrtc ' })) ===
      JSON.stringify(['websocket', 'webrtc']),
    'surrounding whitespace is tolerated',
  );
}

console.log('=== Malformed configuration falls back rather than disabling sync ===');
{
  for (const raw of ['', '   ', 'nonsense', 'webrtc;websocket']) {
    const result = enabledTransports({ VITE_SYNC_TRANSPORTS: raw });
    assert(
      result.length > 0,
      `"${raw}" yields a usable transport instead of silently disabling collaboration`,
    );
  }
  assert(
    JSON.stringify(enabledTransports({ VITE_SYNC_TRANSPORTS: 'nonsense' })) ===
      JSON.stringify(['webrtc']),
    'an unrecognised value falls back to the default rather than an empty list',
  );
  assert(
    JSON.stringify(enabledTransports({ VITE_SYNC_TRANSPORTS: 'websocket,nonsense' })) ===
      JSON.stringify(['websocket']),
    'a partly-valid list keeps what it recognises',
  );
}

console.log('=== ICE servers ===');
{
  assert(
    Object.keys(buildPeerOpts(undefined)).length === 0,
    'no configured servers means the key is absent, NOT present and undefined - ' +
      'the latter would override the browser defaults with nothing',
  );

  const servers = [{ urls: 'stun:stun.example.gov:3478' }];
  const opts = buildPeerOpts(servers) as {
    peerOpts?: { config?: { iceServers?: RTCIceServer[] } };
  };
  assert(
    opts.peerOpts?.config?.iceServers === servers,
    "configured servers reach simple-peer's config",
  );

  assert(
    Object.keys(buildPeerOpts([])).length === 1,
    "an EMPTY list is deliberate - an air-gapped deployment saying 'no STUN at " +
      "all' must be distinguishable from 'not configured'",
  );
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} transport check(s) failed`);
}
console.log('\nAll transport checks passed.');
