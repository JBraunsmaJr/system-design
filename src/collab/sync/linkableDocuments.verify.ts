/**
 * What the "Linked document" picker offers: this browser's documents and the
 * workspace's, merged, with either source allowed to fail - and reading the
 * workspace never enrolling, publishing, or forgetting anything.
 */
import {
    listLinkableDocuments,
    listWorkspaceDocuments,
    mergeLinkableDocuments,
    readOnlyEnrollmentApi,
} from './linkableDocuments.ts';
import type {StoreClient} from '../access/storeClient.ts';
import type {DeviceKeyStorage} from '../access/deviceIdentity.ts';
import {generateWrappingKeyPair} from '../../crypto/keys.ts';

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
                {docId: 'payments', title: 'Payments'},
                {docId: 'local', title: 'Untitled Diagram'},
            ],
            [
                {docId: 'local', title: 'Shared architecture'},
                {docId: 'zeta', title: 'Zeta'},
                {docId: 'auth', title: 'Auth platform'},
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
            mergeLinkableDocuments([{docId: 'a', title: 'Mine'}], [{docId: 'a', title: ''}])[0]
                .title === 'Mine',
            'an empty workspace title falls back to the local one',
        );
    }

    console.log('Either source can fail');
    {
        const workspaceDown = await listLinkableDocuments({
            listLocal: async () => [{docId: 'a', title: 'A'}],
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
            listWorkspace: async () => [{docId: 'w', title: 'W'}],
        });
        assert(
            localDown.documents.length === 1 && !localDown.workspaceUnavailable,
            'a failed local read still leaves the workspace documents',
        );
        const noStore = await listLinkableDocuments({listLocal: async () => []});
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
            'nor is a browser with no workspace access',
        );
    }

    console.log('Reading the workspace is read-only');
    {
        const writes: string[] = [];
        const client = new Proxy(
            {},
            {
                get: (_target, name) => () => {
                    writes.push(String(name));
                    if (name === 'keysForDevice')
                        return Promise.resolve({status: 'awaiting-approval', verificationCode: 'X'});
                    return Promise.resolve(undefined);
                },
            },
        ) as unknown as StoreClient;
        const api = readOnlyEnrollmentApi(client);
        for (const write of [
            () => api.registerDevice('pk'),
            () => api.publishUserPublicKey('pk'),
            () => api.putWorkspaceKey(1, 'k'),
            () => api.approveDevice('d', 'c', {keyWrap: '', body: ''}, 'u'),
            () => api.setOwnUserKey('d', {keyWrap: '', body: ''}),
            () => api.listDevices(),
        ]) {
            await write().then(
                () => assert(false, 'a write went through'),
                () => {
                },
            );
        }
        assert(writes.length === 0, 'every write is refused before it reaches the store');

        let cleared = false;
        let saved = false;
        const held: DeviceKeyStorage = {
            load: async () => ({deviceId: 'device-1', keyPair: {} as CryptoKeyPair}),
            save: async () => {
                saved = true;
            },
            clear: async () => {
                cleared = true;
            },
        };
        const waiting = await listWorkspaceDocuments({client, storage: held});
        assert(waiting === null, 'a browser still waiting for approval sees no workspace documents');
        assert(
            !cleared && !saved,
            "and its stored device key is left alone - the picker can't make it forget or replace it",
        );
        assert(
            !writes.includes('registerDevice') && !writes.includes('listDevices'),
            'no device was registered, and the device list was never consulted',
        );

        // Waiting to be let in to a workspace someone else made: enrollment
        // would publish this browser's key here, which the picker refuses.
        // Real keys this time, so enrollment gets as far as the write.
        const realKeys = await generateWrappingKeyPair('device');
        const publishing = new Proxy(
            {},
            {
                get: (_target, name) => () => {
                    if (name === 'keysForDevice')
                        return Promise.resolve({status: 'needs-setup', verificationCode: 'X'});
                    if (name === 'workspaceExists') return Promise.resolve(true);
                    return Promise.resolve(undefined);
                },
            },
        ) as unknown as StoreClient;
        const needsAccess = await listLinkableDocuments({
            listLocal: async () => [],
            listWorkspace: async () =>
                listWorkspaceDocuments({
                    client: publishing,
                    storage: {...held, load: async () => ({deviceId: 'device-1', keyPair: realKeys})},
                }),
        });
        assert(
            !needsAccess.workspaceUnavailable,
            'a browser waiting for access is told nothing is unreachable - it simply has no workspace yet',
        );

        const empty: DeviceKeyStorage = {
            load: async () => null,
            save: async () => {
                saved = true;
            },
            clear: async () => {
            },
        };
        assert(
            (await listWorkspaceDocuments({client, storage: empty})) === null && !saved,
            'a browser that was never set up stays that way',
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
