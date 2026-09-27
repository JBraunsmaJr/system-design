import { downloadFile } from './download';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 1. downloadFile runs safely in node/SSR without throwing
try {
  downloadFile('test content', 'test.txt', 'text/plain');
  assert(true, 'downloadFile is safe in non-DOM environment');
} catch (err) {
  assert(false, `downloadFile threw in non-DOM environment: ${err}`);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
