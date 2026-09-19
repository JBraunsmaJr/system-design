/**
 * Users, their devices, and the wrapped keys those devices need
 * (WS7-R8, R11, R12, R14).
 *
 * Everything here is a wrap: the store holds no key it can use. A device
 * registers its public key, an already-approved device hands it the user's
 * private key wrapped to that public key, and from there the device can
 * unwrap the workspace key and open documents.
 *
 * Signing in does not reach any of this (WS10-R1). A session identifies a
 * person; a device is what holds access, and a new one is inert until
 * approved (WS7-R11), unlocked with the recovery code (WS7-R12), or granted
 * by an administrator (WS7-R13, next step).
 */
import { sha256 } from "../../src/crypto/hash.ts";

export interface UserRecord {
  userId: string;
  issuer: string;
  subject: string;
  displayName?: string;
  /** base64 SPKI of the member's user key, so the workspace key can be
   * wrapped to them (WS7-R8). Absent until their first device publishes it. */
  publicKey?: string;
}

export interface WrappedUserKey {
  /** The one-off key, wrapped to the device's public key. */
  keyWrap: string;
  /** The user's private key, sealed under that one-off key. */
  body: string;
}

export interface DeviceRecord {
  deviceId: string;
  userId: string;
  label?: string;
  /** base64 SPKI. */
  publicKey: string;
  /** Shown on both devices during approval (WS7-R11). */
  verificationCode: string;
  createdAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
  /** Present once approved: what this device needs to reach the user key. */
  wrappedUserKey: WrappedUserKey | null;
}

export interface RecoveryRecord {
  salt: string;
  sealedUserKey: string;
}

export type DirectoryErrorReason = "not-found" | "conflict" | "revoked" | "not-approved" | "bad-request";

export class DirectoryError extends Error {
  reason: DirectoryErrorReason;

  constructor(message: string, reason: DirectoryErrorReason) {
    super(message);
    this.name = "DirectoryError";
    this.reason = reason;
  }
}

export interface UserDirectory {
  /** Finds or creates the user behind a session's (issuer, subject). */
  upsertUser(identity: { issuer: string; subject: string; displayName?: string }): Promise<UserRecord>;
  registerDevice(userId: string, device: { publicKey: string; label?: string }): Promise<DeviceRecord>;
  listDevices(userId: string): Promise<DeviceRecord[]>;
  getDevice(userId: string, deviceId: string): Promise<DeviceRecord>;
  /** WS7-R11: an approved device hands the new one the user key. */
  approveDevice(userId: string, deviceId: string, approvedBy: string, wrapped: WrappedUserKey): Promise<DeviceRecord>;
  /** WS7-R14. */
  revokeDevice(userId: string, deviceId: string): Promise<DeviceRecord>;
  putRecovery(userId: string, recovery: RecoveryRecord): Promise<void>;
  getRecovery(userId: string): Promise<RecoveryRecord | null>;
  /** The member's public user key, published by their first device. */
  setUserPublicKey(userId: string, publicKey: string): Promise<UserRecord>;
  getUser(userId: string): Promise<UserRecord>;
  listUsers(): Promise<UserRecord[]>;
  /**
   * WS7-R13: an administrator restoring access for someone who has lost
   * every device and their recovery code. Their old user key becomes
   * unreachable, so everything wrapped to it goes: devices are revoked, the
   * recovery wrap is cleared, and the workspace wraps are dropped until the
   * administrator re-wraps to the new user key.
   */
  regrantUser(userId: string): Promise<UserRecord>;
  /** WS7-R8: the workspace key, wrapped to this user's public user key. */
  putWorkspaceKey(userId: string, generation: number, wrappedKey: string): Promise<void>;
  getWorkspaceKeys(userId: string): Promise<{ generation: number; wrappedKey: string }[]>;
}

/**
 * The short code both devices show (WS7-R11), derived from the new device's
 * public key. The store computes it from what it was given, and the
 * approving device computes it from the same bytes: if anything substituted
 * a key in between, the codes differ and the person stops.
 */
export async function verificationCodeFor(publicKeyBase64: string): Promise<string> {
  const digest = await sha256(Uint8Array.from(Buffer.from(publicKeyBase64, "base64")));
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O, U
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[digest[i] % alphabet.length];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

let counter = 0;
const newId = (prefix: string) => `${prefix}_${(++counter).toString(36)}${Date.now().toString(36)}`;

export function createMemoryUserDirectory(now: () => Date = () => new Date()): UserDirectory {
  const users = new Map<string, UserRecord>();
  const devices = new Map<string, DeviceRecord>();
  const recovery = new Map<string, RecoveryRecord>();
  const workspaceKeys = new Map<string, Map<number, string>>();
  const keyOf = (issuer: string, subject: string) => `${issuer}\u0000${subject}`;

  function requireDevice(userId: string, deviceId: string): DeviceRecord {
    const device = devices.get(deviceId);
    if (!device || device.userId !== userId) throw new DirectoryError(`No device ${deviceId}.`, "not-found");
    return device;
  }

  return {
    async upsertUser(identity) {
      const key = keyOf(identity.issuer, identity.subject);
      const existing = [...users.values()].find((user) => keyOf(user.issuer, user.subject) === key);
      if (existing) {
        if (identity.displayName) existing.displayName = identity.displayName;
        return { ...existing };
      }
      const user: UserRecord = { userId: newId("usr"), ...identity };
      users.set(user.userId, user);
      return { ...user };
    },

    async registerDevice(userId, device) {
      if (!device.publicKey) throw new DirectoryError("A device must register a public key.", "bad-request");
      // A user's first device is approved as it registers: it is the one
      // that generates the user key, so there is nothing to hand it and
      // nothing that could approve it. Every later device needs approval
      // from one that already has access (WS7-R11).
      const isFirst = ![...devices.values()].some((existing) => existing.userId === userId && !existing.revokedAt);
      const record: DeviceRecord = {
        deviceId: newId("dev"),
        userId,
        label: device.label,
        publicKey: device.publicKey,
        verificationCode: await verificationCodeFor(device.publicKey),
        createdAt: now().toISOString(),
        approvedAt: isFirst ? now().toISOString() : null,
        revokedAt: null,
        wrappedUserKey: null,
      };
      devices.set(record.deviceId, record);
      return { ...record };
    },

    async listDevices(userId) {
      return [...devices.values()].filter((device) => device.userId === userId).map((device) => ({ ...device }));
    },

    async getDevice(userId, deviceId) {
      return { ...requireDevice(userId, deviceId) };
    },

    async approveDevice(userId, deviceId, approvedBy, wrapped) {
      const approver = requireDevice(userId, approvedBy);
      if (approver.revokedAt) throw new DirectoryError("A revoked device cannot approve another.", "revoked");
      if (!approver.approvedAt) throw new DirectoryError("Only an approved device can approve another.", "not-approved");
      const device = requireDevice(userId, deviceId);
      if (device.revokedAt) throw new DirectoryError("That device has been revoked.", "revoked");
      if (device.approvedAt) throw new DirectoryError("That device is already approved.", "conflict");
      device.approvedAt = now().toISOString();
      device.wrappedUserKey = wrapped;
      return { ...device };
    },

    async revokeDevice(userId, deviceId) {
      const device = requireDevice(userId, deviceId);
      device.revokedAt = now().toISOString();
      // The wrap goes with it: a revoked device keeps nothing it can use to
      // reach the user key again (WS7-R14).
      device.wrappedUserKey = null;
      return { ...device };
    },

    async setUserPublicKey(userId, publicKey) {
      const user = users.get(userId);
      if (!user) throw new DirectoryError(`No user ${userId}.`, "not-found");
      user.publicKey = publicKey;
      return { ...user };
    },

    async getUser(userId) {
      const user = users.get(userId);
      if (!user) throw new DirectoryError(`No user ${userId}.`, "not-found");
      return { ...user };
    },

    async listUsers() {
      return [...users.values()].map((user) => ({ ...user }));
    },

    async regrantUser(userId) {
      const user = users.get(userId);
      if (!user) throw new DirectoryError(`No user ${userId}.`, "not-found");
      for (const device of devices.values()) {
        if (device.userId === userId && !device.revokedAt) {
          device.revokedAt = now().toISOString();
          device.wrappedUserKey = null;
        }
      }
      recovery.delete(userId);
      workspaceKeys.delete(userId);
      // The old user key is gone with the devices that held it.
      delete user.publicKey;
      return { ...user };
    },

    async putRecovery(userId, value) {
      recovery.set(userId, value);
    },

    async getRecovery(userId) {
      const found = recovery.get(userId);
      return found ? { ...found } : null;
    },

    async putWorkspaceKey(userId, generation, wrappedKey) {
      const perUser = workspaceKeys.get(userId) ?? new Map<number, string>();
      perUser.set(generation, wrappedKey);
      workspaceKeys.set(userId, perUser);
    },

    async getWorkspaceKeys(userId) {
      return [...(workspaceKeys.get(userId) ?? new Map<number, string>())].map(([generation, wrappedKey]) => ({ generation, wrappedKey }));
    },
  };
}
