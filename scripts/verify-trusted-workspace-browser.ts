/**
 * A trusted store, in a browser (docs/trusted-store.md).
 *
 * The editor from the dev server, the real store service with the workspace
 * API, and a real OIDC provider, each on its own origin as in a deployment.
 * Separate browser contexts stand in for separate people.
 *
 * What is proved here that the Node suites cannot:
 *   - the editor finds out the store is trusted and shows its own panel,
 *     with the notice that the server can read documents;
 *   - an administrator signs in, creates a workspace and puts the open
 *     document in it, with nothing to enrol and nobody to approve;
 *   - someone in a mapped group signs in and is simply in: they open the
 *     document and its content arrives;
 *   - an edit by one reaches the other, and the title reaches the list;
 *   - a viewer sees the document and cannot change the workspace's copy;
 *   - someone in no group sees no workspace.
 */
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import type { AddressInfo } from 'net';
import { type DevServers, startDevServers } from './lib/devServers';
import { startTestOidcProvider } from './lib/testIdentityProviders';
import { createMemoryBlobStore, type MemoryTx } from '../store/src/blobStore';
import { createDocumentService, type DocumentRecord } from '../store/src/documentService';
import { createHttpService, type StoreBackend } from '../store/src/httpService';
import { createMemoryUserDirectory } from '../store/src/userDirectory';
import { createSessionStore } from '../store/src/auth/sessions';
import { createProvider } from '../store/src/auth/providers';
import { createMemoryWorkspaceStore } from '../store/src/workspaces';
import { createMemoryDocumentCatalog } from '../store/src/documentCatalog';
import { createV2Api } from '../store/src/v2/api';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `test` holds, or gives up and returns false. */
async function eventually(test: () => Promise<boolean>, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await test().catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

const ADMIN_GROUP = 'notebook-admin';

async function startStore(appOrigin: string) {
  const blobs = createMemoryBlobStore();
  const documents = createDocumentService<MemoryTx>({
    blobs,
    begin: () => blobs.begin(),
    commit: (tx) => blobs.commit(tx),
    rollback: (tx) => blobs.rollback(tx),
  });
  const directory = createMemoryUserDirectory();
  const workspaces = createMemoryWorkspaceStore({
    userExists: (userId) =>
      directory.getUser(userId).then(
        () => true,
        () => false,
      ),
  });
  const catalog = createMemoryDocumentCatalog({
    workspaceExists: async (id) => (await workspaces.getWorkspace(id)) !== null,
  });
  const idp = await startTestOidcProvider({ subject: 'ada' });
  let origin = '';
  const server = createHttpService({
    store: documents as unknown as StoreBackend,
    directory,
    sessions: createSessionStore(),
    providers: [
      createProvider({
        id: 'oidc',
        kind: 'oidc',
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecret: idp.clientSecret,
      }),
    ],
    publicUrl: () => origin,
    afterLoginUrl: `${appOrigin}/system-design/`,
    allowedOrigins: [appOrigin],
    v2: createV2Api({
      workspaces,
      catalog,
      documents: documents as unknown as StoreBackend,
      directory,
      isAdmin: ({ groups }) => groups.includes(ADMIN_GROUP),
      workspaceCreation: 'admins',
      publicUrl: () => origin,
      allowedOrigins: [appOrigin],
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    idp,
    documents,
    workspaces,
    catalog,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await idp.close();
    },
  };
}

async function run() {
  let servers: DevServers | undefined;
  let browser: Browser | undefined;
  const contexts: BrowserContext[] = [];
  let store: Awaited<ReturnType<typeof startStore>> | undefined;

  try {
    servers = await startDevServers({ vitePort: 5197, signalingPort: 14468, quiet: true });
    browser = await chromium.launch({ headless: true });
    const appOrigin = servers.appUrl;
    store = await startStore(appOrigin);
    const theStore = store;

    /** A browser that knows where the store is: a separate person. */
    const openBrowser = async (): Promise<Page> => {
      const context = await browser!.newContext();
      await context.addInitScript({
        content: `window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__, { STORE_URL: ${JSON.stringify(theStore.origin)} });`,
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (error) => check(false, `page threw: ${error.message}`));
      await page.goto(`${appOrigin}/system-design/`);
      await ready(page);
      return page;
    };

    const ready = (page: Page) =>
      page.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, {
        timeout: 20000,
      });

    const closeManager = async (page: Page) => {
      if (await page.locator('.trusted-workspace').count()) {
        await page.keyboard.press('Escape');
        await page.waitForSelector('.trusted-workspace', { state: 'detached' }).catch(() => {});
      }
    };

    const openManager = async (page: Page) => {
      if (!(await page.locator('.trusted-workspace').count())) {
        await page.click('button[title="File"]');
        await page.click('.export-menu__dropdown button:has-text("Documents")');
        await page.waitForSelector('.trusted-workspace');
      }
      await page.waitForFunction(
        () =>
          document.querySelector('.trusted-workspace')?.getAttribute('data-phase') !== 'loading',
        null,
        { timeout: 20000 },
      );
    };

    /** Signs this browser in as whoever the provider currently says. */
    const signInAs = async (page: Page, subject: string, groups: string[]) => {
      theStore.idp.setSubject(subject, subject[0].toUpperCase() + subject.slice(1));
      theStore.idp.setClaims({ groups });
      await openManager(page);
      await Promise.all([page.waitForNavigation(), page.click('.trusted-workspace__sign-in')]);
      await ready(page);
    };

    const titleOf = (page: Page) => page.inputValue('[aria-label="Diagram title"]');
    const nodeCount = (page: Page) => page.locator('.react-flow__node').count();
    const record = async (docId: string) =>
      (await theStore.documents.head(docId, { includeDeleted: true })) as DocumentRecord;

    // --- An administrator sets things up ------------------------------------
    console.log('=== An administrator ===');
    const ada = await openBrowser();
    await openManager(ada);
    check(
      (await ada.locator('.workspace-panel:not(.trusted-workspace)').count()) === 0,
      'the editor shows the trusted panel, not the key-based one',
    );
    check(
      /administrators can read them/.test(
        (await ada.textContent('.trusted-workspace__notice')) ?? '',
      ),
      'which says plainly that the server can read documents',
    );
    check(
      (await ada.getAttribute('.trusted-workspace', 'data-phase')) === 'signed-out',
      'signed out, it asks for sign-in',
    );

    await signInAs(ada, 'ada', [ADMIN_GROUP]);
    await openManager(ada);
    check(
      (await ada.getAttribute('.trusted-workspace', 'data-phase')) === 'ready' &&
        (await ada.locator('.workspace-panel__who').textContent()) === 'Ada',
      'after signing in the panel is ready at once: nothing to enrol, nobody to wait for',
    );
    check(
      /not in any workspace yet/.test((await ada.textContent('.trusted-workspace')) ?? ''),
      'a new store has no workspaces',
    );

    await ada.click('.trusted-workspace__new');
    await ada.fill('#trusted-workspace-name', 'Platform Team');
    await ada.click('.trusted-workspace form button[type="submit"]');
    await ada.waitForSelector('#trusted-workspace-select');
    check(
      (await ada.locator('#trusted-workspace-select option').allTextContents()).join(',') ===
        'Platform Team' &&
        /You are an owner here/.test((await ada.textContent('.trusted-workspace__role')) ?? ''),
      'an administrator creates a workspace and is its owner',
    );

    await closeManager(ada);
    await ada.fill('[aria-label="Diagram title"]', 'Shared architecture');
    await ada.evaluate(`window.__PERF__.loadFixture("small")`);
    const nodesInFixture = await nodeCount(ada);
    const originalUrl = ada.url();
    await openManager(ada);
    await Promise.all([ada.waitForNavigation(), ada.click('.trusted-workspace__add')]);
    await ready(ada);
    const workspace = (await theStore.workspaces.listWorkspaces())[0];
    const [entry] = await theStore.catalog.listByWorkspace(workspace.workspaceId);
    const docId = entry.docId;
    check(
      docId !== 'local' && ada.url() !== originalUrl && ada.url().includes(docId),
      'adding the open document puts a copy in the workspace under a new id, and opens it',
    );
    check((await record(docId)).blobs.length > 0, "the copy's content is in the store");
    check(
      (await eventually(async () => (await nodeCount(ada)) === nodesInFixture)) &&
        (await eventually(async () => (await titleOf(ada)) === 'Shared architecture')),
      'and the copy opens with the same content and title',
    );
    await openManager(ada);
    await ada.waitForSelector('.trusted-workspace__document');
    check(
      (await ada.textContent('.trusted-workspace__document-title')) === 'Shared architecture',
      'the workspace lists it by title',
    );
    check(
      /saves there as you work/.test((await ada.textContent('.trusted-workspace')) ?? ''),
      'the panel says the open document is in the workspace',
    );

    // Map two identity-provider groups to roles, as an owner does.
    await ada.click('.trusted-workspace__access-toggle');
    await ada.waitForSelector('.workspace-access');
    check(
      (await ada.locator('.workspace-access__entry[data-kind="member"]').count()) === 1 &&
        /Ada \(you\)/.test(
          (await ada.textContent('.workspace-access__entry[data-kind="member"]')) ?? '',
        ),
      'the members list shows the person who created the workspace, marked as them',
    );
    const mapGroup = async (group: string, role: string) => {
      await ada.fill('#workspace-access-group', group);
      await ada.selectOption('select[aria-label="Role for the new group"]', role);
      await ada.click('.workspace-access__add-group');
      await ada.waitForSelector(`.workspace-access__entry[data-kind="group"]:has-text("${group}")`);
    };
    await mapGroup('platform-eng', 'editor');
    await mapGroup('auditors', 'viewer');
    const mappings = await theStore.workspaces.listGroupMappings(workspace.workspaceId);
    check(
      mappings.length === 2 &&
        mappings.find((m) => m.group === 'platform-eng')?.role === 'editor' &&
        mappings.find((m) => m.group === 'auditors')?.role === 'viewer',
      'an owner maps groups to roles from the panel',
    );

    // --- Someone in a mapped group ------------------------------------------
    console.log('\n=== An editor, through a group ===');
    const ben = await openBrowser();
    await signInAs(ben, 'ben', ['platform-eng']);
    await openManager(ben);
    check(
      /You are an editor here, through the group platform-eng/.test(
        (await ben.textContent('.trusted-workspace__role')) ?? '',
      ),
      'signing in is enough: the group gives the role, and the panel says how',
    );
    check(
      (await ben.locator('.trusted-workspace__new').count()) === 0,
      'they are not offered a way to create workspaces',
    );
    await ben.waitForSelector('.trusted-workspace__open');
    check(
      /only in this browser/.test((await ben.textContent('.trusted-workspace')) ?? ''),
      "their own first document is still theirs alone: it shares an id with everyone's, and is not mistaken for the workspace's",
    );
    await Promise.all([ben.waitForNavigation(), ben.click('.trusted-workspace__open')]);
    await ready(ben);
    check(
      await eventually(async () => (await nodeCount(ben)) === nodesInFixture && nodesInFixture > 0),
      `opening the document brings its content (${nodesInFixture} nodes)`,
    );
    check(
      await eventually(async () => (await titleOf(ben)) === 'Shared architecture'),
      'and its title',
    );
    check(
      (await theStore.catalog.get(docId))?.title === 'Shared architecture',
      "without the new browser's placeholder title having been published",
    );

    console.log('\n=== Editing together ===');
    await ben.fill('[aria-label="Diagram title"]', 'Shared architecture, revised');
    await closeManager(ada);
    check(
      await eventually(async () => (await titleOf(ada)) === 'Shared architecture, revised'),
      "one person's edit reaches the other",
    );
    check(
      await eventually(
        async () => (await theStore.catalog.get(docId))?.title === 'Shared architecture, revised',
      ),
      "and the new title reaches the workspace's list",
    );
    await ada.evaluate(`window.__PERF__.loadFixture("medium")`);
    const nodesAfterEdit = await nodeCount(ada);
    check(
      nodesAfterEdit !== nodesInFixture &&
        (await eventually(async () => (await nodeCount(ben)) === nodesAfterEdit)),
      `and a change the other way arrives too (${nodesAfterEdit} nodes)`,
    );

    // --- A viewer -------------------------------------------------------------
    console.log('\n=== A viewer ===');
    const vic = await openBrowser();
    await signInAs(vic, 'vic', ['auditors']);
    await openManager(vic);
    check(
      /You are a viewer here/.test((await vic.textContent('.trusted-workspace__role')) ?? ''),
      'a viewer sees the workspace',
    );
    await vic.waitForSelector('.trusted-workspace__document');
    check(
      (await vic.locator('.trusted-workspace__add').count()) === 0 &&
        (await vic.locator('.trusted-workspace__document button[aria-label^="Delete"]').count()) ===
          0,
      'with no way offered to add or delete documents',
    );
    await Promise.all([vic.waitForNavigation(), vic.click('.trusted-workspace__open')]);
    await ready(vic);
    check(
      await eventually(async () => (await nodeCount(vic)) === nodesAfterEdit),
      'and can open a document and read it',
    );
    const versionBefore = (await record(docId)).version;
    await vic.fill('[aria-label="Diagram title"]', 'Defaced by a viewer');
    await sleep(4000);
    check(
      (await record(docId)).version === versionBefore &&
        (await theStore.catalog.get(docId))?.title === 'Shared architecture, revised' &&
        (await titleOf(ada)) === 'Shared architecture, revised',
      "a viewer's edit stays in their browser: the store and other people are unchanged",
    );

    // --- Someone in no group ----------------------------------------------------
    console.log('\n=== Someone in no workspace ===');
    const zed = await openBrowser();
    await signInAs(zed, 'zed', []);
    await openManager(zed);
    check(
      /not in any workspace yet/.test((await zed.textContent('.trusted-workspace')) ?? '') &&
        (await zed.locator('.trusted-workspace__document').count()) === 0,
      'sees no workspace and no documents',
    );
    await zed.goto(`${appOrigin}/system-design/?doc=${encodeURIComponent(docId)}`);
    await ready(zed);
    await sleep(3000);
    check(
      (await nodeCount(zed)) === 0,
      "and opening the document's address directly brings them nothing",
    );

    // --- Deleting -------------------------------------------------------------------
    console.log('\n=== Deleting ===');
    await openManager(ada);
    await ada.click('.trusted-workspace__document button[aria-label^="Delete"]');
    await ada.click('.trusted-workspace__document button:has-text("Delete")');
    check(
      await eventually(async () => (await record(docId)).deletedAt !== null),
      'an owner deletes the document from the workspace',
    );
    check(
      await eventually(
        async () => (await ada.locator('.trusted-workspace__document').count()) === 0,
      ),
      'and it leaves the list',
    );

    // --- Managing who is in a workspace -------------------------------------
    console.log('\n=== Managing a workspace ===');
    const reopen = async (page: Page) => {
      await closeManager(page);
      await openManager(page);
    };
    const roleText = async (page: Page) =>
      (await page.locator('.trusted-workspace__role').count())
        ? ((await page.textContent('.trusted-workspace__role')) ?? '')
        : '';

    // A viewer sees who is here and can change none of it.
    await reopen(vic);
    await vic.click('.trusted-workspace__access-toggle');
    await vic.waitForSelector('.workspace-access');
    check(
      (await vic.locator('.workspace-access__entry[data-kind="group"]').count()) === 2 &&
        (await vic.locator('.workspace-access select').count()) === 0 &&
        (await vic.locator('.workspace-access input').count()) === 0 &&
        (await vic.locator('.trusted-workspace__rename').count()) === 0 &&
        (await vic.locator('.trusted-workspace__archive').count()) === 0,
      'a viewer sees the members and groups, with nothing to change them',
    );

    // Adding someone by name. Zed has signed in, so the store knows them.
    const showMembers = async (page: Page) => {
      await openManager(page);
      if (!(await page.locator('.workspace-access').count())) {
        await page.click('.trusted-workspace__access-toggle');
      }
      await page.waitForSelector('.workspace-access__section');
    };
    await showMembers(ada);
    await ada.fill('#workspace-access-person', 'ze');
    await ada.selectOption('select[aria-label="Role for the new person"]', 'viewer');
    await ada.click('.workspace-access__add-person');
    await ada.waitForSelector('.workspace-access__entry[data-kind="member"]:has-text("Zed")');
    check(
      await (async () => {
        const members = await theStore.workspaces.listMembers(workspace.workspaceId);
        return members.length === 2 && members.filter((m) => m.role === 'viewer').length === 1;
      })(),
      'an owner finds someone by name and adds them',
    );
    await zed.goto(`${appOrigin}/system-design/`);
    await ready(zed);
    await openManager(zed);
    check(
      /You are a viewer here\./.test(await roleText(zed)),
      'who then sees the workspace, with no approval step',
    );

    // Changing a role.
    await ada.selectOption('select[aria-label="Role for Zed"]', 'owner');
    check(
      await eventually(async () => {
        await reopen(zed);
        return /You are an owner here\./.test(await roleText(zed));
      }),
      "changing someone's role takes effect for them",
    );

    // An owner who is not an administrator is warned before giving up the role.
    await zed.click('.trusted-workspace__access-toggle');
    await zed.waitForSelector('.workspace-access select[aria-label="Role for Zed"]');
    await zed.selectOption('select[aria-label="Role for Zed"]', 'viewer');
    await zed.waitForSelector('.workspace-access__confirm');
    const zedBefore = (await theStore.workspaces.listMembers(workspace.workspaceId)).filter(
      (m) => m.role === 'owner',
    ).length;
    check(
      /become a viewer/.test((await zed.textContent('.workspace-access__confirm')) ?? '') &&
        zedBefore === 2,
      'demoting yourself asks first, and changes nothing until confirmed',
    );
    await zed.click('.workspace-access__confirm-yes');
    check(
      (await eventually(async () => /You are a viewer here\./.test(await roleText(zed)))) &&
        (await eventually(
          async () => (await zed.locator('.workspace-access select').count()) === 0,
        )),
      'confirming it makes them a viewer, and the controls go',
    );

    // Removing a group.
    await ada.click('button[aria-label="Remove the group auditors"]');
    check(
      await eventually(async () => {
        await reopen(vic);
        return /not in any workspace yet/.test((await vic.textContent('.trusted-workspace')) ?? '');
      }),
      'removing a group mapping removes the workspace for people who had it only through that group',
    );

    // Renaming.
    await ada.click('.trusted-workspace__rename');
    await ada.fill('#trusted-workspace-rename', 'Platform Group');
    await ada.click('form:has(#trusted-workspace-rename) button[type="submit"]');
    check(
      await eventually(
        async () =>
          (await theStore.workspaces.getWorkspace(workspace.workspaceId))?.name ===
          'Platform Group',
      ),
      'an owner renames the workspace',
    );

    // Archiving, which only an administrator is offered.
    await reopen(ben);
    check(
      (await ben.locator('.trusted-workspace__archive').count()) === 0 &&
        /Platform Group/.test((await ben.textContent('.trusted-workspace__select')) ?? ''),
      'an editor sees the new name and is not offered archiving',
    );
    await ada.click('.trusted-workspace__archive');
    check(
      (await theStore.workspaces.getWorkspace(workspace.workspaceId))?.archivedAt === null,
      'archiving asks first',
    );
    await ada.click('.trusted-workspace__archive-yes');
    await ada.waitForSelector('.trusted-workspace__restore');
    check(
      /\(archived\)/.test((await ada.textContent('.trusted-workspace__select')) ?? '') &&
        (await ada.locator('.trusted-workspace__rename').count()) === 0,
      'the administrator still sees it, marked archived and not editable',
    );
    await reopen(ben);
    check(
      /not in any workspace yet/.test((await ben.textContent('.trusted-workspace')) ?? ''),
      'its members no longer see it',
    );
    await ada.click('.trusted-workspace__restore');
    check(
      await eventually(async () => {
        await reopen(ben);
        return /You are an editor here/.test(await roleText(ben));
      }),
      'restoring brings it back for them',
    );

    // --- Pointing an editor at a store ---------------------------------------
    console.log('\n=== Choosing a store in the browser ===');
    {
      // An editor served with no store configured, as the public build is.
      const context = await browser!.newContext();
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (error) => check(false, `page threw: ${error.message}`));
      await page.goto(`${appOrigin}/system-design/`);
      await ready(page);
      const openDocuments = async () => {
        await page.click('button[title="File"]');
        await page.click('.export-menu__dropdown button:has-text("Documents")');
        await page.waitForSelector('.store-connection');
      };
      await openDocuments();
      check(
        /No store\. Documents are kept in this browser only/.test(
          (await page.textContent('.store-connection')) ?? '',
        ) && (await page.locator('.trusted-workspace').count()) === 0,
        'with no store, the editor says so and shows no workspaces',
      );

      await page.click('.store-connection__change');
      await page.fill('#store-connection-address', 'ftp://store.example.com');
      await page.click('.store-connection__connect');
      check(
        /starts with https/.test(
          (await page.textContent('.store-connection [role="alert"]')) ?? '',
        ),
        'an address that cannot be a store is refused with the reason',
      );

      // Somewhere that answers, but is not a store: the editor's own server.
      await page.fill('#store-connection-address', appOrigin);
      await page.click('.store-connection__connect');
      await page.waitForFunction(() =>
        /No store answered/.test(document.querySelector('.store-connection')?.textContent ?? ''),
      );
      const refusal = (await page.textContent('.store-connection [role="alert"]')) ?? '';
      check(
        refusal.includes('ALLOWED_ORIGINS') && refusal.includes(appOrigin),
        'an address with no store behind it is not saved, and the message names the origin to allow',
      );
      check(
        (await page.evaluate(() => localStorage.getItem('system-design-editor:store-url'))) ===
          null,
        'nothing is remembered until a store answers',
      );

      await page.fill('#store-connection-address', `${theStore.origin}/`);
      await Promise.all([page.waitForNavigation(), page.click('.store-connection__connect')]);
      await ready(page);
      await openManager(page);
      check(
        (await page.getAttribute('.trusted-workspace', 'data-phase')) === 'signed-out' &&
          ((await page.textContent('.store-connection')) ?? '').includes(theStore.origin) &&
          /Chosen in this browser/.test((await page.textContent('.store-connection')) ?? ''),
        'a real store is remembered: after the reload the editor is connected to it',
      );

      const before = page.url();
      theStore.idp.setSubject('ben', 'Ben');
      theStore.idp.setClaims({ groups: ['platform-eng'] });
      await Promise.all([page.waitForNavigation(), page.click('.trusted-workspace__sign-in')]);
      await ready(page);
      check(
        page.url() === before && /[?&]doc=/.test(before),
        'signing in returns to the same page and document',
      );
      await openManager(page);
      check(/You are an editor here/.test(await roleText(page)), 'and the workspaces are there');

      await page.click('.store-connection__change');
      await Promise.all([page.waitForNavigation(), page.click('.store-connection__forget')]);
      await ready(page);
      await openDocuments();
      check(
        (await page.locator('.trusted-workspace').count()) === 0 &&
          /No store\./.test((await page.textContent('.store-connection')) ?? ''),
        'forgetting the store returns the editor to working on its own',
      );
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    await store?.stop().catch(() => {});
    servers?.stop();
  }
}

await run();
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll trusted workspace browser checks passed.');
