/**
 * Replacing the workspace key after a removal, without anyone asking
 * (WS14-R34).
 *
 * Removing someone stops the store serving them, but they keep the key they
 * already hold. Rotation makes that key open nothing saved afterwards. The
 * store says when it is needed; the first key holder's browser to ask gets a
 * short lease and does it, and every other browser finds the lease taken and
 * does nothing - two browsers rotating at once would re-wrap the same
 * documents to two different keys.
 */
import { rotateWorkspaceKey, type RotationResult } from './workspaceRotation.ts';
import type { StoreClient } from './storeClient.ts';

export async function rotateIfRequired(options: {
  client: StoreClient;
  workspaceId: string;
  workspaceKey: CryptoKey;
  generation: number;
}): Promise<RotationResult | null> {
  const { client, workspaceId } = options;
  const rule = await client.getRoutingRule(workspaceId).catch(() => null);
  if (!rule?.rotationRequired) return null;
  if (!(await client.claimRotation(workspaceId))) return null;
  // The store clears the flag and the lease when the index reaches the new
  // generation, which rotation writes before handing out the new key.
  return rotateWorkspaceKey({
    client,
    workspaceId,
    currentKey: options.workspaceKey,
    currentGeneration: options.generation,
  });
}
