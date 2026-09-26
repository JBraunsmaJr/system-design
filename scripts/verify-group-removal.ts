/**
 * Leaving a group, end to end (WS14-R13, R30 to R35).
 *
 * People a group let in are removed when they no longer match - at their
 * next sign-in, or at once when a member narrows the rule and asks for that.
 * A removed person is refused everything that serves the workspace, and the
 * key is replaced by exactly one member's browser, without anyone asking.
 * People let in by hand are never touched by groups. And someone put back
 * in the group can join again.
 */
import {
  WORKSPACE,
  forEachBackend,
  makeBrowser,
  startStore,
  type Backend,
  type Browser,
} from './lib/joinHarness.ts';
import { bootstrapFirstDevice, enrollDevice } from '../src/collab/deviceIdentity.ts';
import { pendingUserKeySource, signInUrlFor, submitJoinRequest } from '../src/collab/joinFlow.ts';
import { loadAccessRule, saveAccessRule } from '../src/collab/accessRule.ts';
import { createRejectionMemory, runAutoGrant } from '../src/collab/autoGrant.ts';
import { rotateIfRequired } from '../src/collab/autoRotation.ts';
import { indexKeyFor, fromBase64 } from '../src/collab/workspaceDocuments.ts';
import { importPublicKey, wrapKeyForPublicKey } from '../src/crypto/keys.ts';
import { createJwksSource, createMemoryRuleVersionStore } from '../src/crypto/idToken.ts';
import { toBase64 } from '../src/collab/workspaceDocuments.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

/** The HTTP status of a call, for checking what is refused. */
async function statusOf(work: () => Promise<unknown>): Promise<number> {
  try {
    await work();
    return 200;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

async function run(name: string, backend: Backend) {
  console.log(`\n########## ${name} ##########`);
  const { origin, idp, audit, close } = await startStore(backend);
  const as = (subject: string, groups: string[] | Record<string, unknown>) =>
    makeBrowser(origin, idp, subject, groups);
  const noWait = { sleep: async () => {}, random: () => 0 };

  try {
    // -- setup: a member, a rule, two people let in by group, one by hand --
    console.log('=== Setup ===');
    const demo = as('demo', ['/design-team-a']);
    await demo.signIn();
    let state = await enrollDevice({ api: demo.api, storage: demo.devices });
    if (state.status === 'needs-setup')
      state = await bootstrapFirstDevice({ api: demo.api, storage: demo.devices });
    let workspaceKey = state.workspaceKey!;
    let generation = 1;
    await demo.client.updateIndex(WORKSPACE, await indexKeyFor(workspaceKey), (e) => e);
    const oidc = (await demo.client.providerDetails()).providers[0];
    const demoId = (await demo.client.me()).userId;
    const saveRule = (enabled: boolean, groups: string[], removeMembers = false) =>
      saveAccessRule({
        client: demo.client,
        workspaceId: WORKSPACE,
        workspaceKey,
        generation,
        edit: { enabled, groups, issuer: oidc.issuer!, audience: oidc.clientId, removeMembers },
        updatedBy: demoId,
      });
    await saveRule(true, ['/design-team-a']);

    const grantPass = () =>
      runAutoGrant({
        client: demo.client,
        workspaceId: WORKSPACE,
        workspaceKey,
        generation,
        keySource: createJwksSource(),
        ruleVersions: createMemoryRuleVersionStore(),
        memory: createRejectionMemory(),
        ...noWait,
      });

    /** Signs in with a commitment, enrols, asks, and is let in. */
    const joinByGroup = async (browser: Browser) => {
      await browser.signIn();
      await enrollDevice({
        api: browser.api,
        storage: browser.devices,
        userKeySource: pendingUserKeySource(browser.pending),
      });
      await submitJoinRequest(browser.client, browser.pending);
      await grantPass();
      return enrollDevice({ api: browser.api, storage: browser.devices });
    };

    const otter = as('otter', ['/design-team-a']);
    const vole = as('vole', ['/design-team-a']);
    check((await joinByGroup(otter)).status === 'ready', 'otter joins through the group');
    const voleState = await joinByGroup(vole);
    check(voleState.status === 'ready', 'vole joins through the group');

    const dora = as('dora', []);
    await dora.signInAt(dora.client.signInUrl('oidc'));
    await enrollDevice({ api: dora.api, storage: dora.devices });
    const doraKey = (await dora.client.me()).publicKey!;
    const doraId = (await dora.client.me()).userId;
    await demo.client.grantWorkspaceKey(
      doraId,
      1,
      toBase64(await wrapKeyForPublicKey(workspaceKey, await importPublicKey(fromBase64(doraKey)))),
    );
    check(
      (await enrollDevice({ api: dora.api, storage: dora.devices })).status === 'ready',
      'dora is let in by hand',
    );
    const otterId = (await otter.client.me()).userId;
    const voleId = (await vole.client.me()).userId;

    // -- R31: leaving the group --------------------------------------------
    console.log('\n=== R31: leaving the group, noticed at sign-in ===');
    const otterLeft = as('otter', ['/other']);
    await otterLeft.signInAt(otterLeft.client.signInUrl('oidc'));
    const membership = await backend.access.getMembership(WORKSPACE, otterId);
    check(!!membership?.removedAt, 'otter is removed at sign-in');
    check(
      (await demo.client.getRoutingRule(WORKSPACE))?.rotationRequired === true,
      'and the workspace now needs a new key',
    );
    check(
      audit
        .all()
        .some((e) => e.operation === 'membership.removed' && e.detail?.cause === 'sign-in'),
      'the removal is audited, with its cause',
    );

    console.log('\n=== R31: what a removed member is refused ===');
    const indexKey = await indexKeyFor(workspaceKey);
    check(
      (await statusOf(() => otter.client.readIndex(WORKSPACE, indexKey))) === 403,
      'the index (403), even on the session they already had',
    );
    check(
      (await statusOf(() => otterLeft.client.getDocument('any-document', '00'))) === 403,
      'the documents (403)',
    );
    check(
      (await statusOf(() => otter.client.listDevices())) === 403,
      'their devices, and so their keys (403)',
    );
    check((await statusOf(() => otter.client.listMembers())) === 403, 'the member list (403)');
    check(
      (await statusOf(() => otterLeft.client.session())) === 200 &&
        (await statusOf(() => otterLeft.client.me())) === 200,
      'but they can still sign in and see who they are',
    );
    check(
      (await statusOf(() => demo.client.readIndex(WORKSPACE, indexKey))) === 200,
      'and nobody else is affected',
    );

    console.log('\n=== R35: manual members, and overage ===');
    const doraAgain = as('dora', ['/nothing-relevant']);
    await doraAgain.signInAt(doraAgain.client.signInUrl('oidc'));
    check(
      !(await backend.access.getMembership(WORKSPACE, doraId))?.removedAt,
      'dora, let in by hand, is not removed by her groups',
    );
    const voleOverage = as('vole', { _claim_names: { groups: 'src1' } });
    await voleOverage.signInAt(voleOverage.client.signInUrl('oidc'));
    check(
      !(await backend.access.getMembership(WORKSPACE, voleId))?.removedAt,
      'vole, whose groups were left out (overage), is not removed on no evidence',
    );

    // -- R34: rotation, by exactly one browser -----------------------------
    console.log('\n=== R34: the key is replaced by exactly one browser ===');
    const attempts = await Promise.all([
      rotateIfRequired({ client: demo.client, workspaceId: WORKSPACE, workspaceKey, generation }),
      rotateIfRequired({
        client: vole.client,
        workspaceId: WORKSPACE,
        workspaceKey: voleState.workspaceKey!,
        generation,
      }),
    ]);
    const winners = attempts.filter((result) => result !== null);
    check(winners.length === 1, 'two browsers try at once; exactly one rotates');
    const rotated = winners[0]!;
    check(rotated.generation === 2, 'to generation 2, not 3');
    workspaceKey = (await enrollDevice({ api: demo.api, storage: demo.devices })).workspaceKey!;
    generation = 2;
    const newIndex = await demo.client.readIndex(WORKSPACE, await indexKeyFor(workspaceKey));
    check(newIndex.generation === 2, 'the index opens with the new key');
    check(
      (await demo.client.getRoutingRule(WORKSPACE))?.rotationRequired === false,
      'the store clears the flag once the index moves on',
    );
    check(
      (await rotateIfRequired({
        client: demo.client,
        workspaceId: WORKSPACE,
        workspaceKey,
        generation,
      })) === null,
      'and nobody rotates again',
    );
    const members = await demo.client.listMembers();
    const gens = (id: string) =>
      members.find((m) => m.userId === id)?.workspaceKeyGenerations ?? [];
    check(
      gens(voleId).includes(2) && gens(doraId).includes(2) && gens(demoId).includes(2),
      'everyone still in the workspace has the new key',
    );
    check(!gens(otterId).includes(2), 'otter does not');
    check(
      (await loadAccessRule(demo.client, WORKSPACE, workspaceKey))?.enabled === true,
      'the rule is re-sealed and still on',
    );
    check(
      (await enrollDevice({ api: dora.api, storage: dora.devices })).status === 'ready',
      "dora's browser picks up the new key",
    );

    // -- back in the group: joining again ----------------------------------
    console.log('\n=== Put back in the group, otter joins again ===');
    const otterBack = as('otter', ['/design-team-a']);
    // Who you are stays readable while removed, so the editor can commit
    // to the key already published rather than make a new one.
    const published = (await otter.client.me()).publicKey!;
    await otterBack.signInAt(
      await signInUrlFor({
        client: otterBack.client,
        provider: 'oidc',
        storage: otterBack.pending,
        publishedPublicKey: fromBase64(published),
      }),
    );
    const asked = await submitJoinRequest(otterBack.client, otterBack.pending);
    check(asked.status === 'sent' && asked.requests[0]?.status === 'open', 'otter asks again');
    const pass = await grantPass();
    check(
      pass.granted.some((g) => g.userId === otterId),
      'and is let in with the new key',
    );
    check(
      !(await backend.access.getMembership(WORKSPACE, otterId))?.removedAt,
      'the removal is lifted',
    );
    check(
      (await statusOf(() => otter.client.listDevices())) === 200,
      'and the store serves them again',
    );

    // -- R13: a rule that is off removes nobody at sign-in -----------------
    console.log('\n=== R13: turning the rule off removes nobody ===');
    const off = await saveRule(false, ['/design-team-a']);
    check(off.enabled === false, 'the rule is off');
    const otterWanders = as('otter', ['/elsewhere']);
    await otterWanders.signInAt(otterWanders.client.signInUrl('oidc'));
    check(
      !(await backend.access.getMembership(WORKSPACE, otterId))?.removedAt,
      'otter signs in outside the group and stays: there is no rule to fail',
    );
    await saveRule(true, ['/design-team-a']);

    // -- R32: narrowing the rule -------------------------------------------
    console.log('\n=== R32: narrowing the rule ===');
    await saveRule(true, ['/design-team-b']);
    check(
      !(await backend.access.getMembership(WORKSPACE, voleId))?.removedAt &&
        (await demo.client.getRoutingRule(WORKSPACE))?.rotationRequired === false,
      'without "remove now", nobody is removed yet',
    );
    const voleBack = as('vole', ['/design-team-a']);
    await voleBack.signInAt(voleBack.client.signInUrl('oidc'));
    check(
      !!(await backend.access.getMembership(WORKSPACE, voleId))?.removedAt,
      'vole is removed at the next sign-in',
    );
    const routed = await demo.client.putRoutingRule(WORKSPACE, {
      ruleVersion: ((await demo.client.getRoutingRule(WORKSPACE))?.ruleVersion ?? 0) + 1,
      enabled: true,
      claim: 'groups',
      groups: ['/design-team-b'],
      evidenceMaxAgeSeconds: 86_400,
      removeMembers: true,
    });
    check(routed.removed === 1, '"remove now" removes otter at once, judged on last-seen groups');
    check(
      !!(await backend.access.getMembership(WORKSPACE, otterId))?.removedAt,
      'otter is removed without signing in',
    );
    check(
      !(await backend.access.getMembership(WORKSPACE, doraId))?.removedAt,
      'dora, let in by hand, is still untouched',
    );
    check(
      (await demo.client.getRoutingRule(WORKSPACE))?.rotationRequired === true,
      'and a new key is needed again',
    );

    console.log('\n=== A manual grant restores a removed member ===');
    const regrant = await rotateIfRequired({
      client: demo.client,
      workspaceId: WORKSPACE,
      workspaceKey,
      generation,
    });
    check(regrant?.generation === 3, 'the key is replaced again (generation 3)');
    workspaceKey = regrant!.workspaceKey;
    const volePublished = (await vole.client.me()).publicKey;
    await demo.client.grantWorkspaceKey(
      voleId,
      3,
      toBase64(
        await wrapKeyForPublicKey(workspaceKey, await importPublicKey(fromBase64(volePublished!))),
      ),
    );
    const restored = await backend.access.getMembership(WORKSPACE, voleId);
    check(
      !restored?.removedAt && restored?.source === 'manual',
      'giving vole access by hand makes them a manual member again',
    );

    console.log('\n=== R40: removing someone now ===');
    check(
      (await statusOf(() => demo.client.removeMember(demoId))) === 409,
      'nobody can remove themselves',
    );
    check(
      (await statusOf(() => otter.client.removeMember(doraId))) === 403,
      'someone without the key cannot remove anyone',
    );
    check((await statusOf(() => dora.client.listDevices())) === 200, 'dora is served before');
    await demo.client.removeMember(doraId);
    check(
      (await statusOf(() => dora.client.listDevices())) === 403,
      'and refused on her very next request, on the session she already had',
    );
    check(
      audit
        .all()
        .some((e) => e.operation === 'membership.removed' && e.detail?.cause === 'by-member'),
      'the removal is audited as made by a member',
    );
    const fourth = await rotateIfRequired({
      client: demo.client,
      workspaceId: WORKSPACE,
      workspaceKey,
      generation: 3,
    });
    check(fourth?.generation === 4, 'the key is replaced (generation 4)');
    const after = await demo.client.listMembers();
    check(
      !(after.find((m) => m.userId === doraId)?.workspaceKeyGenerations ?? []).includes(4),
      'and dora is not given it',
    );
  } finally {
    await close();
  }
}

await forEachBackend(run);

/**
 * A workspace that never set up automatic access still has Remove, and
 * still gets a new key afterwards: the flag needs somewhere to live.
 */
async function withoutARule(name: string, backend: Backend) {
  console.log(`\n########## ${name}: no automatic access set up ##########`);
  const { origin, idp, close } = await startStore(backend);
  try {
    const demo = makeBrowser(origin, idp, 'demo', []);
    await demo.signIn();
    let state = await enrollDevice({ api: demo.api, storage: demo.devices });
    if (state.status === 'needs-setup')
      state = await bootstrapFirstDevice({ api: demo.api, storage: demo.devices });
    const key = state.workspaceKey!;
    await demo.client.updateIndex(WORKSPACE, await indexKeyFor(key), (e) => e);
    const dora = makeBrowser(origin, idp, 'dora', []);
    await dora.signInAt(dora.client.signInUrl('oidc'));
    await enrollDevice({ api: dora.api, storage: dora.devices });
    const me = await dora.client.me();
    await demo.client.grantWorkspaceKey(
      me.userId,
      1,
      toBase64(await wrapKeyForPublicKey(key, await importPublicKey(fromBase64(me.publicKey!)))),
    );
    check((await demo.client.getRoutingRule(WORKSPACE)) === null, 'there is no rule');
    await demo.client.removeMember(me.userId);
    check(
      (await statusOf(() => dora.client.listDevices())) === 403,
      'Remove still takes effect at once',
    );
    const rotated = await rotateIfRequired({
      client: demo.client,
      workspaceId: WORKSPACE,
      workspaceKey: key,
      generation: 1,
    });
    check(rotated?.generation === 2, 'and the key is still replaced');
    const rule = await demo.client.getRoutingRule(WORKSPACE);
    check(
      rule?.enabled === false && rule.rotationRequired === false,
      'leaving automatic access off',
    );
  } finally {
    await close();
  }
}
await forEachBackend(withoutARule);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll group removal checks passed.');
