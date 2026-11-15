/**
 * What the "Linked document" picker offers: this browser's documents and the
 * workspaces', merged, with either source allowed to fail.
 */
import {
  listLinkableDocuments,
  listWorkspaceDocuments,
  mergeLinkableDocuments,
} from './linkableDocuments.ts';
import { StoreClientError } from '../access/storeErrors.ts';

let failures = 0;

function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

async function run() {
  console.log('Merging');
  {
    const merged = mergeLinkableDocuments(
      [
        { docId: 'payments', title: 'Payments' },
        { docId: 'local', title: 'Untitled Diagram' },
      ],
      [
        { docId: 'local', title: 'Shared architecture' },
        { docId: 'zeta', title: 'Zeta' },
        { docId: 'auth', title: 'Auth platform' },
      ],
    );
    assert(
      merged.map((d) => d.docId).join(',') === 'payments,local,auth,zeta',
      "this browser's documents first, in their order; then workspace-only ones by title",
    );
    assert(merged.length === 4, 'a document in both is listed once');
    const shared = merged.find((d) => d.docId === 'local');
    assert(
      shared?.source === 'both' && shared.title === 'Shared architecture',
      "a document in both takes the workspace's title over a never-opened local placeholder",
    );
    assert(
      merged.find((d) => d.docId === 'auth')?.source === 'workspace',
      'a workspace document this browser has never opened is marked as such',
    );
    assert(
      mergeLinkableDocuments([{ docId: 'a', title: 'Mine' }], [{ docId: 'a', title: '' }])[0]
        .title === 'Mine',
      'an empty workspace title falls back to the local one',
    );
  }

  console.log('Either source can fail');
  {
    const workspaceDown = await listLinkableDocuments({
      listLocal: async () => [{ docId: 'a', title: 'A' }],
      listWorkspace: async () => {
        throw new Error('offline');
      },
    });
    assert(
      workspaceDown.documents.length === 1 && workspaceDown.workspaceUnavailable,
      "an unreachable workspace leaves this browser's documents, and says so",
    );
    const localDown = await listLinkableDocuments({
      listLocal: async () => {
        throw new Error('quota');
      },
      listWorkspace: async () => [{ docId: 'w', title: 'W' }],
    });
    assert(
      localDown.documents.length === 1 && !localDown.workspaceUnavailable,
      'a failed local read still leaves the workspace documents',
    );
    const noStore = await listLinkableDocuments({ listLocal: async () => [] });
    assert(
      !noStore.workspaceUnavailable,
      'a deployment with no store is not "unavailable" - there is nothing to reach',
    );
    const notEnrolled = await listLinkableDocuments({
      listLocal: async () => [],
      listWorkspace: async () => null,
    });
    assert(
      !notEnrolled.workspaceUnavailable && notEnrolled.documents.length === 0,
      'nor is someone who is not signed in',
    );
  }

  console.log('Reading the workspaces');
  {
    const calls: string[] = [];
    const client = {
      listWorkspaces: async () => {
        calls.push('workspaces');
        return [{ workspaceId: 'ws_a' }, { workspaceId: 'ws_b' }] as never;
      },
      listDocuments: async (workspaceId: string) => {
        calls.push(workspaceId);
        return (
          workspaceId === 'ws_a'
            ? [
                { docId: 'auth', title: 'Auth platform' },
                { docId: 'not a valid id', title: 'Bad' },
              ]
            : [{ docId: 'billing', title: 'Billing' }]
        ) as never;
      },
    };
    const listed = await listWorkspaceDocuments(client);
    assert(
      listed?.map((d) => d.docId).join(',') === 'auth,billing',
      'the documents of every workspace this person can see, in one list',
    );
    assert(
      !listed?.some((d) => d.docId === 'not a valid id'),
      'an id that could not be a document address is left out',
    );
    assert(
      calls.join(',') === 'workspaces,ws_a,ws_b',
      'and only reads were made: workspaces, then the documents of each',
    );

    const signedOut = await listWorkspaceDocuments({
      listWorkspaces: async () => {
        throw new StoreClientError('Sign in first.', 'unauthenticated');
      },
      listDocuments: async () => [],
    });
    assert(signedOut === null, 'someone not signed in has no workspaces to read');
    const viaList = await listLinkableDocuments({
      listLocal: async () => [],
      listWorkspace: async () => signedOut,
    });
    assert(!viaList.workspaceUnavailable, 'which is not reported as the store being unreachable');

    const offline = await listLinkableDocuments({
      listLocal: async () => [{ docId: 'a', title: 'A' }],
      listWorkspace: () =>
        listWorkspaceDocuments({
          listWorkspaces: async () => {
            throw new StoreClientError('down', 'offline');
          },
          listDocuments: async () => [],
        }),
    });
    assert(
      offline.workspaceUnavailable && offline.documents.length === 1,
      'an unreachable store is, and the local documents are still offered',
    );
  }
}

run().then(() => {
  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
  } else {
    console.log('\nAll linkable document checks passed.');
  }
});
