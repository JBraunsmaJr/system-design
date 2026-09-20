/**
 * Sessions (WS10-R1), over both stores.
 *
 * The same checks for each, because the in-memory one is what tests use
 * and the PostgreSQL one is what a deployment runs: a difference between
 * them would show up only in production. The two properties worth having a
 * database for at all - surviving a restart, and being visible to a second
 * instance - are checked explicitly.
 */
import { createSessionStore, type SessionStore } from "../store/src/auth/sessions.ts";
import { createPostgresSessionStore } from "../store/src/auth/postgresSessions.ts";
import type { PendingLogin } from "../store/src/auth/providers.ts";

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const IDENTITY = { issuer: "https://idp.example.gov", subject: "alice", displayName: "Alice" };
const pending = (state: string, createdAt = Date.now()): PendingLogin => ({
  state,
  provider: "oidc",
  nonce: "n",
  codeVerifier: "v",
  redirectUri: "https://store/v1/auth/callback",
  createdAt,
});

async function contract(name: string, make: () => SessionStore, makeShortLived: () => SessionStore) {
  console.log(`\n########## ${name} ##########`);
  const sessions = make();

  const created = await sessions.create(IDENTITY);
  check(created.id.length >= 32, "a session id is long enough to be unguessable");
  check(created.issuer === IDENTITY.issuer && created.subject === "alice", "it records (issuer, subject), not an email");
  const fetched = await sessions.get(created.id);
  check(fetched?.id === created.id, "and can be fetched back");
  check((await sessions.get("made-up")) === null, "an unknown id is not a session");
  check((await sessions.get(null)) === null, "and neither is no id at all");

  await sessions.setUserId(created.id, "user-1");
  check((await sessions.get(created.id))?.userId === "user-1", "the directory user is remembered with it");

  await sessions.destroy(created.id);
  check((await sessions.get(created.id)) === null, "destroying it takes effect at once");

  await sessions.remember(pending("state-1"));
  const taken = await sessions.take("state-1");
  check(taken?.codeVerifier === "v", "a pending sign-in comes back with what it needs");
  check((await sessions.take("state-1")) === null, "and only once: a state that returns twice is a replay");
  check((await sessions.take("never")) === null, "an unknown state is refused");

  // Expiry, without waiting for it.
  const shortLived = makeShortLived();
  const expiring = await shortLived.create(IDENTITY);
  await shortLived.remember(pending("state-2", Date.now() - 60_000));
  await new Promise((resolve) => setTimeout(resolve, 20));
  check((await shortLived.get(expiring.id)) === null, "an expired session is gone");
  check((await shortLived.take("state-2")) === null, "and so is a sign-in that never came back");
}

let pool: import("pg").Pool | undefined;

await contract(
  "memory",
  () => createSessionStore(),
  () => createSessionStore({ ttlMs: 1, pendingTtlMs: 1 }),
);

if (DATABASE_URL) {
  const pg = (await import("pg")).default;
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  const { createPostgresStore } = await import("../store/src/postgresStore.ts");
  const store = createPostgresStore({ connectionString: DATABASE_URL });
  await store.migrate();
  await store.close();
  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM pending_logins");

  await contract(
    "postgres",
    () => createPostgresSessionStore(pool!),
    () => createPostgresSessionStore(pool!, { ttlMs: 1, pendingTtlMs: 1 }),
  );

  console.log("\n########## what a database is for ##########");
  {
    // A restart, and a second instance: two stores over the same database,
    // as two containers behind a load balancer would be.
    const first = createPostgresSessionStore(pool);
    const session = await first.create(IDENTITY);
    const afterRestart = createPostgresSessionStore(pool);
    check((await afterRestart.get(session.id))?.subject === "alice", "a session survives the process that created it");
    const secondInstance = createPostgresSessionStore(pool);
    await secondInstance.destroy(session.id);
    check((await first.get(session.id)) === null, "and signing out on one instance ends it on the other");

    await first.remember(pending("shared-state"));
    check((await secondInstance.take("shared-state")) !== null, "a sign-in started on one instance can complete on another");
    check((await first.take("shared-state")) === null, "and cannot then be completed twice");
  }

  await pool.query("DELETE FROM sessions");
  await pool.query("DELETE FROM pending_logins");
  await pool.end();
} else {
  console.log("\n(DATABASE_URL is not set: PostgreSQL sessions are not covered by this run)");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll session checks passed.");
