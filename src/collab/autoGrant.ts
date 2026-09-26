/**
 * Granting automatically, from a member's browser (WS14-R20 to R28).
 *
 * One pass: list open join requests, check each against the sealed rule with
 * the provider's own keys, and either wrap the workspace key to the exact key
 * that was checked or report why not. The decision is verifyJoinEvidence's
 * alone (src/crypto/idToken.ts); this module only carries it out.
 *
 * Runs inside the existing access-request poll, so it adds no second loop
 * (WS14-R43).
 */
import {
  verifyJoinEvidence,
  type KeySource,
  type RejectionReason,
  type RuleVersionStore,
} from '../crypto/idToken.ts';
import { sha256 } from '../crypto/hash.ts';
import { importPublicKey, wrapKeyForPublicKey } from '../crypto/keys.ts';
import { loadAccessRule } from './accessRule.ts';
import { StoreClientError, type StoreClient } from './storeClient.ts';
import { fromBase64, toBase64 } from './workspaceDocuments.ts';

/** WS14-R27: the same evidence is not re-checked for the same failure
 * within ten minutes. */
export const REJECTION_QUIET_MS = 10 * 60 * 1000;
/** WS14-R28: the most a pass waits before granting. */
export const GRANT_JITTER_MS = 5_000;

export interface RejectionMemory {
  isQuiet(userId: string, evidenceHash: string, now: number): boolean;
  remember(userId: string, evidenceHash: string, now: number): void;
}

export function createRejectionMemory(): RejectionMemory {
  const until = new Map<string, number>();
  const key = (userId: string, evidenceHash: string) => `${userId}\u0000${evidenceHash}`;
  return {
    isQuiet(userId, evidenceHash, now) {
      const expires = until.get(key(userId, evidenceHash));
      if (expires === undefined) return false;
      if (expires <= now) {
        until.delete(key(userId, evidenceHash));
        return false;
      }
      return true;
    },
    remember(userId, evidenceHash, now) {
      until.set(key(userId, evidenceHash), now + REJECTION_QUIET_MS);
    },
  };
}

export interface AutoGrantResult {
  granted: { userId: string; displayName: string | null; matchedGroup: string }[];
  rejected: { userId: string; displayName: string | null; reason: RejectionReason }[];
}

export interface AutoGrantOptions {
  client: Pick<
    StoreClient,
    'listJoinRequests' | 'grantWorkspaceKey' | 'reportJoinRejection' | 'readAccessRule'
  >;
  workspaceId: string;
  workspaceKey: CryptoKey;
  generation: number;
  keySource: KeySource;
  ruleVersions: RuleVersionStore;
  memory: RejectionMemory;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const b64url = (bytes: Uint8Array) =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function runAutoGrant(options: AutoGrantOptions): Promise<AutoGrantResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const result: AutoGrantResult = { granted: [], rejected: [] };
  const { client, workspaceId } = options;

  const list = async () => {
    try {
      return await client.listJoinRequests(workspaceId);
    } catch (error) {
      // Not a key holder for this workspace, or no automatic access here.
      if (error instanceof StoreClientError && (error.status === 403 || error.status === 404))
        return [];
      throw error;
    }
  };

  const waiting = (await list()).filter(
    (request) => !options.memory.isQuiet(request.userId, request.evidenceHash, now()),
  );
  if (waiting.length === 0) return result;

  // WS14-R28: several members' editors may be open; a random pause and a
  // second look make it rare for two of them to grant the same person.
  await sleep(random() * GRANT_JITTER_MS);
  const stillOpen = new Set((await list()).map((request) => request.userId));

  const rule = await loadAccessRule(client, workspaceId, options.workspaceKey);
  const seen = await options.ruleVersions.get(workspaceId);
  if (rule && rule.ruleVersion >= seen)
    await options.ruleVersions.raise(workspaceId, rule.ruleVersion);

  for (const request of waiting) {
    if (!stillOpen.has(request.userId)) continue;
    const publicKey = fromBase64(request.publicKey);
    const outcome = await verifyJoinEvidence(
      {
        issuer: request.issuer,
        subject: request.subject,
        publicKey,
        salt: fromBase64(request.salt),
        idToken: request.idToken,
      },
      rule,
      { keySource: options.keySource, seenRuleVersion: seen, now },
    );
    // The grant is pinned to the token this browser checked, hashed here -
    // not to whatever hash the store attached to the request.
    const checkedHash = b64url(await sha256(new TextEncoder().encode(request.idToken)));

    if (!outcome.ok) {
      options.memory.remember(request.userId, request.evidenceHash, now());
      result.rejected.push({
        userId: request.userId,
        displayName: request.displayName,
        reason: outcome.reason,
      });
      await client.reportJoinRejection(workspaceId, request.userId, outcome.reason).catch(() => {
        // Reporting is for people reading the list; failing to report
        // changes nothing about the decision.
      });
      continue;
    }

    // WS14-R22: wrapped to exactly the bytes whose commitment was checked.
    const wrapped = await wrapKeyForPublicKey(
      options.workspaceKey,
      await importPublicKey(publicKey),
    );
    try {
      await client.grantWorkspaceKey(request.userId, options.generation, toBase64(wrapped), {
        joinEvidenceHash: checkedHash,
        matchedGroup: outcome.matchedGroup,
      });
      result.granted.push({
        userId: request.userId,
        displayName: request.displayName,
        matchedGroup: outcome.matchedGroup,
      });
    } catch (error) {
      // 409: another member granted first, or the request closed meanwhile.
      if (!(error instanceof StoreClientError && error.status === 409)) throw error;
    }
  }
  return result;
}

/** WS14-R20: the highest rule version seen, per workspace, kept in this
 * browser. localStorage is enough: losing it only forgets a high-water mark,
 * and the worst that follows is accepting a rule this browser had not seen
 * superseded. */
export function createLocalStorageRuleVersionStore(
  prefix = 'system-design-editor:access-rule-version:',
): RuleVersionStore {
  const read = (workspaceId: string) => {
    try {
      const value = Number(globalThis.localStorage?.getItem(prefix + workspaceId) ?? 0);
      return Number.isSafeInteger(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  };
  return {
    async get(workspaceId) {
      return read(workspaceId);
    },
    async raise(workspaceId, ruleVersion) {
      if (ruleVersion <= read(workspaceId)) return;
      try {
        globalThis.localStorage?.setItem(prefix + workspaceId, String(ruleVersion));
      } catch {
        // Storage refused (private mode, quota): the check still runs, with
        // this browser's memory of versions limited to this visit.
      }
    },
  };
}

const AUTO_GRANT_SETTING = 'system-design-editor:auto-grant';

/** WS14-R28: "Grant automatically from this browser", on unless turned off. */
export function autoGrantEnabledHere(): boolean {
  try {
    return globalThis.localStorage?.getItem(AUTO_GRANT_SETTING) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoGrantEnabledHere(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(AUTO_GRANT_SETTING, enabled ? 'on' : 'off');
  } catch {
    // Nowhere to keep it; the default applies next visit.
  }
}

/** WS14-R39: each reason in words a member can act on. */
export function describeRejection(reason: RejectionReason): string {
  switch (reason) {
    case 'rule-missing':
      return 'automatic access is not set up for this workspace';
    case 'rule-disabled':
      return 'automatic access is turned off';
    case 'rule-rollback':
      return 'the workspace served an older access rule than this browser has seen';
    case 'discovery-failed':
      return "this browser could not reach your identity provider's signing keys";
    case 'unknown-key':
    case 'bad-signature':
    case 'bad-alg':
      return 'their sign-in was not signed by your identity provider';
    case 'wrong-issuer':
    case 'wrong-audience':
      return 'they signed in somewhere other than this workspace expects';
    case 'too-old':
      return 'their sign-in is too old to check; they need to sign in again';
    case 'future-iat':
      return "their sign-in's time is wrong; a clock may be off";
    case 'subject-mismatch':
      return 'the sign-in belongs to someone else';
    case 'nonce-mismatch':
      return 'the sign-in does not vouch for the key they would be given';
    case 'no-group-match':
      return 'they are not in a group this workspace admits';
    case 'groups-overage':
      return 'your identity provider left their groups out of the sign-in';
  }
}
