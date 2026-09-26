/**
 * Automatic access from the editor's side, end to end (WS14-R2, R8 to R13,
 * R20 to R28, and rotation's part in R34).
 *
 * Each "browser" here is the editor's own code - the store client, device
 * enrolment, the join flow, the granter - with its own cookie jar, talking to
 * a real store and a provider that really signs tokens. Nothing on the grant
 * path is stubbed: the newcomer signs in through signInUrlFor, enrolment
 * publishes the committed key, and the member's runAutoGrant checks the
 * provider's own signature before wrapping anything.
 */
import {
  WORKSPACE,
  forEachBackend,
  makeBrowser,
  startStore,
  type Backend,
} from './lib/joinHarness.ts';
import { bootstrapFirstDevice, enrollDevice } from '../src/collab/deviceIdentity.ts';
import { pendingUserKeySource, signInUrlFor, submitJoinRequest } from '../src/collab/joinFlow.ts';
import { loadAccessRule, saveAccessRule } from '../src/collab/accessRule.ts';
import { createRejectionMemory, runAutoGrant } from '../src/collab/autoGrant.ts';
import { rotateWorkspaceKey } from '../src/collab/workspaceRotation.ts';
import { indexKeyFor, toBase64 } from '../src/collab/workspaceDocuments.ts';
import { createJwksSource, createMemoryRuleVersionStore } from '../src/crypto/idToken.ts';
import { exportSymmetricKeyHex } from '../src/crypto/keys.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

async function run(name: string, backend: Backend) {
  console.log(`\n########## ${name} ##########`);
  const { origin, idp, audit, close } = await startStore(backend);

  const noWait = { sleep: async () => {}, random: () => 0 };

  try {
    // -- the member, who created the workspace ---------------------------
    console.log('=== Setup: the first member creates the workspace ===');
    const demo = makeBrowser(origin, idp, 'demo', ['/design-team-a']);
    await demo.signIn();
    let memberState = await enrollDevice({ api: demo.api, storage: demo.devices });
    if (memberState.status === 'needs-setup')
      memberState = await bootstrapFirstDevice({ api: demo.api, storage: demo.devices });
    check(memberState.status === 'ready' && !!memberState.workspaceKey, 'the member is ready');
    const workspaceKey = memberState.workspaceKey!;
    await demo.client.updateIndex(WORKSPACE, await indexKeyFor(workspaceKey), (entries) => entries);
    const demoId = (await demo.client.me()).userId;

    console.log('\n=== R8 to R12: saving the rule ===');
    const details = await demo.client.providerDetails();
    const oidc = details.providers.find((provider) => provider.kind === 'oidc')!;
    check(details.autoAccess && oidc.issuer === idp.issuer, 'the store offers what to pre-fill');
    const saved = await saveAccessRule({
      client: demo.client,
      workspaceId: WORKSPACE,
      workspaceKey,
      generation: 1,
      edit: {
        enabled: true,
        groups: [' /design-team-a ', ''],
        issuer: oidc.issuer!,
        audience: oidc.clientId,
      },
      updatedBy: demoId,
    });
    check(
      saved.ruleVersion === 1 && saved.groups.join() === '/design-team-a',
      'saved as version 1, tidied',
    );
    const reread = await loadAccessRule(demo.client, WORKSPACE, workspaceKey);
    check(
      reread?.ruleVersion === 1 && reread.updatedBy === demoId,
      'it reads back from its sealed record',
    );
    const routing = await demo.client.getRoutingRule(WORKSPACE);
    check(
      routing?.ruleVersion === 1 && routing.groups[0] === '/design-team-a',
      'and the routing copy matches',
    );
    const { entries } = await demo.client.readIndex(WORKSPACE, await indexKeyFor(workspaceKey));
    check(Array.isArray(entries) && entries.length === 0, 'the index itself is untouched (R44)');
    let threw = false;
    try {
      await saveAccessRule({
        client: demo.client,
        workspaceId: WORKSPACE,
        workspaceKey,
        generation: 1,
        edit: { enabled: true, groups: [], issuer: oidc.issuer!, audience: oidc.clientId },
        updatedBy: demoId,
      });
    } catch {
      threw = true;
    }
    check(threw, 'a rule with no groups is refused before anything is written');
    check(
      (await loadAccessRule(demo.client, WORKSPACE, workspaceKey))?.ruleVersion === 1,
      'and version 1 stands',
    );

    const granter = {
      client: demo.client,
      workspaceId: WORKSPACE,
      workspaceKey,
      generation: 1,
      keySource: createJwksSource(),
      ruleVersions: createMemoryRuleVersionStore(),
      memory: createRejectionMemory(),
      ...noWait,
    };

    // -- the newcomer ------------------------------------------------------
    console.log('\n=== R2: the newcomer signs in with a commitment ===');
    const otter = makeBrowser(origin, idp, 'otter', ['/design-team-a']);
    const url = await otter.url();
    check(/[?&]commitment=[A-Za-z0-9_-]{43}$/.test(url), 'the sign-in URL carries a commitment');
    const prepared = await otter.pending.load();
    check(!!prepared?.userKeyPair, 'the user key exists before sign-in');
    await otter.signInAt(url);
    check((await otter.client.session())?.hasEvidence === true, 'the session holds evidence');
    const otterState = await enrollDevice({
      api: otter.api,
      storage: otter.devices,
      userKeySource: pendingUserKeySource(otter.pending),
    });
    check(otterState.status === 'awaiting-access', 'enrolment leaves them waiting');
    check(
      (await otter.client.me()).publicKey === toBase64(prepared!.publicKey),
      'and publishes the very key the sign-in committed to',
    );

    console.log('\n=== R14: asking to join ===');
    const submission = await submitJoinRequest(otter.client, otter.pending);
    check(
      submission.status === 'sent' && submission.requests[0]?.status === 'open',
      'a request opens',
    );
    check((await otter.pending.load()) === null, 'and the pending key is cleared from storage');

    console.log('\n=== R20 to R26: the member lets them in, unattended ===');
    const pass = await runAutoGrant(granter);
    check(
      pass.granted.length === 1 &&
        pass.granted[0].displayName === 'otter' &&
        pass.granted[0].matchedGroup === '/design-team-a',
      'the granter lets otter in through /design-team-a',
    );
    const otterReady = await enrollDevice({ api: otter.api, storage: otter.devices });
    check(otterReady.status === 'ready', 'otter is ready on the next look');
    check(
      (await exportSymmetricKeyHex(otterReady.workspaceKey!)) ===
        (await exportSymmetricKeyHex(workspaceKey)),
      'holding the same workspace key as the member',
    );
    const again = await runAutoGrant(granter);
    check(
      again.granted.length === 0 && again.rejected.length === 0,
      'a second pass has nothing to do',
    );

    console.log('\n=== R16: a group the rule does not name ===');
    const badger = makeBrowser(origin, idp, 'badger', ['/design-team-b']);
    await badger.signIn();
    await enrollDevice({
      api: badger.api,
      storage: badger.devices,
      userKeySource: pendingUserKeySource(badger.pending),
    });
    const badgerJoin = await submitJoinRequest(badger.client, badger.pending);
    check(
      badgerJoin.status === 'sent' && badgerJoin.reason === 'no-matching-rule',
      'the store opens nothing, and says why',
    );
    check((await runAutoGrant(granter)).granted.length === 0, 'and the granter lets nobody in');

    console.log('\n=== R5, R38: a sign-in without a commitment ===');
    {
      const stoat = makeBrowser(origin, idp, 'stoat', ['/design-team-a']);
      await stoat.signInAt(stoat.client.signInUrl('oidc'));
      await enrollDevice({ api: stoat.api, storage: stoat.devices });
      const result = await submitJoinRequest(stoat.client, stoat.pending);
      check(result.status === 'no-evidence', 'is told it has no evidence, so it can sign in again');
    }

    console.log('\n=== R22, R38: a published key that is not the committed one ===');
    {
      const vole = makeBrowser(origin, idp, 'vole', ['/design-team-a']);
      await vole.signIn();
      // Enrolment NOT told about the pending key: it makes its own.
      await enrollDevice({ api: vole.api, storage: vole.devices, userKeySource: async () => null });
      const result = await submitJoinRequest(vole.client, vole.pending);
      check(result.status === 'key-mismatch', 'is caught in the browser before the store is asked');
      // Signing in again commits to the key actually published.
      const published = (await vole.client.me()).publicKey!;
      const retry = await signInUrlFor({
        client: vole.client,
        provider: 'oidc',
        storage: vole.pending,
        publishedPublicKey: Uint8Array.from(atob(published), (c) => c.charCodeAt(0)),
      });
      await vole.signInAt(retry);
      const second = await submitJoinRequest(vole.client, vole.pending);
      check(
        second.status === 'sent' && second.requests[0]?.status === 'open',
        'and signing in again fixes it',
      );
      const granted = await runAutoGrant(granter);
      check(
        granted.granted.some((g) => g.displayName === 'vole'),
        'vole is let in',
      );
    }

    console.log('\n=== R20, R27: a rolled-back rule, and the quiet period ===');
    {
      const mink = makeBrowser(origin, idp, 'mink', ['/design-team-a']);
      await mink.signIn();
      await enrollDevice({
        api: mink.api,
        storage: mink.devices,
        userKeySource: pendingUserKeySource(mink.pending),
      });
      await submitJoinRequest(mink.client, mink.pending);
      const ahead = {
        ...granter,
        ruleVersions: createMemoryRuleVersionStore(),
        memory: createRejectionMemory(),
      };
      await ahead.ruleVersions.raise(WORKSPACE, 5);
      const refused = await runAutoGrant(ahead);
      check(
        refused.granted.length === 0 && refused.rejected[0]?.reason === 'rule-rollback',
        'a browser that has seen version 5 refuses version 1',
      );
      const own = await mink.client.myJoinRequests();
      check(own[0]?.lastRejection === 'rule-rollback', 'the newcomer can see why');
      const quiet = await runAutoGrant(ahead);
      check(quiet.rejected.length === 0, 'the same evidence is not re-checked straight away');
      const letIn = await runAutoGrant(granter);
      check(
        letIn.granted.some((g) => g.displayName === 'mink'),
        'a browser with no such memory lets mink in',
      );
    }

    console.log('\n=== R11: the store cannot change the rule ===');
    {
      // The store replaces the sealed record with something of its own.
      const recordId = `${WORKSPACE}.access`;
      const current = await backend.index.get(recordId);
      await backend.index.put(recordId, toBase64(new Uint8Array(64).fill(7)), current!.version, 1);
      check(
        (await loadAccessRule(demo.client, WORKSPACE, workspaceKey)) === null,
        'a forged record opens as no rule',
      );
      const weasel = makeBrowser(origin, idp, 'weasel', ['/design-team-a']);
      await weasel.signIn();
      await enrollDevice({
        api: weasel.api,
        storage: weasel.devices,
        userKeySource: pendingUserKeySource(weasel.pending),
      });
      await submitJoinRequest(weasel.client, weasel.pending);
      const pass2 = await runAutoGrant({ ...granter, memory: createRejectionMemory() });
      check(
        pass2.granted.length === 0 && pass2.rejected[0]?.reason === 'rule-missing',
        'so nobody is let in: rule-missing',
      );
      // Saving again restores it, moving forward from the highest version
      // known, so browsers that saw version 1 accept it.
      const restored = await saveAccessRule({
        client: demo.client,
        workspaceId: WORKSPACE,
        workspaceKey,
        generation: 1,
        edit: {
          enabled: true,
          groups: ['/design-team-a'],
          issuer: oidc.issuer!,
          audience: oidc.clientId,
        },
        updatedBy: demoId,
      });
      check(
        restored.ruleVersion === 2 &&
          (await loadAccessRule(demo.client, WORKSPACE, workspaceKey))?.ruleVersion === 2,
        'saving again restores it as version 2, not a restarted version 1',
      );
      const resumed = await runAutoGrant({ ...granter, memory: createRejectionMemory() });
      check(
        resumed.granted.some((g) => g.displayName === 'weasel'),
        'and a browser that had seen version 1 accepts it: weasel is let in',
      );
    }

    console.log('\n=== R13: turning it off ===');
    {
      const current = await loadAccessRule(demo.client, WORKSPACE, workspaceKey);
      const off = await saveAccessRule({
        client: demo.client,
        workspaceId: WORKSPACE,
        workspaceKey,
        generation: 1,
        edit: {
          enabled: false,
          groups: current!.groups,
          issuer: oidc.issuer!,
          audience: oidc.clientId,
        },
        updatedBy: demoId,
      });
      check(off.enabled === false, 'the sealed rule is off');
      const pass3 = await runAutoGrant({ ...granter, memory: createRejectionMemory() });
      const ferret = makeBrowser(origin, idp, 'ferret', ['/design-team-a']);
      await ferret.signIn();
      await enrollDevice({
        api: ferret.api,
        storage: ferret.devices,
        userKeySource: pendingUserKeySource(ferret.pending),
      });
      const ferretJoin = await submitJoinRequest(ferret.client, ferret.pending);
      check(
        ferretJoin.status === 'sent' && ferretJoin.reason === 'no-matching-rule',
        'a newcomer is no longer routed to it',
      );
      check(pass3.granted.length === 0, 'and nobody is let in');
      const members = await demo.client.listMembers();
      check(
        members.filter((m) => m.source === 'oidc_group').length === 4,
        'people already let in stay (otter, vole, mink, weasel)',
      );
    }

    console.log('\n=== R34 and WS7-R8: rotation ===');
    {
      const result = await rotateWorkspaceKey({
        client: demo.client,
        workspaceId: WORKSPACE,
        currentKey: workspaceKey,
        currentGeneration: 1,
      });
      const newKey = result.workspaceKey;
      const rule = await loadAccessRule(demo.client, WORKSPACE, newKey);
      check(rule !== null && rule.enabled === false, 'the rule is re-sealed under the new key');
      const members = await demo.client.listMembers();
      const byName = (n: string) => members.find((m) => m.displayName === n);
      check(
        (byName('otter')?.workspaceKeyGenerations ?? []).includes(2),
        'members let in automatically get the new key',
      );
      check(
        !(byName('badger')?.workspaceKeyGenerations ?? []).includes(2) &&
          !(byName('ferret')?.workspaceKeyGenerations ?? []).includes(2),
        'people still waiting do not',
      );
    }

    check(
      !audit.all().some((entry) => /eyJ[\w-]+\.eyJ/.test(JSON.stringify(entry))),
      'no ID token reached the audit log along the way',
    );
  } finally {
    await close();
  }
}

await forEachBackend(run);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll automatic grant checks passed.');
