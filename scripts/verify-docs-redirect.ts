import { readFileSync } from 'fs';
import vm from 'vm';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

function extractScript(htmlContent: string): string {
  const match = htmlContent.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('No inline <script> found in HTML');
  }
  return match[1];
}

function testHtmlRedirect(
  scriptCode: string,
  pathname: string,
  search = '',
  hash = '',
): string | null {
  let replacedUrl: string | null = null;
  const sandbox = {
    window: {
      location: {
        pathname,
        search,
        hash,
        replace: (url: string) => {
          replacedUrl = url;
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(scriptCode, sandbox);
  return replacedUrl;
}

console.log('=== Testing index.html redirect script ===');
const indexHtml = readFileSync('index.html', 'utf8');
const indexScript = extractScript(indexHtml);

check(
  testHtmlRedirect(indexScript, '/docs') === '/docs/index.html',
  '/docs redirects to /docs/index.html without forcing /system-design',
);
check(
  testHtmlRedirect(indexScript, '/docs/') === '/docs/index.html',
  '/docs/ redirects to /docs/index.html without forcing /system-design',
);
check(
  testHtmlRedirect(indexScript, '/system-design/docs') === '/system-design/docs/index.html',
  '/system-design/docs redirects to /system-design/docs/index.html',
);
check(
  testHtmlRedirect(indexScript, '/system-design/docs/') === '/system-design/docs/index.html',
  '/system-design/docs/ redirects to /system-design/docs/index.html',
);
check(
  testHtmlRedirect(indexScript, '/system-design/docs', '?v=1', '#intro') ===
    '/system-design/docs/index.html?v=1#intro',
  'preserves query params and hash on redirect',
);
check(testHtmlRedirect(indexScript, '/') === null, 'root path / does not redirect');
check(
  testHtmlRedirect(indexScript, '/system-design/') === null,
  '/system-design/ does not redirect',
);

console.log('\n=== Testing public/404.html redirect script ===');
const notFoundHtml = readFileSync('public/404.html', 'utf8');
const notFoundScript = extractScript(notFoundHtml);

check(
  testHtmlRedirect(notFoundScript, '/docs') === '/docs/index.html',
  '404 on /docs redirects to /docs/index.html',
);
check(
  testHtmlRedirect(notFoundScript, '/docs/') === '/docs/index.html',
  '404 on /docs/ redirects to /docs/index.html',
);
check(
  testHtmlRedirect(notFoundScript, '/system-design/docs') === '/system-design/docs/index.html',
  '404 on /system-design/docs redirects to /system-design/docs/index.html',
);
check(
  testHtmlRedirect(notFoundScript, '/system-design/docs/') === '/system-design/docs/index.html',
  '404 on /system-design/docs/ redirects to /system-design/docs/index.html',
);
check(testHtmlRedirect(notFoundScript, '/unknown') === '/', 'unknown path at root redirects to /');
check(
  testHtmlRedirect(notFoundScript, '/system-design/unknown') === '/system-design/',
  'unknown path under /system-design redirects to /system-design/',
);

console.log('\n=== Testing PWA Service Worker denylist pattern ===');
const viteConfig = readFileSync('vite.config.ts', 'utf8');
check(
  !viteConfig.includes("Location: '/system-design/docs/index.html'"),
  'vite.config.ts does not hardcode /system-design redirect location',
);
const denylistMatch = viteConfig.match(/navigateFallbackDenylist:\s*\[(.*?)\],/s);
check(!!denylistMatch, 'navigateFallbackDenylist is configured in vite.config.ts');

const denylistRegex = /\/docs(\/|$)/;
check(denylistRegex.test('/docs'), 'SW denylist matches /docs');
check(denylistRegex.test('/docs/'), 'SW denylist matches /docs/');
check(denylistRegex.test('/docs/index.html'), 'SW denylist matches /docs/index.html');
check(denylistRegex.test('/system-design/docs'), 'SW denylist matches /system-design/docs');
check(
  denylistRegex.test('/system-design/docs/index.html'),
  'SW denylist matches /system-design/docs/index.html',
);
check(!denylistRegex.test('/doctor'), 'SW denylist does not match /doctor');
check(!denylistRegex.test('/system-design/'), 'SW denylist does not match /system-design/');

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll docs redirect checks passed.');
