/**
 * Automatic access, as a workspace member sets it up (WS14-R12, R13, R28, R37).
 *
 * Saving writes the sealed rule - the one browsers trust - and then the
 * store's routing copy. The issuer and client come from the store, which is
 * why they are shown for confirmation before the first save rather than
 * taken on trust: they decide whose sign-ins count.
 */
import { useEffect, useState } from 'react';
import { EVIDENCE_MAX_AGE_DEFAULT, type AccessRule } from '../crypto/idToken';
import { loadAccessRule, saveAccessRule } from '../collab/accessRule';
import { autoGrantEnabledHere, setAutoGrantEnabledHere } from '../collab/autoGrant';
import type { StoreClient } from '../collab/storeClient';
import { indexKeyFor } from '../collab/workspaceDocuments';

const VALIDITY = [
  { seconds: 3_600, label: '1 hour' },
  { seconds: EVIDENCE_MAX_AGE_DEFAULT, label: '1 day' },
  { seconds: 604_800, label: '7 days' },
];

export interface AccessRuleSettingsProps {
  client: StoreClient;
  workspaceId: string;
  workspaceKey: CryptoKey;
  userId: string;
}

export function AccessRuleSettings(props: AccessRuleSettingsProps) {
  const { client, workspaceId, workspaceKey, userId } = props;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [identity, setIdentity] = useState<{ issuer: string; clientId: string } | null>(null);
  const [saved, setSaved] = useState<AccessRule | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [groupsText, setGroupsText] = useState('');
  const [validity, setValidity] = useState(EVIDENCE_MAX_AGE_DEFAULT);
  const [confirmed, setConfirmed] = useState(false);
  const [fromHere, setFromHere] = useState(() => autoGrantEnabledHere());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const details = await client.providerDetails();
        const oidc = details.providers.find((provider) => provider.kind === 'oidc');
        const rule = await loadAccessRule(client, workspaceId, workspaceKey);
        if (cancelled) return;
        setAvailable(details.autoAccess && !!oidc?.issuer);
        setIdentity(oidc?.issuer ? { issuer: oidc.issuer, clientId: oidc.clientId } : null);
        setSaved(rule);
        if (rule) {
          setEnabled(rule.enabled);
          setGroupsText(rule.groups.join('\n'));
          setValidity(rule.evidenceMaxAgeSeconds);
        }
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId, workspaceKey]);

  if (available === null) return null;

  const groups = groupsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  // The saved rule's issuer and client stand once confirmed; a change on the
  // store's side has to be confirmed again (WS14-R12).
  const identityChanged =
    !!saved &&
    !!identity &&
    (saved.issuer !== identity.issuer || saved.audience !== identity.clientId);
  const needsConfirmation = !saved || identityChanged;

  const save = async () => {
    if (!identity) return;
    setBusy(true);
    setMessage(null);
    try {
      const { generation } = await client.readIndex(workspaceId, await indexKeyFor(workspaceKey));
      const next = await saveAccessRule({
        client,
        workspaceId,
        workspaceKey,
        generation: generation ?? 1,
        edit: {
          enabled,
          groups,
          evidenceMaxAgeSeconds: validity,
          issuer: identity.issuer,
          audience: identity.clientId,
        },
        updatedBy: userId,
      });
      setSaved(next);
      setConfirmed(false);
      setMessage(
        next.enabled
          ? `Saved. People in ${next.groups.join(', ')} are let in automatically.`
          : 'Saved. Automatic access is off; people are let in by hand.',
      );
    } catch (error) {
      setMessage(`Not saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="workspace-panel__auto-access" style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer' }}>Automatic access</summary>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {!available ? (
          <p style={{ margin: 0 }}>
            This server does not let people in automatically. Ask whoever runs it about enabling
            automatic access; until then, give people access by hand.
          </p>
        ) : (
          <>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Let people in automatically when their sign-in lists one of these groups
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Groups, one per line</span>
              <textarea
                className="workspace-panel__auto-access-groups"
                rows={3}
                value={groupsText}
                onChange={(event) => setGroupsText(event.target.value)}
                placeholder="/design-team-a"
                spellCheck={false}
              />
              <small style={{ opacity: 0.8 }}>
                Matched exactly, including case. Keycloak sends full paths, which start with /.
              </small>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>A sign-in can be checked for up to</span>
              <select
                value={validity}
                onChange={(event) => setValidity(Number(event.target.value))}
              >
                {VALIDITY.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {identity && needsConfirmation && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  {identityChanged ? 'The sign-in settings have changed. ' : ''}
                  Only sign-ins from <code>{identity.issuer}</code> for{' '}
                  <code>{identity.clientId}</code> will count. That is our organization&apos;s
                  sign-in.
                </span>
              </label>
            )}
            <div>
              <button
                type="button"
                className="workspace-panel__auto-access-save"
                onClick={() => void save()}
                disabled={
                  busy || !identity || (needsConfirmation && !confirmed) || groups.length === 0
                }
              >
                {busy ? 'Saving…' : 'Save automatic access'}
              </button>
            </div>
            {message && (
              <p role="status" style={{ margin: 0 }}>
                {message}
              </p>
            )}
            <p style={{ margin: 0, opacity: 0.8 }}>
              Anyone who can add people to these groups at your identity provider can now add them
              to this workspace.
            </p>
          </>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={fromHere}
            onChange={(event) => {
              setFromHere(event.target.checked);
              setAutoGrantEnabledHere(event.target.checked);
            }}
          />
          Let people in from this browser while it is open
        </label>
      </div>
    </details>
  );
}
