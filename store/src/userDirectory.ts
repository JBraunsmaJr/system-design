/**
 * The people who have signed in to this store.
 *
 * A person is an (issuer, subject) pair from the identity provider, never
 * an email address. Each sign-in finds or creates their record, which is
 * what lets a workspace name its members and lets an owner find someone to
 * add. Nothing here grants access: that is a workspace role
 * (permissions.ts).
 */
export interface UserRecord {
  userId: string;
  issuer: string;
  subject: string;
  displayName?: string;
}

export type DirectoryErrorReason = 'not-found';

export class DirectoryError extends Error {
  reason: DirectoryErrorReason;

  constructor(message: string, reason: DirectoryErrorReason) {
    super(message);
    this.name = 'DirectoryError';
    this.reason = reason;
  }
}

export interface UserDirectory {
  /** Finds or creates the user behind a sign-in's (issuer, subject). A
   * display name, when given, replaces the one on record. */
  upsertUser(identity: {
    issuer: string;
    subject: string;
    displayName?: string;
  }): Promise<UserRecord>;
  getUser(userId: string): Promise<UserRecord>;
  /** In the order they first signed in. */
  listUsers(): Promise<UserRecord[]>;
}

let counter = 0;
const newId = (prefix: string) => `${prefix}_${(++counter).toString(36)}${Date.now().toString(36)}`;

/** For tests and for a store run without PostgreSQL. */
export function createMemoryUserDirectory(): UserDirectory {
  const users = new Map<string, UserRecord>();
  const keyOf = (issuer: string, subject: string) => `${issuer}\u0000${subject}`;

  return {
    async upsertUser(identity) {
      const key = keyOf(identity.issuer, identity.subject);
      const existing = [...users.values()].find((user) => keyOf(user.issuer, user.subject) === key);
      if (existing) {
        if (identity.displayName) existing.displayName = identity.displayName;
        return { ...existing };
      }
      const user: UserRecord = {
        userId: newId('usr'),
        issuer: identity.issuer,
        subject: identity.subject,
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
      };
      users.set(user.userId, user);
      return { ...user };
    },

    async getUser(userId) {
      const user = users.get(userId);
      if (!user) throw new DirectoryError(`No user ${userId}.`, 'not-found');
      return { ...user };
    },

    async listUsers() {
      return [...users.values()].map((user) => ({ ...user }));
    },
  };
}
