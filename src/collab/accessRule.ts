/**
 * A workspace's automatic access rule (WS14-R8 to R13).
 *
 * Two copies, deliberately unequal. The sealed rule is the only one a
 * granting browser trusts: it is encrypted under the workspace's index key,
 * so the store can neither read nor change it. The routing copy tells the
 * store whom to list as waiting; a store that alters it can mislist people,
 * but cannot get anyone a key.
 */
import { EVIDENCE_MAX_AGE_DEFAULT, parseAccessRule, type AccessRule } from '../crypto/idToken.ts';
import { StoreClientError, type StoreClient } from './storeClient.ts';
import { indexKeyFor } from './workspaceDocuments.ts';

type RuleClient = Pick<
  StoreClient,
  'readAccessRule' | 'writeAccessRule' | 'putRoutingRule' | 'getRoutingRule'
>;

/** The sealed rule, or null when there is none or it does not validate. A
 * rule that fails validation is treated as absent: it grants nothing. */
export async function loadAccessRule(
  client: Pick<StoreClient, 'readAccessRule'>,
  workspaceId: string,
  workspaceKey: CryptoKey,
): Promise<AccessRule | null> {
  const { rule } = await client.readAccessRule(workspaceId, await indexKeyFor(workspaceKey));
  if (!rule) return null;
  try {
    return parseAccessRule(rule);
  } catch {
    return null;
  }
}

/** The stored rule's version; 0 when there is none or it does not parse,
 * so the next save starts a fresh sequence rather than failing. */
function versionOf(rule: unknown): number {
  if (!rule) return 0;
  try {
    return parseAccessRule(rule).ruleVersion;
  } catch {
    return 0;
  }
}

export interface AccessRuleEdit {
  enabled: boolean;
  groups: string[];
  evidenceMaxAgeSeconds?: number;
  /** Confirmed by the person on first save (WS14-R12). */
  issuer: string;
  audience: string;
  claim?: string;
}

/**
 * Writes a new version of the rule: sealed first, conditional on the
 * version read (WS14-R9), then the routing copy (R10). Validation happens
 * before anything is written, so a bad edit changes nothing.
 */
export async function saveAccessRule(options: {
  client: RuleClient;
  workspaceId: string;
  workspaceKey: CryptoKey;
  generation: number;
  edit: AccessRuleEdit;
  updatedBy: string;
  attempts?: number;
}): Promise<AccessRule> {
  const { client, workspaceId, edit } = options;
  const indexKey = await indexKeyFor(options.workspaceKey);
  const attempts = options.attempts ?? 5;
  for (let attempt = 1; ; attempt++) {
    const current = await client.readAccessRule(workspaceId, indexKey);
    // The highest version known anywhere, so a save always moves forward -
    // including after the sealed record was lost or forged, when browsers
    // that saw later versions would otherwise refuse the new one as a
    // rollback (WS14-R20). A store inflating the routing copy's number only
    // makes versions skip; it cannot make a browser accept an older rule.
    const routed = await client.getRoutingRule(workspaceId).catch(() => null);
    const previousVersion = Math.max(versionOf(current.rule), routed?.ruleVersion ?? 0);
    const next = parseAccessRule({
      schema: 1,
      ruleVersion: previousVersion + 1,
      enabled: edit.enabled,
      issuer: edit.issuer,
      audience: edit.audience,
      claim: edit.claim ?? 'groups',
      groups: edit.groups.map((group) => group.trim()).filter(Boolean),
      evidenceMaxAgeSeconds: edit.evidenceMaxAgeSeconds ?? EVIDENCE_MAX_AGE_DEFAULT,
      updatedBy: options.updatedBy,
      updatedAt: new Date().toISOString(),
    });
    try {
      await client.writeAccessRule(
        workspaceId,
        indexKey,
        next,
        current.version,
        options.generation,
      );
    } catch (error) {
      const collided = error instanceof StoreClientError && error.reason === 'conflict';
      if (collided && attempt < attempts) continue;
      throw error;
    }
    try {
      await client.putRoutingRule(workspaceId, {
        ruleVersion: next.ruleVersion,
        enabled: next.enabled,
        claim: next.claim,
        groups: next.groups,
        evidenceMaxAgeSeconds: next.evidenceMaxAgeSeconds,
      });
    } catch (error) {
      // A newer routing copy is already there: someone saved after us, and
      // theirs is the one to keep. Anything else is worth surfacing - the
      // sealed rule is saved, but newcomers will not be listed until the
      // routing copy catches up.
      const newer = error instanceof StoreClientError && error.status === 409;
      if (!newer) throw error;
    }
    return next;
  }
}
