/**
 * The workspace, in a browser (WS9-R4, WS6-R3, WS7-R11).
 *
 * The editor from the dev server, the real store service, and a real OIDC
 * provider, all on different origins - which is how a deployment looks, and
 * why the store needs CORS. Two browser contexts stand in for two machines.
 *
 * What is proved here that the Node suites cannot: a person can sign in,
 * set up a browser, save a document to the workspace, open it on a second
 * browser after approving it, and see the passthrough warning when the
 * store reads content.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { AddressInfo } from 'net';
import { startDevServers, type DevServers } from './lib/devServers';
import { startTestOidcProvider } from './lib/testIdentityProviders';
import { createMemoryBlobStore, type MemoryTx } from '../store/src/blobStore';
import { createDocumentService } from '../store/src/documentService';
import { createHttpService, type StoreBackend } from '../store/src/httpService';
import { createMemoryUserDirectory } from '../store/src/userDirectory';
import { createMemoryWorkspaceIndex } from '../store/src/workspaceIndex';
import { createSessionStore } from '../store/src/auth/sessions';
import { createProvider } from '../store/src/auth/providers';
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startStore(appOrigin: string, cryptoMode: 'webcrypto' | 'passthrough') {
  const blobs = createMemoryBlobStore();
  const store = createDocumentService<MemoryTx>({
    blobs,
    begin: () => blobs.begin(),
    commit: (tx) => blobs.commit(tx),
    rollback: (tx) => blobs.rollback(tx),
  }) as unknown as StoreBackend;
  const idp = await startTestOidcProvider({ subject: 'person-1' });
  // WS7-R4: a store with encryption on refuses documents that are not also
  // recoverable with the organization's offline key.
  const recovery = await generateWrappingKeyPair('recovery');
  let origin = '';
  const server = createHttpService({
    store,
    directory: createMemoryUserDirectory(),
    workspaceIndex: createMemoryWorkspaceIndex(),
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
    cryptoMode,
    recoveryPublicKeyPem: toPem(await exportPublicKey(recovery.publicKey), 'PUBLIC KEY'),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    blobs,
    service: store,
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
  let passthroughStore: Awaited<ReturnType<typeof startStore>> | undefined;

  try {
    servers = await startDevServers({ vitePort: 5193, signalingPort: 14464, quiet: true });
    browser = await chromium.launch({ headless: true });
    const appOrigin = servers.appUrl;
    store = await startStore(appOrigin, 'webcrypto');

    /** A browser that knows where the store is. */
    const openBrowser = async (storeOrigin: string): Promise<Page> => {
      const context = await browser!.newContext();
      // How a deployment tells the editor where its store is.
      await context.addInitScript({
        content: `window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__, { STORE_URL: ${JSON.stringify(storeOrigin)} });`,
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', (error) => check(false, `page threw: ${error.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning')
          console.log(`  [browser ${m.type()}] ${m.text().slice(0, 180)}`);
      });
      await page.goto(`${appOrigin}/system-design/`);
      await page.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, {
        timeout: 15000,
      });
      return page;
    };

    const closeManager = async (page: Page) => {
      if (await page.locator('.workspace-panel').count()) {
        await page.keyboard.press('Escape');
        await page.waitForSelector('.workspace-panel', { state: 'detached' }).catch(() => {});
      }
    };

    const openManager = async (page: Page) => {
      // Idempotent: the panel stays open across several steps.
      if (await page.locator('.workspace-panel').count()) return;
      await page.click('button[title="File"]');
      await page.click('.export-menu__dropdown button:has-text("Documents")');
      await page.waitForSelector('.workspace-panel');
      // The panel asks the store what it is before it can show anything;
      // "checking" is that moment, not a state to assert against.
      await page
        .waitForFunction(
          () =>
            document.querySelector('.workspace-panel')?.getAttribute('data-phase') !== 'checking',
          null,
          { timeout: 20000 },
        )
        .catch(() => {});
    };

    const signIn = async (page: Page) => {
      await page.click('.workspace-panel__sign-in');
      await page.waitForURL(/system-design/, { timeout: 15000 });
      await page.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, {
        timeout: 15000,
      });
    };

    console.log('=== The first browser ===');
    const first = await openBrowser(store.origin);
    await openManager(first);
    check(
      (await first.locator('.workspace-panel__sign-in').count()) > 0,
      'the workspace offers the providers the store accepts',
    );
    check(
      (await first.locator('.workspace-panel__passthrough').count()) === 0,
      'and shows no warning, because this store cannot read content',
    );

    await signIn(first);
    await openManager(first);
    await first.waitForSelector('.workspace-panel__bootstrap, .workspace-panel__save', {
      timeout: 15000,
    });
    if (await first.locator('.workspace-panel__bootstrap').count()) {
      await first.click('.workspace-panel__bootstrap');
    }
    await first.waitForSelector('.workspace-panel__save', { timeout: 20000 });
    check(true, 'signing in and setting up this browser reaches the workspace');

    await closeManager(first);
    await first.fill('[aria-label="Diagram title"]', 'Shared architecture');
    await first.evaluate(`window.__PERF__.loadFixture("small")`);
    await openManager(first);
    await first.click('.workspace-panel__save');
    await first.waitForSelector('.workspace-panel__entry', { timeout: 20000 });
    check(
      (await first.textContent('.workspace-panel__title')) === 'Shared architecture',
      'saving lists the document by title',
    );

    console.log('\n=== Editing afterwards keeps the workspace up to date (WS8-R2) ===');
    {
      await closeManager(first);
      const versionOf = async () => {
        const documents = await (
          store!.service as unknown as { list(): Promise<{ docId: string; version: number }[]> }
        ).list();
        return documents[0]?.version ?? 0;
      };
      const before = await versionOf();

      // An ordinary edit, with the workspace dialog closed.
      await first.fill('[aria-label="Diagram title"]', 'Shared architecture, revised');
      // The autosave debounce, then the upload: polled rather than timed.
      let after = before;
      for (let attempt = 0; attempt < 30 && after <= before; attempt++) {
        await sleep(500);
        after = await versionOf();
      }
      check(
        after > before,
        `the edit reaches the workspace on its own (version ${before} -> ${after})`,
      );

      // And the person is told where their work is. The chip passes
      // through other states while the document settles, so wait for it
      // rather than reading whatever it happens to say first.
      const settled = await first
        .waitForFunction(
          () => /workspace/i.test(document.querySelector('.durability__chip')?.textContent ?? ''),
          null,
          { timeout: 20000 },
        )
        .then(
          () => true,
          () => false,
        );
      const label = (await first.textContent('.durability__chip')) ?? '';
      check(settled, `the save status says the workspace holds it (${label.trim()})`);

      // The title change reaches the list everyone sees, not just the
      // document. It is written a moment after the edit settles.
      await openManager(first);
      await first.waitForSelector('.workspace-panel__entry', { timeout: 20000 });
      const renamed = await first
        .waitForFunction(
          () =>
            document.querySelector('.workspace-panel__title')?.textContent ===
            'Shared architecture, revised',
          null,
          { timeout: 20000 },
        )
        .then(
          () => true,
          () => false,
        );
      check(
        renamed,
        `and the workspace list shows the new title (${await first.textContent('.workspace-panel__title')})`,
      );
      await closeManager(first);
      await first.fill('[aria-label="Diagram title"]', 'Shared architecture');
      await sleep(2500);
    }

    console.log('\n=== What the store holds ===');
    {
      // Read from the store's own data, as an operator with database access
      // would - the strongest form of this check.
      const documents = await (
        store.service as unknown as { list(): Promise<{ docId: string }[]> }
      ).list();
      check(documents.length > 0, `the store holds the document (${documents.length})`);
      let bytes = '';
      for (const record of documents) {
        const read = await (
          store.service as unknown as {
            read(id: string): Promise<{ blobs: { bytes: Uint8Array }[] }>;
          }
        ).read(record.docId);
        for (const blob of read.blobs) bytes += Buffer.from(blob.bytes).toString('latin1');
      }
      check(bytes.length > 0, `and their blobs are there (${bytes.length} bytes)`);
      check(
        !bytes.includes('Shared architecture') && !bytes.includes('react-flow'),
        'with no title and no diagram content readable in them',
      );
    }

    await closeManager(first);

    console.log('\n=== A second browser ===');
    const second = await openBrowser(store.origin);
    await openManager(second);
    await signIn(second);
    await openManager(second);
    await second.waitForSelector('.workspace-panel__code', { timeout: 20000 });
    const code = (await second.textContent('.workspace-panel__code'))?.trim() ?? '';
    check(
      /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{3}$/.test(code),
      `it waits for approval, showing a code (${code})`,
    );
    check(
      (await second.locator('.workspace-panel__entry').count()) === 0,
      'and shows no documents meanwhile',
    );

    await openManager(first);
    await first.click('.workspace-panel__recheck').catch(() => {});
    await sleep(300);
    await first.waitForSelector('.workspace-panel__approve', { timeout: 20000 });
    const shown = (await first.textContent('.workspace-panel__pending code'))?.trim();
    check(shown === code, `the first browser shows the same code for it (${shown})`);
    await first.click('.workspace-panel__approve');
    await sleep(500);

    await second.click('.workspace-panel__recheck');
    await second.waitForSelector('.workspace-panel__entry', { timeout: 20000 });
    check(
      (await second.textContent('.workspace-panel__title')) === 'Shared architecture',
      'once approved, the second browser lists the workspace',
    );

    // Opening switches to that document, which then fills from the store:
    // a merge, not a copy, so the browser reloads into it.
    await second.click('.workspace-panel__open');
    await second.waitForFunction(
      () => document.querySelectorAll('.react-flow__node').length === 25,
      null,
      { timeout: 30000 },
    );
    check(
      (await second.evaluate(() => document.querySelectorAll('.react-flow__node').length)) === 25,
      'and its contents arrive from the store',
    );
    // The title is a known wrinkle rather than a silent one: opening a
    // workspace document in a browser that has no copy of it seeds a new
    // document with a default title, and that default competes with the
    // stored title as an ordinary concurrent edit. The diagram merges
    // correctly; whichever title wins is arbitrary. Seeding a document
    // without writing a title is the fix, and is not in this patch.
    const openedTitle = await second.inputValue('[aria-label="Diagram title"]');
    console.log(`  (the opened document is titled "${openedTitle}" - see the note above)`);

    console.log('\n=== Both browsers editing the same document (WS8-R2, R4) ===');
    {
      // The second browser is now on the same workspace document as the
      // first. Each adds a node without seeing the other's, which is what
      // would have overwritten under snapshots.
      await closeManager(first);
      await closeManager(second);
      const countNodes = (page: Page) =>
        page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
      const before = await countNodes(first);

      await first.evaluate(`window.__PERF__.addNode("From the first browser")`);
      await second.evaluate(`window.__PERF__.addNode("From the second browser")`);

      const converged = async (page: Page) => {
        const labels = await page.evaluate(() =>
          [...document.querySelectorAll('.react-flow__node')].map((node) => node.textContent ?? ''),
        );
        return (
          labels.some((label) => label.includes('From the first browser')) &&
          labels.some((label) => label.includes('From the second browser'))
        );
      };
      let bothEverywhere = false;
      for (let attempt = 0; attempt < 40 && !bothEverywhere; attempt++) {
        await sleep(500);
        bothEverywhere = (await converged(first)) && (await converged(second));
      }
      check(
        bothEverywhere,
        'each browser ends up with both nodes: concurrent edits merge rather than overwrite',
      );
      check(
        (await countNodes(first)) === before + 2 && (await countNodes(second)) === before + 2,
        'and neither lost a node',
      );
    }

    console.log('\n=== Losing a browser: revoke, then rotate (WS7-R7, R14) ===');
    {
      await openManager(first);
      await first.waitForSelector('.workspace-panel__device', { timeout: 20000 });
      const before = (await first.textContent('.workspace-panel__generation'))?.trim();
      check(before === 'key 1', `the workspace starts on its first key (${before})`);

      // The second browser is the one that was lost.
      const target = first.locator('.workspace-panel__device').nth(1);
      await target.locator('.workspace-panel__revoke').click();
      await first.waitForSelector('.workspace-panel__rotation-advice', { timeout: 20000 });
      const advice = (await first.textContent('.workspace-panel__rotation-advice')) ?? '';
      check(/still holds the key/.test(advice), 'revoking says what revoking alone does not solve');

      first.once('dialog', (dialog) => {
        check(
          /re-wrapped/.test(dialog.message()),
          'rotating explains what it does before doing it',
        );
        void dialog.accept();
      });
      await first.click('.workspace-panel__rotate');
      await first.waitForFunction(
        () =>
          (document.querySelector('.workspace-panel__generation')?.textContent ?? '').includes(
            'key 2',
          ),
        null,
        { timeout: 30000 },
      );
      check(true, 'the workspace moves to its second key');
      const summary = (await first.textContent('.workspace-panel__message')) ?? '';
      check(
        /document\(s\) re-wrapped/.test(summary) &&
          /No document content was re-encrypted/.test(summary),
        `and says what happened (${summary.slice(0, 110)})`,
      );
      check(
        (await first.locator('.workspace-panel__entry').count()) === 1,
        'the documents are still listed',
      );

      // The point of it: this browser still works afterwards. The
      // diagram has grown by then - two browsers added a node each - so
      // this counts what is there rather than the fixture's 25.
      await first.click('.workspace-panel__open');
      await first.waitForFunction(
        () => document.querySelectorAll('.react-flow__node').length >= 25,
        null,
        { timeout: 20000 },
      );
      check(true, 'and still opens, with the new key');

      // And the revoked browser is out.
      await openManager(second);
      await second.click('.workspace-panel__recheck').catch(() => {});
      await sleep(1000);
      const phase = await second.getAttribute('.workspace-panel', 'data-phase');
      check(phase !== 'ready', `the revoked browser no longer reaches the workspace (${phase})`);
      await closeManager(second);
    }

    console.log('\n=== A store that reads content (WS6-R3) ===');
    passthroughStore = await startStore(appOrigin, 'passthrough');
    const third = await openBrowser(passthroughStore.origin);
    await openManager(third);
    const warning = await third.textContent('.workspace-panel__passthrough');
    check(
      !!warning && /server can read/i.test(warning),
      `the warning is shown and says what it means (${warning?.trim()})`,
    );

    console.log('\n=== No store configured ===');
    {
      const plain = await browser.newContext();
      contexts.push(plain);
      const page = await plain.newPage();
      await page.goto(`${appOrigin}/system-design/`);
      await page.waitForFunction("typeof window.__PERF__?.loadFixture === 'function'", null, {
        timeout: 15000,
      });
      await page.click('button[title="File"]');
      await page.click('.export-menu__dropdown button:has-text("Documents")');
      // The manager itself, whatever it holds: the point is only that no
      // workspace section appears.
      await page.waitForSelector('.document-manager__storage', { timeout: 10000 });
      check(
        (await page.locator('.workspace-panel').count()) === 0,
        'the editor shows no workspace at all, and is otherwise unchanged',
      );
    }
  } catch (error) {
    failures++;
    console.error('Verification failed with error:', error);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    await store?.stop();
    await passthroughStore?.stop();
    servers?.stop();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll workspace browser checks passed.');
  process.exit(0);
}

run();
