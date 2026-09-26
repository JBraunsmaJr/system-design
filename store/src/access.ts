/**
 * What the store keeps for automatic access (WS14).
 *
 * None of it decides a grant. The routing copy of a workspace's rule only
 * decides whom to list as waiting (WS14-R10, R11); a join request only
 * carries evidence to the members who check it (R14 to R19); a membership
 * records how someone was let in, so that group changes can later remove the
 * people groups admitted and nobody else (R30).
 *
 * Every record is keyed by workspace, even while every deployment has only
 * `default`, so multi-workspace needs no migration of this data (WS14 §3).
 */

export interface RoutingRule {
  workspaceId: string;
  ruleVersion: number;
  enabled: boolean;
  claim: string;
  groups: string[];
  evidenceMaxAgeSeconds: number;
  /** WS14-R34: set when someone admitted by a group no longer matches. */
  rotationRequired: boolean;
  updatedAt: string;
}

export type JoinRequestStatus = 'open' | 'granted' | 'expired' | 'withdrawn';

export interface JoinRequestRecord {
  workspaceId: string;
  userId: string;
  /** Raw ID token. Null once the request is closed (WS14-R18). */
  idToken: string | null;
  /** base64url SHA-256 of the raw token, pinned by the grant (R26). */
  evidenceHash: string;
  /** base64, 32 bytes. */
  salt: string;
  /** base64 SPKI committed to, copied when the request was made: a later
   * key change cannot retarget a request. */
  publicKey: string;
  /** Seconds since the epoch, from the token. */
  iat: number;
  status: JoinRequestStatus;
  lastRejection: string | null;
  lastRejectionAt: string | null;
  createdAt: string;
}

export type MembershipSource = 'manual' | 'oidc_group';

export interface MembershipRecord {
  workspaceId: string;
  userId: string;
  source: MembershipSource;
  matchedGroup: string | null;
  grantedBy: string | null;
  grantedAt: string;
  removedAt: string | null;
}

export type AccessErrorReason = 'stale' | 'not-found';

export class AccessError extends Error {
  reason: AccessErrorReason;
  constructor(message: string, reason: AccessErrorReason) {
    super(message);
    this.name = 'AccessError';
    this.reason = reason;
  }
}

export interface AccessStore {
  getRule(workspaceId: string): Promise<RoutingRule | null>;
  listRules(): Promise<RoutingRule[]>;
  /** Refuses (`stale`) a ruleVersion not greater than the stored one. */
  putRule(rule: Omit<RoutingRule, 'rotationRequired' | 'updatedAt'>): Promise<RoutingRule>;

  /** Opens a request, replacing any earlier one for this (workspace, user)
   * along with its evidence (WS14-R15). */
  openRequest(
    request: Omit<JoinRequestRecord, 'status' | 'lastRejection' | 'lastRejectionAt' | 'createdAt'>,
  ): Promise<JoinRequestRecord>;
  getRequest(workspaceId: string, userId: string): Promise<JoinRequestRecord | null>;
  listRequests(workspaceId: string): Promise<JoinRequestRecord[]>;
  listRequestsForUser(userId: string): Promise<JoinRequestRecord[]>;
  /** Closes a request and drops its evidence. */
  closeRequest(
    workspaceId: string,
    userId: string,
    status: Exclude<JoinRequestStatus, 'open'>,
  ): Promise<void>;
  recordRejection(workspaceId: string, userId: string, reason: string): Promise<void>;
  /** WS14-R18: evidence issued before `cutoff` is dropped and its request
   * expired. Returns how many were. */
  expireEvidence(cutoff: Date): Promise<number>;

  getMembership(workspaceId: string, userId: string): Promise<MembershipRecord | null>;
  putMembership(
    record: Omit<MembershipRecord, 'grantedAt' | 'removedAt'>,
  ): Promise<MembershipRecord>;

  /** WS14-R32: what each user's groups were at their last sign-in. */
  setLastGroups(userId: string, groups: string[]): Promise<void>;
  getLastGroups(userId: string): Promise<string[] | null>;
}

export function createMemoryAccessStore(options: { now?: () => number } = {}): AccessStore {
  const now = options.now ?? Date.now;
  const rules = new Map<string, RoutingRule>();
  const requests = new Map<string, JoinRequestRecord>();
  const memberships = new Map<string, MembershipRecord>();
  const lastGroups = new Map<string, string[]>();
  const key = (workspaceId: string, userId: string) => `${workspaceId}\u0000${userId}`;
  const iso = () => new Date(now()).toISOString();
  const copy = <T>(value: T): T => structuredClone(value);

  return {
    async getRule(workspaceId) {
      const rule = rules.get(workspaceId);
      return rule ? copy(rule) : null;
    },
    async listRules() {
      return [...rules.values()].map(copy);
    },
    async putRule(rule) {
      const existing = rules.get(rule.workspaceId);
      if (existing && rule.ruleVersion <= existing.ruleVersion) {
        throw new AccessError(
          `The store already holds rule version ${existing.ruleVersion}.`,
          'stale',
        );
      }
      const stored: RoutingRule = {
        ...copy(rule),
        rotationRequired: existing?.rotationRequired ?? false,
        updatedAt: iso(),
      };
      rules.set(rule.workspaceId, stored);
      return copy(stored);
    },

    async openRequest(request) {
      const stored: JoinRequestRecord = {
        ...copy(request),
        status: 'open',
        lastRejection: null,
        lastRejectionAt: null,
        createdAt: iso(),
      };
      requests.set(key(request.workspaceId, request.userId), stored);
      return copy(stored);
    },
    async getRequest(workspaceId, userId) {
      const found = requests.get(key(workspaceId, userId));
      return found ? copy(found) : null;
    },
    async listRequests(workspaceId) {
      return [...requests.values()].filter((r) => r.workspaceId === workspaceId).map(copy);
    },
    async listRequestsForUser(userId) {
      return [...requests.values()].filter((r) => r.userId === userId).map(copy);
    },
    async closeRequest(workspaceId, userId, status) {
      const found = requests.get(key(workspaceId, userId));
      if (!found) return;
      found.status = status;
      found.idToken = null;
    },
    async recordRejection(workspaceId, userId, reason) {
      const found = requests.get(key(workspaceId, userId));
      if (!found) throw new AccessError('No such join request.', 'not-found');
      found.lastRejection = reason;
      found.lastRejectionAt = iso();
    },
    async expireEvidence(cutoff) {
      let count = 0;
      const cutoffSeconds = Math.floor(cutoff.getTime() / 1000);
      for (const request of requests.values()) {
        if (request.idToken !== null && request.iat < cutoffSeconds) {
          request.idToken = null;
          if (request.status === 'open') request.status = 'expired';
          count++;
        }
      }
      return count;
    },

    async getMembership(workspaceId, userId) {
      const found = memberships.get(key(workspaceId, userId));
      return found ? copy(found) : null;
    },
    async putMembership(record) {
      const stored: MembershipRecord = { ...copy(record), grantedAt: iso(), removedAt: null };
      memberships.set(key(record.workspaceId, record.userId), stored);
      return copy(stored);
    },

    async setLastGroups(userId, groups) {
      lastGroups.set(userId, [...groups]);
    },
    async getLastGroups(userId) {
      const found = lastGroups.get(userId);
      return found ? [...found] : null;
    },
  };
}
