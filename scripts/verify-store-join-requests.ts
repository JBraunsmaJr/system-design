/**
 * Automatic access, end to end over HTTP (WS14-R3 to R7, R10, R14 to R19,
 * R26, R27, R30, R36).
 *
 * A member sets a rule; a newcomer in the group signs in with a key
 * commitment and asks to join; the member's side lists the evidence, checks
 * it with the real verifier against the provider's real keys, and grants;
 * the newcomer unwraps the workspace key. Then everything that must refuse
 * does. Runs over the in-memory backend, and over PostgreSQL when
 * DATABASE_URL is set.
 */
import type { AddressInfo } from 'net';
import pg from 'pg';
import { createMemoryBlobStore, type MemoryTx } from '../store/src/blobStore.ts';
import { createDocumentService } from '../store/src/documentService.ts';
import {
  createHttpService,
  createMemoryAuditSink,
  type StoreBackend,
} from '../store/src/httpService.ts';
import { createProvider } from '../store/src/auth/providers.ts';
import { createSessionStore, type SessionStore } from '../store/src/auth/sessions.ts';
import { createPostgresSessionStore } from '../store/src/auth/postgresSessions.ts';
import { createMemoryUserDirectory, type UserDirectory } from '../store/src/userDirectory.ts';
import { createPostgresUserDirectory } from '../store/src/postgresUserDirectory.ts';
import {
  createMemoryWorkspaceIndex,
  type WorkspaceIndexStore,
} from '../store/src/workspaceIndex.ts';
import { createPostgresStore, createPostgresWorkspaceIndex } from '../store/src/postgresStore.ts';
import { createMemoryAccessStore, type AccessStore } from '../store/src/access.ts';
import { createPostgresAccessStore } from '../store/src/postgresAccess.ts';
import { startTestGitHub, startTestOidcProvider } from './lib/testIdentityProviders.ts';
import {
  exportPublicKey,
  exportSymmetricKey,
  generateWorkspaceKey,
  generateWrappingKeyPair,
  importPublicKey,
  unwrapKeyWithPrivateKey,
  wrapKeyForPublicKey,
} from '../src/crypto/keys.ts';
import { joinCommitment, newJoinSalt } from '../src/crypto/joinCommitment.ts';
import { createJwksSource, parseAccessRule, verifyJoinEvidence } from '../src/crypto/idToken.ts';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const fromB64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

interface Backend {
  store: StoreBackend;
  directory: UserDirectory;
  index: WorkspaceIndexStore;
  access: AccessStore;
  sessions: SessionStore;
}

function memoryBackend(): Backend {
  const blobs = createMemoryBlobStore();
  return {
    store: createDocumentService<MemoryTx>({
      blobs,
      begin: () => blobs.begin(),
      commit: (tx) => blobs.commit(tx),
      rollback: (tx) => blobs.rollback(tx),
    }) as unknown as StoreBackend,
    directory: createMemoryUserDirectory(),
    index: createMemoryWorkspaceIndex(),
    access: createMemoryAccessStore(),
    sessions: createSessionStore(),
  };
}

async function run(name: string, backend: Backend) {
  console.log(`\n########## ${name} ##########`);
  const idp = await startTestOidcProvider();
  const github = await startTestGitHub();
  const audit = createMemoryAuditSink();
  const providers = [
    createProvider({
      id: 'oidc',
      kind: 'oidc',
      issuer: idp.issuer,
      clientId: idp.clientId,
      clientSecret: idp.clientSecret,
    }),
    createProvider({
      id: 'github',
      kind: 'github',
      clientId: github.clientId,
      clientSecret: github.clientSecret,
      authorizeUrl: `${github.origin}/login/oauth/authorize`,
      tokenUrl: `${github.origin}/login/oauth/access_token`,
      userUrl: `${github.origin}/user`,
    }),
  ];

  let origin = '';
  const serve = async (autoAccess: boolean) => {
    const server = createHttpService({
      store: backend.store,
      audit,
      sessions: backend.sessions,
      providers,
      directory: backend.directory,
      workspaceIndex: backend.index,
      access: backend.access,
      autoAccess,
      publicUrl: () => origin,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return server;
  };
  let server = await serve(true);

  const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
    fetch(`${origin}${path}`, {
      ...init,
      redirect: 'manual',
      headers: {
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  // Response bodies are read loosely: each check states the shape it expects.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (response: Response) => (await response.json()) as Record<string, any>;

  /** Signs in as `subject` with these groups, optionally committing to a key. */
  const signIn = async (
    subject: string,
    groups: string[] | null,
    commitment?: string,
    provider = 'oidc',
  ): Promise<{ cookie: string; status: number }> => {
    idp.setSubject(subject, subject);
    idp.setClaims(groups === null ? {} : { groups });
    const query = commitment !== undefined ? `?commitment=${encodeURIComponent(commitment)}` : '';
    const start = await fetch(`${origin}/v1/auth/${provider}/start${query}`, {
      redirect: 'manual',
    });
    if (start.status !== 302) return { cookie: '', status: start.status };
    const atProvider = await fetch(start.headers.get('location') ?? '', { redirect: 'manual' });
    const callback = await fetch(atProvider.headers.get('location') ?? '', { redirect: 'manual' });
    return {
      cookie: (callback.headers.get('set-cookie') ?? '').split(';')[0],
      status: callback.status,
    };
  };

  const publishKey = (cookie: string, spki: Uint8Array) =>
    call('/v1/users/me/public-key', {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ publicKey: b64(spki) }),
    });

  const userIdOf = async (cookie: string) =>
    (await json(await call('/v1/users/me', { cookie }))).user?.userId as string;

  try {
    // -- a member, holding the workspace key --------------------------------
    console.log('=== Setup: a member who holds the key ===');
    const member = await signIn('demo', ['/design-team-a']);
    const memberKeys = await generateWrappingKeyPair('user');
    const workspaceKey = await generateWorkspaceKey();
    await publishKey(member.cookie, await exportPublicKey(memberKeys.publicKey));
    const memberId = await userIdOf(member.cookie);
    await backend.directory.putWorkspaceKey(
      memberId,
      1,
      b64(await wrapKeyForPublicKey(workspaceKey, memberKeys.publicKey)),
    );
    check(!!memberId, 'the member is signed in and holds generation 1');

    console.log('\n=== R12: what the editor pre-fills a rule with ===');
    {
      const body = await json(await call('/v1/auth/providers'));
      check(
        Array.isArray(body.providers) && body.providers.includes('oidc'),
        'providers keeps its old shape (WS14-R44)',
      );
      const oidc = body.providerDetails?.find((p: { id: string }) => p.id === 'oidc');
      check(
        oidc?.issuer === idp.issuer && oidc?.clientId === idp.clientId && oidc?.kind === 'oidc',
        'providerDetails names the OIDC issuer and client',
      );
      check(body.autoAccess === true, 'and says automatic access is on');
    }

    // The sealed rule the member's editor would write; its routing copy
    // goes to the store.
    const sealedRule = parseAccessRule({
      schema: 1,
      ruleVersion: 1,
      enabled: true,
      issuer: idp.issuer,
      audience: idp.clientId,
      claim: 'groups',
      groups: ['/design-team-a'],
      evidenceMaxAgeSeconds: 86_400,
    });

    console.log('\n=== R10: the routing copy ===');
    {
      const put = await call('/v1/workspaces/default/access-rule', {
        method: 'PUT',
        cookie: member.cookie,
        body: JSON.stringify({
          ruleVersion: 1,
          enabled: true,
          claim: 'groups',
          groups: ['/design-team-a', '/design-team-a'],
          evidenceMaxAgeSeconds: 86_400,
        }),
      });
      const stored = (await json(put)).rule;
      check(put.status === 200 && stored?.ruleVersion === 1, 'a key holder can set it');
      check(stored?.groups.length === 1, 'duplicate groups are collapsed');
      const stale = await call('/v1/workspaces/default/access-rule', {
        method: 'PUT',
        cookie: member.cookie,
        body: JSON.stringify({
          ruleVersion: 1,
          enabled: true,
          claim: 'groups',
          groups: ['/everyone'],
          evidenceMaxAgeSeconds: 86_400,
        }),
      });
      check(stale.status === 409, 'the same version again is refused (409)');
      const bad = await call('/v1/workspaces/default/access-rule', {
        method: 'PUT',
        cookie: member.cookie,
        body: JSON.stringify({
          ruleVersion: 2,
          enabled: true,
          claim: 'groups',
          groups: [],
          evidenceMaxAgeSeconds: 86_400,
        }),
      });
      check(bad.status === 400, 'a rule with no groups is refused (400)');
      check(
        audit.all().some((entry) => entry.operation === 'access_rule.update'),
        'the change is audited',
      );
    }

    // -- the newcomer -------------------------------------------------------
    console.log('\n=== R3, R4: signing in with a key commitment ===');
    const otterKeys = await generateWrappingKeyPair('user');
    const otterSpki = await exportPublicKey(otterKeys.publicKey);
    const otterSalt = newJoinSalt();
    const otter = await signIn(
      'otter',
      ['/design-team-a', '/other'],
      await joinCommitment(otterSpki, otterSalt),
    );
    const otterSession = await json(await call('/v1/auth/session', { cookie: otter.cookie }));
    check(otterSession.session?.hasEvidence === true, 'the session holds evidence');
    const sessionText = JSON.stringify(otterSession);
    check(!/eyJ/.test(sessionText), 'the raw token never goes back to the browser (R45)');
    check(
      audit.all().some((e) => e.operation === 'login-start' && e.detail?.commitment === true),
      'the start is audited with commitment: true',
    );
    await publishKey(otter.cookie, otterSpki);
    const otterId = await userIdOf(otter.cookie);

    console.log('\n=== R17: evidence is for key holders only ===');
    {
      const peek = await call('/v1/workspaces/default/join-requests', { cookie: otter.cookie });
      check(peek.status === 403, 'a newcomer cannot list requests (403)');
      const setRule = await call('/v1/workspaces/default/access-rule', {
        method: 'PUT',
        cookie: otter.cookie,
        body: JSON.stringify({
          ruleVersion: 9,
          enabled: true,
          claim: 'groups',
          groups: ['/x'],
          evidenceMaxAgeSeconds: 86_400,
        }),
      });
      check(setRule.status === 403, 'nor change the rule (403)');
    }

    console.log('\n=== R14: the store checks the commitment first ===');
    {
      const wrongSalt = await call('/v1/join-requests', {
        method: 'POST',
        cookie: otter.cookie,
        body: JSON.stringify({ salt: b64(newJoinSalt()) }),
      });
      check(wrongSalt.status === 422, 'another salt is refused (422 commitment-mismatch)');
      const shortSalt = await call('/v1/join-requests', {
        method: 'POST',
        cookie: otter.cookie,
        body: JSON.stringify({ salt: b64(new Uint8Array(16)) }),
      });
      check(shortSalt.status === 400, 'a 16-byte salt is refused (400)');
    }

    console.log('\n=== R15: opening the request ===');
    let evidenceHash = '';
    {
      const opened = await json(
        await call('/v1/join-requests', {
          method: 'POST',
          cookie: otter.cookie,
          body: JSON.stringify({ salt: b64(otterSalt) }),
        }),
      );
      check(
        opened.requests?.length === 1 &&
          opened.requests[0].workspaceId === 'default' &&
          opened.requests[0].status === 'open',
        'a request is open for the default workspace',
      );
      const own = await json(await call('/v1/join-requests', { cookie: otter.cookie }));
      check(own.requests?.[0]?.status === 'open', 'the newcomer can see its status');
      check(!JSON.stringify(own).includes('eyJ'), 'but not the evidence');
    }

    console.log('\n=== R20 to R26: a member checks, then grants ===');
    {
      const listed = await json(
        await call('/v1/workspaces/default/join-requests', { cookie: member.cookie }),
      );
      const entry = listed.requests?.find((r: { userId: string }) => r.userId === otterId);
      check(
        !!entry?.idToken && entry.subject === 'otter',
        'the member sees the request with its evidence',
      );
      evidenceHash = entry?.evidenceHash;

      // The member's browser, exactly as it will run: keys from the
      // provider directly, the sealed rule, the key it is about to wrap to.
      const keySource = createJwksSource();
      const outcome = await verifyJoinEvidence(
        {
          issuer: entry.issuer,
          subject: entry.subject,
          publicKey: fromB64(entry.publicKey),
          salt: fromB64(entry.salt),
          idToken: entry.idToken,
        },
        sealedRule,
        { keySource, seenRuleVersion: 1 },
      );
      check(
        outcome.ok,
        `the real verifier accepts it${outcome.ok ? '' : ` (${outcome.reason}: ${outcome.message})`}`,
      );

      // What a store substituting its own key would achieve.
      const attacker = await generateWrappingKeyPair('user');
      const swapped = await verifyJoinEvidence(
        {
          issuer: entry.issuer,
          subject: entry.subject,
          publicKey: await exportPublicKey(attacker.publicKey),
          salt: fromB64(entry.salt),
          idToken: entry.idToken,
        },
        sealedRule,
        { keySource, seenRuleVersion: 1 },
      );
      check(
        !swapped.ok && swapped.reason === 'nonce-mismatch',
        "the same evidence with the store's own key is refused (nonce-mismatch)",
      );

      // Wrapped to exactly the bytes that were verified (WS14-R22).
      const wrapped = b64(
        await wrapKeyForPublicKey(workspaceKey, await importPublicKey(fromB64(entry.publicKey))),
      );

      const wrongHash = await call(`/v1/workspace/members/${encodeURIComponent(otterId)}/key`, {
        method: 'PUT',
        cookie: member.cookie,
        body: JSON.stringify({
          generation: 1,
          wrappedKey: wrapped,
          joinEvidenceHash: 'x'.repeat(43),
        }),
      });
      check(
        wrongHash.status === 409,
        'a grant naming other evidence is refused (409 request-closed)',
      );
      const wrongGeneration = await call(
        `/v1/workspace/members/${encodeURIComponent(otterId)}/key`,
        {
          method: 'PUT',
          cookie: member.cookie,
          body: JSON.stringify({
            generation: 2,
            wrappedKey: wrapped,
            joinEvidenceHash: evidenceHash,
          }),
        },
      );
      check(
        wrongGeneration.status === 409,
        'a grant on a generation that is not current is refused',
      );
      const byNewcomer = await call(`/v1/workspace/members/${encodeURIComponent(otterId)}/key`, {
        method: 'PUT',
        cookie: otter.cookie,
        body: JSON.stringify({
          generation: 1,
          wrappedKey: wrapped,
          joinEvidenceHash: evidenceHash,
        }),
      });
      check(byNewcomer.status === 403, 'nobody without the key can make an automatic grant (403)');

      const grant = await call(`/v1/workspace/members/${encodeURIComponent(otterId)}/key`, {
        method: 'PUT',
        cookie: member.cookie,
        body: JSON.stringify({
          generation: 1,
          wrappedKey: wrapped,
          joinEvidenceHash: evidenceHash,
          matchedGroup: outcome.ok ? outcome.matchedGroup : null,
        }),
      });
      check(grant.status === 204, 'the grant lands');
      const again = await call(`/v1/workspace/members/${encodeURIComponent(otterId)}/key`, {
        method: 'PUT',
        cookie: member.cookie,
        body: JSON.stringify({
          generation: 1,
          wrappedKey: wrapped,
          joinEvidenceHash: evidenceHash,
        }),
      });
      check(again.status === 204, 'granting twice is a success, not an error (R26)');

      // The newcomer can now open the workspace key.
      const held = await backend.directory.getWorkspaceKeys(otterId);
      const unwrapped = await unwrapKeyWithPrivateKey(
        fromB64(held[0].wrappedKey),
        otterKeys.privateKey,
        'AES-KW',
      );
      check(
        b64(await exportSymmetricKey(unwrapped)) === b64(await exportSymmetricKey(workspaceKey)),
        'the newcomer unwraps the same workspace key',
      );

      const autoGrant = audit.all().find((e) => e.operation === 'join.auto_grant');
      check(
        autoGrant?.detail?.matchedGroup === '/design-team-a' &&
          autoGrant.detail.evidenceHash === evidenceHash,
        'the grant is audited with the group and the evidence hash (R41)',
      );
      check(
        !audit.all().some((e) => JSON.stringify(e).includes(entry.idToken)),
        'the raw token appears nowhere in the audit log (R41)',
      );
      const after = await json(
        await call('/v1/workspaces/default/join-requests', { cookie: member.cookie }),
      );
      check(
        !after.requests.some((r: { userId: string }) => r.userId === otterId),
        'the request is closed',
      );
      const stored = await backend.access.getRequest('default', otterId);
      check(
        stored?.status === 'granted' && stored.idToken === null,
        'and its evidence is dropped (R18)',
      );
      const members = await json(await call('/v1/workspace/members', { cookie: member.cookie }));
      const otterMember = members.members.find((m: { userId: string }) => m.userId === otterId);
      check(
        otterMember?.source === 'oidc_group' && otterMember.matchedGroup === '/design-team-a',
        'the membership records how they got in (R30)',
      );
    }

    console.log('\n=== R16: someone the rule does not cover ===');
    {
      const badgerKeys = await generateWrappingKeyPair('user');
      const spki = await exportPublicKey(badgerKeys.publicKey);
      const salt = newJoinSalt();
      const badger = await signIn('badger', ['/design-team-b'], await joinCommitment(spki, salt));
      await publishKey(badger.cookie, spki);
      const result = await json(
        await call('/v1/join-requests', {
          method: 'POST',
          cookie: badger.cookie,
          body: JSON.stringify({ salt: b64(salt) }),
        }),
      );
      check(
        result.requests?.length === 0 && result.reason === 'no-matching-rule',
        'gets no request, and the reason says why',
      );
      const members = await json(await call('/v1/workspace/members', { cookie: member.cookie }));
      check(
        members.members.some((m: { displayName?: string }) => m.displayName === 'badger'),
        'but is still listed for a manual grant',
      );
    }

    console.log('\n=== R27: reporting a failed check ===');
    {
      const weaselKeys = await generateWrappingKeyPair('user');
      const spki = await exportPublicKey(weaselKeys.publicKey);
      const salt = newJoinSalt();
      const weasel = await signIn('weasel', ['/design-team-a'], await joinCommitment(spki, salt));
      await publishKey(weasel.cookie, spki);
      await call('/v1/join-requests', {
        method: 'POST',
        cookie: weasel.cookie,
        body: JSON.stringify({ salt: b64(salt) }),
      });
      const weaselId = await userIdOf(weasel.cookie);
      const bad = await call(
        `/v1/workspaces/default/join-requests/${encodeURIComponent(weaselId)}/rejections`,
        {
          method: 'POST',
          cookie: member.cookie,
          body: JSON.stringify({ reason: 'looked-shifty' }),
        },
      );
      check(bad.status === 400, 'an unknown reason is refused (400)');
      const good = await call(
        `/v1/workspaces/default/join-requests/${encodeURIComponent(weaselId)}/rejections`,
        {
          method: 'POST',
          cookie: member.cookie,
          body: JSON.stringify({ reason: 'no-group-match' }),
        },
      );
      check(good.status === 204, 'a known reason is recorded');
      const own = await json(await call('/v1/join-requests', { cookie: weasel.cookie }));
      check(own.requests?.[0]?.lastRejection === 'no-group-match', 'the newcomer can see why');
      check(
        audit.all().some((e) => e.operation === 'join.rejected'),
        'and it is audited',
      );

      console.log('\n=== R30: a manual grant closes the request ===');
      await call(`/v1/workspace/members/${encodeURIComponent(weaselId)}/key`, {
        method: 'PUT',
        cookie: member.cookie,
        body: JSON.stringify({ generation: 1, wrappedKey: b64(new Uint8Array(8)) }),
      });
      const closed = await backend.access.getRequest('default', weaselId);
      check(
        closed?.status === 'granted' && closed.idToken === null,
        'the open request closes and drops evidence',
      );
      const membership = await backend.access.getMembership('default', weaselId);
      check(membership?.source === 'manual', 'and the membership is manual (R35)');
    }

    console.log('\n=== R5: no commitment, no evidence ===');
    {
      const plain = await signIn('stoat', ['/design-team-a']);
      const session = await json(await call('/v1/auth/session', { cookie: plain.cookie }));
      check(session.session?.hasEvidence === false, 'a plain sign-in keeps nothing');
      const keys = await generateWrappingKeyPair('user');
      await publishKey(plain.cookie, await exportPublicKey(keys.publicKey));
      const attempt = await call('/v1/join-requests', {
        method: 'POST',
        cookie: plain.cookie,
        body: JSON.stringify({ salt: b64(newJoinSalt()) }),
      });
      check(attempt.status === 409, 'and cannot ask to join (409 no-evidence)');
    }

    console.log('\n=== R3, R7: what start refuses ===');
    {
      const malformed = await signIn('mink', [], 'too-short');
      check(malformed.status === 400, 'a malformed commitment (400)');
      const viaGitHub = await signIn('mink', [], 'A'.repeat(43), 'github');
      check(viaGitHub.status === 400, 'a commitment on GitHub sign-in (400)');
    }

    console.log('\n=== R6: group overage ===');
    {
      const keys = await generateWrappingKeyPair('user');
      const spki = await exportPublicKey(keys.publicKey);
      const salt = newJoinSalt();
      idp.setSubject('marten', 'marten');
      const start = await fetch(
        `${origin}/v1/auth/oidc/start?commitment=${await joinCommitment(spki, salt)}`,
        { redirect: 'manual' },
      );
      idp.setClaims({ _claim_names: { groups: 'src1' } });
      const atProvider = await fetch(start.headers.get('location') ?? '', { redirect: 'manual' });
      const callback = await fetch(atProvider.headers.get('location') ?? '', {
        redirect: 'manual',
      });
      const cookie = (callback.headers.get('set-cookie') ?? '').split(';')[0];
      const session = await json(await call('/v1/auth/session', { cookie }));
      check(session.session?.groupsOverage === true, 'the session reports overage');
      await publishKey(cookie, spki);
      const result = await json(
        await call('/v1/join-requests', {
          method: 'POST',
          cookie,
          body: JSON.stringify({ salt: b64(salt) }),
        }),
      );
      check(
        result.reason === 'groups-overage',
        'and the join reports it rather than failing silently',
      );
    }

    console.log('\n=== R18, R19: evidence ages out ===');
    {
      const keys = await generateWrappingKeyPair('user');
      const spki = await exportPublicKey(keys.publicKey);
      const salt = newJoinSalt();
      const ferret = await signIn('ferret', ['/design-team-a'], await joinCommitment(spki, salt));
      await publishKey(ferret.cookie, spki);
      await call('/v1/join-requests', {
        method: 'POST',
        cookie: ferret.cookie,
        body: JSON.stringify({ salt: b64(salt) }),
      });
      const ferretId = await userIdOf(ferret.cookie);
      const swept = await backend.access.expireEvidence(new Date(Date.now() + 60_000));
      check(swept >= 1, 'the sweep drops evidence past the cutoff');
      const listed = await json(
        await call('/v1/workspaces/default/join-requests', { cookie: member.cookie }),
      );
      check(
        !listed.requests.some((r: { userId: string }) => r.userId === ferretId),
        'the member no longer sees it',
      );
      const own = await json(await call('/v1/join-requests', { cookie: ferret.cookie }));
      check(
        ['expired', 'evidence-expired'].includes(own.requests?.[0]?.status),
        'the newcomer is told to sign in again',
      );
    }

    console.log('\n=== R36: AUTO_ACCESS=off ===');
    {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server = await serve(false);
      const providersBody = await json(await call('/v1/auth/providers'));
      check(providersBody.autoAccess === false, 'providers says it is off');
      const keys = await generateWrappingKeyPair('user');
      const spki = await exportPublicKey(keys.publicKey);
      const salt = newJoinSalt();
      const vole = await signIn('vole', ['/design-team-a'], await joinCommitment(spki, salt));
      const session = await json(await call('/v1/auth/session', { cookie: vole.cookie }));
      check(session.session?.hasEvidence === false, 'a commitment is ignored');
      await publishKey(vole.cookie, spki);
      const join = await json(
        await call('/v1/join-requests', {
          method: 'POST',
          cookie: vole.cookie,
          body: JSON.stringify({ salt: b64(salt) }),
        }),
      );
      check(join.reason === 'auto-access-off', 'joining says it is off');
      const rule = await call('/v1/workspaces/default/access-rule', {
        method: 'PUT',
        cookie: member.cookie,
        body: JSON.stringify({
          ruleVersion: 5,
          enabled: true,
          claim: 'groups',
          groups: ['/a'],
          evidenceMaxAgeSeconds: 86_400,
        }),
      });
      check(rule.status === 403, 'the rule cannot be changed (403)');
      const list = await json(
        await call('/v1/workspaces/default/join-requests', { cookie: member.cookie }),
      );
      check(Array.isArray(list.requests) && list.requests.length === 0, 'no requests are listed');
      const members = await call('/v1/workspace/members', { cookie: member.cookie });
      check(members.status === 200, 'manual access keeps working');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await idp.close();
    await github.close();
  }
}

await run('in memory', memoryBackend());

const DATABASE_URL = process.env.DATABASE_URL ?? '';
if (DATABASE_URL) {
  const postgres = createPostgresStore({ connectionString: DATABASE_URL });
  await postgres.migrate();
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  // A clean slate for the tables this suite reads back.
  await pool.query(
    `TRUNCATE join_requests, workspace_memberships, workspace_access_rules, workspace_keys, devices, users, sessions, pending_logins CASCADE`,
  );
  try {
    await run('PostgreSQL', {
      store: postgres as unknown as StoreBackend,
      directory: createPostgresUserDirectory(pool),
      index: createPostgresWorkspaceIndex(pool),
      access: createPostgresAccessStore(pool),
      sessions: createPostgresSessionStore(pool),
    });
  } finally {
    await pool.end();
    await postgres.close();
  }
} else {
  console.log('\n(DATABASE_URL is not set: PostgreSQL is not covered by this run)');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll join request checks passed.');
