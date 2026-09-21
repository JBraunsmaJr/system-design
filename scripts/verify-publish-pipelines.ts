/**
 * Every service image is published, and checked before it is (WS8-R9).
 *
 * Three services, three images: the editor, the relay, the workspace store.
 * The store's had no publish pipeline at all, so anyone deploying
 * workspaces had to build it themselves without being told. And a
 * successful build has twice not meant a working image - the store once
 * died on first run for want of a file, and the relay once ran a different
 * server from the one the tests exercise. So each publish pipeline must
 * build from the right place, gate on the tests, and start the image it is
 * about to publish.
 */
import { readFileSync, readdirSync } from 'fs';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const workflows = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, text: readFileSync(`.github/workflows/${name}`, 'utf8') }));

const publishing = (dockerfile: string) =>
  workflows.find(
    (workflow) => workflow.text.includes(`file: ${dockerfile}`) && /push: true/.test(workflow.text),
  );

for (const [service, dockerfile, suffix, healthPath] of [
  ['store', 'docker/store/Dockerfile', '-store', '/v1/health'],
  ['relay', 'docker/signaling/Dockerfile', '-relay', '/health'],
] as const) {
  console.log(`=== The ${service} ===`);
  const workflow = publishing(dockerfile);
  check(!!workflow, `a workflow publishes ${dockerfile} (${workflow?.name ?? 'none'})`);
  if (!workflow) continue;
  check(
    /context: \.\s*$/m.test(workflow.text),
    'built from the repository root, which its Dockerfile needs',
  );
  check(workflow.text.includes(suffix), `under a name that says which service it is (…${suffix})`);
  check(/needs: \[[^\]]*test/.test(workflow.text), 'only after the tests pass');
  check(
    workflow.text.includes('load: true') && workflow.text.includes(healthPath),
    `and only after the built image has started and served ${healthPath}`,
  );
}

console.log('\n=== The store is tested against its real database first ===');
{
  const workflow = publishing('docker/store/Dockerfile');
  check(!!workflow && /postgres:16/.test(workflow.text), 'the store pipeline runs PostgreSQL');
  for (const suite of [
    'verify-store-contract',
    'verify-store-http',
    'verify-sessions',
    'verify-store-startup',
  ]) {
    check(!!workflow?.text.includes(suite), `including ${suite}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll publish pipeline checks passed.');
