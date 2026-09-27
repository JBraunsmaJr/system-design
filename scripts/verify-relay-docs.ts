/**
 * The relay's reference page describes the relay that ships
 * (docs-site/docs/deployment/relay-server.md).
 *
 * It went stale once already: it said the relay could not be
 * authenticated, quoted y-webrtc's source to prove it, told people a
 * working relay prints "okay" at / (ours answers /health and 404s on /),
 * and sent image users to build from source. Each check here ties one of
 * its statements to the code it describes, so the next change to the relay
 * that would make the page wrong fails here first.
 */
import { readFileSync } from 'fs';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const page = readFileSync('docs-site/docs/deployment/relay-server.md', 'utf8');
const relay = readFileSync('scripts/relay-server.ts', 'utf8');
const panel = readFileSync('src/components/CollabPanel.tsx', 'utf8');
const signaling = readFileSync('src/domain/signalingConfig.ts', 'utf8');
const ice = readFileSync('src/domain/iceServerConfig.ts', 'utf8');
const coreNginx = readFileSync('docs-site/docs/files/core/nginx.conf', 'utf8');

console.log('=== Settings ===');
const read = [...relay.matchAll(/process\.env\.([A-Z_]+)/g)].map((match) => match[1]);
for (const name of new Set(read)) {
  check(page.includes(`| \`${name}\``), `${name}, which the relay reads, is in the settings table`);
}
const port = /process\.env\.PORT \?\? (\d+)/.exec(relay)?.[1];
check(
  !!port && new RegExp(`\\|\\s*\`PORT\`\\s*\\|\\s*\`${port}\``).test(page),
  `the documented default port matches the code (${port})`,
);
const ping = /RELAY_PING_TIMEOUT_MS \?\? ([\d_]+)/.exec(relay)?.[1]?.replace(/_/g, '');
check(
  !!ping && page.includes(`| \`RELAY_PING_TIMEOUT_MS\` | \`${ping}\``),
  `and the ping interval (${ping} ms)`,
);

console.log('\n=== What it answers ===');
check(
  /request\.url === '\/health'/.test(relay) && page.includes('/health'),
  'health checks use /health, which the relay serves',
);
check(
  !/should print:? okay/i.test(page),
  'nothing tells people a working relay prints "okay" - that was y-webrtc',
);
check(
  !page.includes('You may check auth'),
  "and y-webrtc's source is not quoted as if it were ours",
);
check(
  /authentication: secret \? 'required' : 'none'/.test(relay.replace(/\s+/g, ' ')),
  'the health response reports authentication as required or none, as the page says',
);

console.log('\n=== Who can use it ===');
check(
  !/relay is not:[\s\S]{0,400}Authenticated\./.test(page),
  'it no longer says the relay cannot be authenticated',
);
check(
  /RELAY_TOKEN_SECRET/.test(page) && /relayAuthentication/.test(page),
  'it explains membership, and how to confirm it on both services',
);
check(
  !/Room passwords, where available/.test(page),
  'session encryption is described as always on, which it is',
);

console.log('\n=== Where the editor finds it ===');
for (const name of ['RELAY', 'RELAY_URL', 'SIGNALING_URL']) {
  check(
    signaling.includes(name) && page.includes(name),
    `the container variable ${name} is read by the editor and named in the page`,
  );
}
check(
  page.indexOf('`RELAY`') < page.indexOf('VITE_SIGNALING_URL'),
  'the container setting comes before the build-time one',
);
check(
  !/VITE_ICE_SERVERS=.*npm run build/.test(page) &&
    !/VITE_SIGNALING_URL=.*npm run build/.test(page),
  'image users are not told to build from source',
);
for (const key of ['system-design-editor:signaling-urls', 'system-design-editor:ice-servers']) {
  check(
    (signaling + ice).includes(key) && page.includes(key),
    `the browser storage key ${key} is the one the code uses`,
  );
}
for (const label of ['Relay server URL', 'ICE servers']) {
  check(
    panel.includes(label) && page.includes(label),
    `the "${label}" label matches the interface`,
  );
}

console.log('\n=== The proxy example matches the deployment guides ===');
for (const line of [
  'proxy_pass http://relay:4444/;',
  'proxy_set_header Connection $connection_upgrade;',
  'proxy_read_timeout 1h;',
]) {
  check(coreNginx.includes(line) && page.includes(line), `both use: ${line}`);
}
check(
  /map \$http_upgrade \$connection_upgrade/.test(page),
  'and the page defines $connection_upgrade before using it',
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll relay documentation checks passed.');
