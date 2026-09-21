/**
 * WS13-R1 through R4, WS13-R8.
 *
 * The two failures worth guarding hardest against:
 *   - believing a file is being written when permission has lapsed, so the
 *     user is told their work is safe while nothing reaches disk (R-11);
 *   - overwriting a file that something else changed - a git checkout, another
 *     editor - which destroys work that was never ours.
 */
import 'fake-indexeddb/auto';
import {
  createFileBackedAutosave,
  createIndexedDbHandleStore,
  isFileAccessSupported,
  type FileHandleLike,
  type FileLike,
  type WritableLike,
} from './fileBackedAutosave.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

/** A file on a fake disk. Tracks lastModified the way a real one does, and can
 * be changed "externally" to simulate another program touching it. */
function makeHandle(
  name: string,
  options: {
    permission?: PermissionState;
    promptGrants?: PermissionState;
    failWrite?: string;
  } = {},
) {
  let contents = '';
  let lastModified = 1000;
  let permission: PermissionState = options.permission ?? 'granted';
  const writes: string[] = [];
  let closed = 0;

  const handle: FileHandleLike = {
    name,
    async getFile(): Promise<FileLike> {
      return { lastModified, text: async () => contents };
    },
    async createWritable(): Promise<WritableLike> {
      if (options.failWrite) {
        const error = new Error('nope');
        error.name = options.failWrite;
        throw error;
      }
      let pending = '';
      return {
        async write(data) {
          pending = data;
          writes.push(data);
        },
        async close() {
          // Mirrors the real API: the target is replaced on close, not during
          // the write.
          contents = pending;
          lastModified += 10;
          closed += 1;
        },
      };
    },
    async queryPermission() {
      return permission;
    },
    async requestPermission() {
      permission = options.promptGrants ?? 'granted';
      return permission;
    },
  };

  return {
    handle,
    writes,
    closedCount: () => closed,
    read: () => contents,
    touchExternally(newContents: string) {
      contents = newContents;
      lastModified += 500;
    },
    revokePermission() {
      permission = 'prompt';
    },
  };
}

console.log('=== Capability detection (WS13-R8) ===');
{
  assert(
    isFileAccessSupported() === false,
    'reports unsupported where showSaveFilePicker is absent, rather than assuming',
  );
}

console.log('=== Attaching and writing ===');
{
  const disk = makeHandle('architecture.json');
  const autosave = createFileBackedAutosave();

  assert(autosave.state() === 'none', 'starts detached');
  assert(autosave.fileName() === null, 'and names no file');

  const attached = await autosave.attach(disk.handle);
  assert(attached === 'attached', 'attaching with permission granted is active');
  assert(autosave.fileName() === 'architecture.json', 'the file name is exposed');

  const wrote = await autosave.write('{"a":1}');
  assert(wrote.ok, 'a write succeeds');
  assert(disk.read() === '{"a":1}', 'and the contents land on disk');

  const again = await autosave.write('{"a":2}');
  assert(again.ok, 'a second write succeeds - our own change is not mistaken for an external one');
  assert(disk.read() === '{"a":2}', 'and replaces the contents');
  assert(disk.closedCount() === 2, 'each write is closed, which is what commits it');
}

console.log('=== Permission does not silently persist (WS13-R2) ===');
{
  const disk = makeHandle('later.json', { permission: 'prompt' });
  const autosave = createFileBackedAutosave();

  const state = await autosave.attach(disk.handle);
  assert(
    state === 'needs-permission',
    'a re-acquired handle reports needs-permission rather than assuming granted',
  );

  const blocked = await autosave.write('{}');
  assert(
    !blocked.ok && blocked.reason === 'permission',
    'and writing is refused until permission is granted',
  );
  assert(
    disk.read() === '',
    'nothing was written - the crucial part, since the UI must not claim otherwise',
  );

  const granted = await autosave.requestPermission();
  assert(granted === 'attached', 'requesting permission on a gesture activates it');
  assert((await autosave.write('{}')).ok, 'and writing then works');
}

console.log('=== A refusal is not a temporary state ===');
{
  const disk = makeHandle('denied.json', {
    permission: 'prompt',
    promptGrants: 'denied',
  });
  const autosave = createFileBackedAutosave();
  await autosave.attach(disk.handle);
  const result = await autosave.requestPermission();
  assert(result === 'denied', 'a refused prompt reports denied');
  assert(!(await autosave.write('{}')).ok, 'and writes stay refused rather than retrying silently');
}

console.log('=== External modification is detected, not clobbered (WS13-R4) ===');
{
  const disk = makeHandle('shared.json');
  const autosave = createFileBackedAutosave();
  await autosave.attach(disk.handle);
  await autosave.write('{"mine":true}');

  disk.touchExternally('{"theirs":true}');

  const result = await autosave.write('{"mine":"updated"}');
  assert(
    !result.ok && result.reason === 'conflict',
    'a file changed underneath us produces a conflict, not an overwrite',
  );
  assert(
    disk.read() === '{"theirs":true}',
    'the external change is still intact - this is the data-loss case',
  );
  assert(
    !result.ok && result.reason === 'conflict' && /changed by something else/i.test(result.message),
    "the message explains what happened in the user's terms",
  );

  const external = await autosave.readExternal();
  assert(
    external === '{"theirs":true}',
    'the external contents can be read so the user gets a real choice',
  );

  const forced = await autosave.overwrite('{"mine":"updated"}');
  assert(forced.ok, 'overwriting is possible');
  assert(
    disk.read() === '{"mine":"updated"}',
    'and only happens through the separate, explicit method',
  );

  const next = await autosave.write('{"mine":"again"}');
  assert(
    next.ok,
    'after an overwrite the baseline is re-established, so the next write is not a false conflict',
  );
}

console.log('=== Withdrawn permission surfaces, and does not look like success ===');
{
  const disk = makeHandle('revoked.json', { failWrite: 'NotAllowedError' });
  const autosave = createFileBackedAutosave();
  await autosave.attach(disk.handle);
  const result = await autosave.write('{}');
  assert(
    !result.ok && result.reason === 'permission',
    'a NotAllowedError on write is reported as a permission problem',
  );
  assert(
    autosave.state() === 'needs-permission',
    'and the state drops so the indicator stops claiming the file is being written',
  );
}

console.log('=== Detaching ===');
{
  const disk = makeHandle('bye.json');
  const autosave = createFileBackedAutosave();
  await autosave.attach(disk.handle);
  autosave.detach();
  assert(autosave.state() === 'none', 'detaching clears the state');
  assert(!(await autosave.write('{}')).ok, 'and writes stop');
}

console.log('=== Handles survive across visits (WS13-R2) ===');
{
  // A real FileSystemFileHandle is a platform object and structured-cloneable,
  // which is why IndexedDB can hold one and localStorage cannot. The fake
  // above carries plain JS methods and is NOT cloneable, so the stand-in here
  // is a bare serializable object. The constraint this encodes is real: the
  // handle must be stored as-is and never wrapped in anything carrying
  // functions, or the put silently fails with a DataCloneError.
  const store = createIndexedDbHandleStore();
  const cloneable = { name: 'persisted.json' } as unknown as FileHandleLike;
  await store.set('doc-1', cloneable);

  const recovered = await store.get('doc-1');
  assert(recovered !== null, 'a stored handle is retrieved on a later visit');
  assert(recovered?.name === 'persisted.json', 'and identifies the same file');

  assert((await store.get('doc-missing')) === null, 'an unknown document has no handle');

  await store.delete('doc-1');
  assert((await store.get('doc-1')) === null, 'and a handle can be forgotten');
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  throw new Error(`${failures} file autosave check(s) failed`);
}
console.log('\nAll file-backed autosave checks passed.');
