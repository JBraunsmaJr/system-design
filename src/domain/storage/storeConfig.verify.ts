/**
 * Verification for storeConfig.ts: reading a typed store address.
 * Run with: npx tsx src/domain/storage/storeConfig.verify.ts
 */
import { parseStoreAddress } from './storeConfig.ts';

let failed = 0;
function check(condition: boolean, name: string) {
  if (!condition) failed += 1;
  console.log(`  ${condition ? '✓' : '✗'} ${name}`);
}
const urlOf = (input: string, pageProtocol?: string) => {
  const parsed = parseStoreAddress(input, pageProtocol);
  return parsed.ok ? parsed.url : null;
};
const refused = (input: string, pattern: RegExp, pageProtocol?: string) => {
  const parsed = parseStoreAddress(input, pageProtocol);
  return !parsed.ok && pattern.test(parsed.message);
};

console.log('\n=== Addresses that are accepted ===');
check(urlOf('https://store.example.com') === 'https://store.example.com', 'a plain address');
check(urlOf('  https://store.example.com/  ') === 'https://store.example.com', 'trimmed');
check(urlOf('store.example.com') === 'https://store.example.com', 'no scheme means https');
check(urlOf('store.example.com:8443') === 'https://store.example.com:8443', 'with a port');
check(
  urlOf('https://apps.example.com/notebook-store/') === 'https://apps.example.com/notebook-store',
  'a store under a path keeps the path',
);
check(urlOf('HTTPS://Store.Example.com') === 'https://store.example.com', 'case is normalized');
check(urlOf('http://localhost:8787') === 'http://localhost:8787', 'plain http on this machine');
check(
  urlOf('http://store.internal', 'http:') === 'http://store.internal',
  'plain http from a page that is itself plain http',
);
check(
  urlOf('http://localhost:8787', 'https:') === 'http://localhost:8787' &&
    urlOf('http://127.0.0.1:8787', 'https:') === 'http://127.0.0.1:8787',
  'this machine over http, even from an https page',
);

console.log('\n=== Addresses that are refused, with a reason ===');
check(refused('', /Enter the address/), 'nothing typed');
check(refused('   ', /Enter the address/), 'only spaces');
check(refused('ftp://store.example.com', /starts with https/), 'another protocol');
check(refused('javascript://store.example.com', /starts with https/), 'a script address');
check(refused('https://', /not a web address/), 'a scheme and nothing else');
check(refused('https://exa mple.com', /not a web address/), 'a space in the host');
check(
  refused('https://ada:secret@store.example.com', /user name and password/),
  'credentials in the address',
);
check(refused('https://store.example.com/?x=1', /\? or #/), 'a query');
check(refused('https://store.example.com/#x', /\? or #/), 'a fragment');
check(
  refused('http://store.example.com', /plain http/, 'https:'),
  'plain http from an https page, which the browser would block silently',
);

if (failed > 0) console.error(`${failed} check(s) failed`);
