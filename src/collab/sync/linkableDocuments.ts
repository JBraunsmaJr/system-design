/**
 * The documents a diagram node can link to (see domain/canvas/documentLinks.ts):
 * this browser's stored documents, plus the workspace documents this browser
 * can read.
 *
 * Without the workspace half, the picker only knew about documents someone
 * had already opened here - so the shared platform's document a teammate put
 * in the workspace, the most likely thing to link to, could not be picked.
 *
 * Reading the workspace here is strictly read-only. The picker is not a
 * place where enrolling happens, so the enrollment API it hands to
 * attachExistingDevice refuses every write: no device is registered, no key
 * is published, and - because listDevices refuses too, which enrollDevice
 * reads as "assume the stored device is fine" - a stored device key is never
 * cleared. A browser that isn't enrolled, or is still waiting for access,
 * simply sees no workspace documents.
 */
import {isValidDocumentId} from '../../domain/storage/currentDocument.ts';
import type {StoreClient} from '../access/storeClient.ts';
import {attachExistingDevice, type DeviceKeyStorage, type EnrollmentApi,} from '../access/deviceIdentity.ts';
import {indexKeyFor} from './workspaceDocuments.ts';

export interface LinkableDocument {
    docId: string;
    title: string;
    /** Where this browser knows it from. `workspace` alone means it has not
     * been opened here yet; it opens by id and arrives from the store. */
    source: 'local' | 'workspace' | 'both';
}

export interface LinkableDocumentList {
    documents: LinkableDocument[];
    /** The workspace exists for this browser but couldn't be read just now
     * (offline, signed out). Worth saying, so an absent document isn't taken
     * to mean it doesn't exist. */
    workspaceUnavailable: boolean;
}

const WORKSPACE_ID = 'default';

/** A write the picker refused to make. Enrollment hitting one means the
 * browser needed something done before it could read the workspace (a key
 * published while it waits for access) - i.e. it has no access yet, which
 * is not the same as the workspace being unreachable. */
class ReadOnlyRefusal extends Error {
}

const refuse = (what: string) => () =>
    Promise.reject(new ReadOnlyRefusal(`The document link picker never ${what}.`));

/** An EnrollmentApi that can read this browser's access and nothing else. */
export function readOnlyEnrollmentApi(client: StoreClient): EnrollmentApi {
    return {
        keysForDevice: (deviceId) => client.keysForDevice(deviceId),
        workspaceExists: () => client.workspaceExists(WORKSPACE_ID),
        registerDevice: refuse('registers a device'),
        publishUserPublicKey: refuse('publishes keys'),
        putWorkspaceKey: refuse('writes workspace keys'),
        approveDevice: refuse('approves devices'),
        setOwnUserKey: refuse('writes user keys'),
        listDevices: refuse('lists devices'),
    };
}

/**
 * The workspace's documents, as this browser can read them. `null` when
 * this browser has no workspace to read (not enrolled, waiting for access);
 * throws when it has one that can't be reached.
 */
export async function listWorkspaceDocuments(options: {
    client: StoreClient;
    storage: DeviceKeyStorage;
}): Promise<{ docId: string; title: string }[] | null> {
    const device = await attachExistingDevice({
        api: readOnlyEnrollmentApi(options.client),
        storage: options.storage,
    });
    if (device.status === 'error') {
        if (device.cause instanceof ReadOnlyRefusal) return null;
        throw device.cause ?? new Error(device.message);
    }
    if (device.status !== 'ready' || !device.workspaceKey) return null;
    const {entries} = await options.client.readIndex(
        WORKSPACE_ID,
        await indexKeyFor(device.workspaceKey),
    );
    // Entries come from the store; the ids become URLs, so only valid ones.
    return entries
        .filter((e) => isValidDocumentId(e.docId))
        .map((e) => ({docId: e.docId, title: typeof e.title === 'string' ? e.title : ''}));
}

/**
 * One list from both sources, each document once. Local documents keep
 * their order (most recently updated first); workspace-only documents
 * follow, by title.
 *
 * A document in both takes the workspace's title. Every editor's sync
 * writes the title to the workspace index as they edit, so it is what
 * everyone sees - whereas this browser's copy may never have been opened
 * since it joined (the default document, "local", exists in every browser)
 * and still carry a placeholder.
 */
export function mergeLinkableDocuments(
    local: readonly { docId: string; title: string }[],
    workspace: readonly { docId: string; title: string }[],
): LinkableDocument[] {
    const inWorkspace = new Map(workspace.map((d) => [d.docId, d]));
    const merged: LinkableDocument[] = [];
    const seen = new Set<string>();
    for (const d of local) {
        if (seen.has(d.docId)) continue;
        seen.add(d.docId);
        const shared = inWorkspace.get(d.docId);
        merged.push({
            docId: d.docId,
            title: shared?.title || d.title || '',
            source: shared ? 'both' : 'local',
        });
    }
    const workspaceOnly = workspace
        .filter((d) => !seen.has(d.docId) && (seen.add(d.docId), true))
        .map((d) => ({docId: d.docId, title: d.title, source: 'workspace' as const}))
        .sort((a, b) => a.title.localeCompare(b.title));
    return [...merged, ...workspaceOnly];
}

/**
 * Both sources, read together. Either failing leaves the other's documents
 * available: the picker is a convenience, and an unreachable store must not
 * hide the documents that are right here.
 */
export async function listLinkableDocuments(sources: {
    listLocal: () => Promise<{ docId: string; title: string }[]>;
    /** Omitted where the deployment has no store. */
    listWorkspace?: () => Promise<{ docId: string; title: string }[] | null>;
}): Promise<LinkableDocumentList> {
    const [local, workspace] = await Promise.allSettled([
        sources.listLocal(),
        sources.listWorkspace ? sources.listWorkspace() : Promise.resolve(null),
    ]);
    return {
        documents: mergeLinkableDocuments(
            local.status === 'fulfilled' ? local.value : [],
            workspace.status === 'fulfilled' ? (workspace.value ?? []) : [],
        ),
        workspaceUnavailable: workspace.status === 'rejected',
    };
}
