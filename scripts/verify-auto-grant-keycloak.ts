/**
 * Automatic access with a real Keycloak, in a real browser (WS14 §14,
 * verify-auto-grant-keycloak).
 *
 * The example realm (docker/store/keycloak/system-design-realm.json) as it
 * ships: demo and otter in /design-team-a, Badger in /design-team-b. The
 * editor from the dev server, the store in this process, Keycloak on
 * :8081 - the same addresses as docker/store/compose.yaml, because the
 * realm's redirect URI and web origin name them.
 *
 * What only this proves: that Keycloak's own tokens carry the groups the way
 * the docs say, that its discovery and key endpoints answer the editor's
 * origin (CORS), and that the whole thing - settings, sign-in, waiting,
 * the unattended grant, removal and rotation - works through the interface.
 *
 * Needs Keycloak running with the example realm imported, reachable at
 * KEYCLOAK_URL (default http://localhost:8081); without it the suite says
 * so and exits cleanly, like the PostgreSQL suites without DATABASE_URL.
 * CHROMIUM_PATH points Playwright at a Chromium of your own if needed.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { startDevServers, type DevServers } from './lib/devServers';
import { createMemoryBlobStore, type MemoryTx } from '../store/src/blobStore';
import { createDocumentService } from '../store/src/documentService';
import { createHttpService, type StoreBackend } from '../store/src/httpService';
import { createMemoryUserDirectory } from '../store/src/userDirectory';
import { createMemoryWorkspaceIndex } from '../store/src/workspaceIndex';
import { createSessionStore } from '../store/src/auth/sessions';
import { createProvider } from '../store/src/auth/providers';
import { createMemoryAccessStore } from '../store/src/access';
import { exportPublicKey, generateWrappingKeyPair } from '../src/crypto/keys';
import { toPem } from '../src/crypto/documentPackage';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const KEYCLOAK = (process.env.KEYCLOAK_URL ?? 'http://localhost:8081').replace(/\/+$/, '');
const REALM = `${KEYCLOAK}/realms/system-design`;
// Fixed by the example realm: its redirect URI and web origin.
const STORE_PORT = 8080;
const STORE = `http://localhost:${STORE_PORT}`;
const EDITOR_PORT = 8088;

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

/** Keycloak's admin API, for taking someone out of a group mid-test. A
 * fresh token per call: master-realm admin tokens last a minute, and this
 * suite runs for several. */
async function keycloakAdmin() {
  const adminToken = () =>
    fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: process.env.KEYCLOAK_ADMIN ?? 'admin',
        password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'change-me',
      }),
    }).then((r) => r.json() as Promise<{ access_token: string }>);
  const api = async (path: string, init: RequestInit = {}) => {
    const token = await adminToken();
    const response = await fetch(`${KEYCLOAK}/admin/realms/system-design${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token.access_token}`, ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  return {
    async leaveGroup(username: string, group: string) {
      const [user] = (await api(`/users?username=${encodeURIComponent(username)}&exact=true`)) as {
        id: string;
      }[];
      const groups = (await api(`/users/${user.id}/groups`)) as { id: string; path: string }[];
      const found = groups.find((g) => g.path === group);
      if (!found) throw new Error(`${username} is not in ${group}`);
      await api(`/users/${user.id}/groups/${found.id}`, { method: 'DELETE' });
    },
    async joinGroup(username: string, group: string) {
      const [user] = (await api(`/users?username=${encodeURIComponent(username)}&exact=true`)) as {
        id: string;
      }[];
      const all = (await api(`/groups`)) as { id: string; path: string }[];
      const target = all.find((g) => g.path === group);
      if (!target) throw new Error(`no group ${group}`);
      await api(`/users/${user.id}/groups/${target.id}`, { method: 'PUT' });
    },
  };
}

async function run() {
  if (!(await reachable(`${REALM}/.well-known/openid-configuration`))) {
    console.log(
      `(Keycloak with the example realm is not reachable at ${KEYCLOAK}: this suite did not run)`,
    );
    // Nothing ran, so claim nothing passed.
    process.exit(0);
  }

  // Put the realm back as it ships, whatever an earlier run left.
  const admin = await keycloakAdmin();
  await admin.joinGroup('otter', '/design-team-a').catch(() => {});

  let servers: DevServers | undefined;
  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  const blobs = createMemoryBlobStore();
  const access = createMemoryAccessStore();
  const recovery = await generateWrappingKeyPair('recovery');
  const server = createHttpService({
    store: createDocumentService<MemoryTx>({
      blobs,
      begin: () => blobs.begin(),
      commit: (tx) => blobs.commit(tx),
      rollback: (tx) => blobs.rollback(tx),
    }) as unknown as StoreBackend,
    directory: createMemoryUserDirectory(),
    workspaceIndex: createMemoryWorkspaceIndex(),
    sessions: createSessionStore(),
    access,
    providers: [
      createProvider({
        id: 'oidc',
        kind: 'oidc',
        issuer: REALM,
        clientId: 'system-design-store',
        clientSecret: 'change-me',
      }),
    ],
    publicUrl: () => STORE,
    afterLoginUrl: `http://localhost:${EDITOR_PORT}/system-design/`,
    allowedOrigins: [`http://localhost:${EDITOR_PORT}`],
    recoveryPublicKeyPem: toPem(await exportPublicKey(recovery.publicKey), 'PUBLIC KEY'),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(STORE_PORT, resolve);
    });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'EADDRINUSE') {
      console.log(
        `(Port ${STORE_PORT} is already in use; this suite requires an available port ${STORE_PORT} for its in-process store: this suite did not run)`,
      );
      process.exit(0);
    }
    throw err;
  }

  try {
    servers = await startDevServers({ vitePort: EDITOR_PORT, signalingPort: 14474, quiet: true });
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
        : {}),
    });

    const open = async (): Promise<Page> => {
      const context = await browser!.newContext();
      await context.addInitScript({
        content: `window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__, { STORE_URL: ${JSON.stringify(STORE)}, RELAY: ${JSON.stringify(servers!.relayUrl)} });`,
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (error) => check(false, `page threw: ${error.message}`));
      await page.goto(`${servers!.appUrl}/system-design/`);
      await page.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, {
        timeout: 20000,
      });
      return page;
    };
    const openManager = async (page: Page) => {
      if (await page.locator('.workspace-panel').count()) return;
      await page.click('button[title="File"]');
      await page.click('.export-menu__dropdown button:has-text("Documents")');
      await page.waitForSelector('.workspace-panel');
      await page
        .waitForFunction(
          () =>
            document.querySelector('.workspace-panel')?.getAttribute('data-phase') !== 'checking',
          null,
          { timeout: 20000 },
        )
        .catch(() => {});
    };
    const closeManager = async (page: Page) => {
      if (await page.locator('.workspace-panel').count()) {
        await page.keyboard.press('Escape');
        await page.waitForSelector('.workspace-panel', { state: 'detached' }).catch(() => {});
      }
    };
    /** Through Keycloak's own login page. */
    const signIn = async (page: Page, username: string, password: string) => {
      await page.click('.workspace-panel__sign-in');
      await page.waitForURL(/\/realms\/system-design\//, { timeout: 20000 });
      await page.fill('#username', username);
      await page.fill('#password', password);
      await page.click('#kc-login');
      await page.waitForURL(/system-design\/$/, { timeout: 20000 });
      await page.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, {
        timeout: 20000,
      });
    };
    const phase = (page: Page) =>
      page.evaluate(() => document.querySelector('.workspace-panel')?.getAttribute('data-phase'));

    console.log('=== demo sets up the workspace ===');
    const demo = await open();
    await openManager(demo);
    await signIn(demo, 'demo', 'demo');
    await openManager(demo);
    await demo.waitForSelector('.workspace-panel__bootstrap, .workspace-panel__save', {
      timeout: 20000,
    });
    if (await demo.locator('.workspace-panel__bootstrap').count())
      await demo.click('.workspace-panel__bootstrap');
    await demo.waitForSelector('.workspace-panel__save', { timeout: 20000 });
    await closeManager(demo);
    await demo.fill('[aria-label="Diagram title"]', 'Team architecture');
    await demo.evaluate(`window.__PERF__.loadFixture("small")`);
    await openManager(demo);
    await demo.click('.workspace-panel__save');
    await demo.waitForSelector('.workspace-panel__entry', { timeout: 20000 });
    check(true, 'demo signs in through Keycloak and saves a document');

    console.log('\n=== demo turns on automatic access ===');
    await demo.click('.workspace-panel__auto-access summary');
    await demo.waitForSelector('.workspace-panel__auto-access-groups', { timeout: 10000 });
    const offered = await demo.textContent('.workspace-panel__auto-access');
    check(
      (offered ?? '').includes(REALM) && (offered ?? '').includes('system-design-store'),
      "the issuer and client shown are Keycloak's",
    );
    await demo.fill('.workspace-panel__auto-access-groups', '/design-team-a');
    await demo.check('.workspace-panel__auto-access label:has-text("automatically") input');
    await demo.check('.workspace-panel__auto-access label:has-text("will count") input');
    await demo.click('.workspace-panel__auto-access-save');
    await demo.waitForSelector('.workspace-panel__auto-access [role="status"]:has-text("Saved")', {
      timeout: 15000,
    });
    check(true, 'the rule saves');
    await closeManager(demo);

    console.log('\n=== otter, in /design-team-a, is let in with nobody pressing anything ===');
    const otter = await open();
    await openManager(otter);
    await signIn(otter, 'otter', 'otter');
    await openManager(otter);
    const waiting = await otter
      .waitForSelector('[data-join-view="waiting"]', { timeout: 30000 })
      .then(
        () => true,
        () => false,
      );
    check(waiting, 'otter is told they will be let in automatically');
    // demo's editor polls every 15 s and pauses up to 5 s before granting.
    const joined = await demo.waitForSelector('.access-request--joined', { timeout: 60000 }).then(
      () => true,
      () => false,
    );
    const notice = joined ? await demo.textContent('.access-request--joined') : '';
    check(
      joined && /otter( user)? joined through \/design-team-a/i.test(notice ?? ''),
      `demo's editor lets otter in, and says so (${(notice ?? '').trim()})`,
    );
    const ready = await otter
      .waitForFunction(
        () => document.querySelector('.workspace-panel')?.getAttribute('data-phase') === 'ready',
        null,
        { timeout: 30000 },
      )
      .then(
        () => true,
        () => false,
      );
    check(ready, `otter's panel reaches the workspace (phase: ${await phase(otter)})`);
    if (ready) {
      await otter.waitForSelector('.workspace-panel__entry', { timeout: 20000 }).catch(() => {});
      check(
        (await otter.textContent('.workspace-panel__title')) === 'Team architecture',
        "and sees demo's document",
      );
    }

    console.log('\n=== Badger, in /design-team-b, waits for a person ===');
    const badger = await open();
    await openManager(badger);
    await signIn(badger, 'Badger', 'badger');
    await openManager(badger);
    const notCovered = await badger
      .waitForSelector('[data-join-view="not-covered"]', { timeout: 30000 })
      .then(
        () => true,
        () => false,
      );
    check(notCovered, 'Badger is told none of their groups is set up here');
    await openManager(demo);
    const listed = await demo
      .waitForSelector('.workspace-panel >> text=/badger/i', { timeout: 20000 })
      .then(
        () => true,
        () => false,
      );
    check(listed, 'and demo still sees Badger waiting, to let in by hand');
    await closeManager(demo);

    console.log('\n=== otter leaves the group ===');
    await admin.leaveGroup('otter', '/design-team-a');
    // A fresh sign-in; Keycloak's own session means no password this time.
    await otter.goto(`${STORE}/v1/auth/oidc/start`);
    await otter.waitForURL(/system-design\/$/, { timeout: 20000 });
    const otterId = [...(await access.listMemberships('default'))].find(
      (m) => m.source === 'oidc_group',
    )?.userId;
    const removed = otterId ? await access.getMembership('default', otterId) : null;
    check(!!removed?.removedAt, 'the store removes otter at that sign-in');
    await openManager(otter);
    const told = await otter
      .waitForSelector('.workspace-panel__removed-notice', { timeout: 20000 })
      .then(
        () => true,
        () => false,
      );
    check(told, 'otter is told they are no longer in the workspace');
    await openManager(demo);
    const reason = await demo
      .waitForSelector('.workspace-panel__removed', { timeout: 20000 })
      .then((el) => el.textContent())
      .catch(() => null);
    check(
      /no longer in a group/.test(reason ?? ''),
      `demo's member list says otter was removed, and why (${(reason ?? '').trim()})`,
    );
    await closeManager(demo);
    const rotated = await (async () => {
      for (let i = 0; i < 40; i++) {
        const rule = await access.getRule('default');
        if (rule && !rule.rotationRequired) return true;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      return false;
    })();
    check(rotated, "and demo's open editor replaces the key within its next poll");

    console.log('\n=== otter is put back in the group, and rejoins from the interface ===');
    await admin.joinGroup('otter', '/design-team-a');
    await otter.click('.workspace-panel__sign-in-again');
    // Keycloak remembers otter: straight back to the editor, no password.
    await otter.waitForURL(/system-design\/$/, { timeout: 20000 });
    await otter.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, {
      timeout: 20000,
    });
    await openManager(otter);
    const rejoinWaiting = await otter
      .waitForSelector('[data-join-view="waiting"]', { timeout: 30000 })
      .then(
        () => true,
        () => false,
      );
    check(rejoinWaiting, 'otter is told they will be let back in');
    const backIn = await otter
      .waitForFunction(
        () => document.querySelector('.workspace-panel')?.getAttribute('data-phase') === 'ready',
        null,
        { timeout: 60000 },
      )
      .then(
        () => true,
        () => false,
      );
    check(backIn, `and demo's editor lets them back in (phase: ${await phase(otter)})`);
    check(
      !(otterId && (await access.getMembership('default', otterId))?.removedAt),
      'the removal is lifted',
    );
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    servers?.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await admin.joinGroup('otter', '/design-team-a').catch(() => {});
  }
}

await run();
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll Keycloak checks passed.');
