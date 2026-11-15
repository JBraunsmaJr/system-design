/**
 * Who is in a workspace, and through what: its members and the
 * identity-provider groups mapped to a role.
 *
 * Everyone in the workspace can read this. Owners (and store
 * administrators, who are owners everywhere) can change it: add someone by
 * name, map a group, change a role, remove either. A change that would cost
 * the person making it their own access, or leave the workspace without an
 * owner, is confirmed first - see accessChanges.ts.
 *
 * People are found by name among those who have signed in to the store at
 * least once; the store has no other list. A group is typed, because the
 * store only learns a group's name when a member of it signs in.
 */
import { useCallback, useEffect, useState } from 'react';
import { Trash2, UserPlus, Users } from 'lucide-react';
import { Button } from '../../common/components/button/Button';
import { warningFor, type AccessChange } from '../../collab/trusted/accessChanges';
import type {
  TrustedGroupMapping,
  TrustedMe,
  TrustedMember,
  TrustedStoreClient,
  TrustedWorkspace,
  WorkspaceRole,
} from '../../collab/trusted/trustedStoreClient';

interface WorkspaceAccessProps {
  client: TrustedStoreClient;
  workspace: TrustedWorkspace;
  me: TrustedMe;
  /** Called after a change that may have altered the signed-in person's own
   * role, so the panel can reload what they see. */
  onOwnAccessChanged: () => void;
}

const ROLES: readonly WorkspaceRole[] = ['viewer', 'editor', 'owner'];
const ROLE_LABEL: Record<WorkspaceRole, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  owner: 'Owner',
};
const ROLE_MEANS: Record<WorkspaceRole, string> = {
  viewer: 'Viewers can open documents.',
  editor: 'Editors can also create, change and delete documents.',
  owner: 'Owners can also rename the workspace and manage who is in it.',
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function RoleSelect(props: {
  value: WorkspaceRole;
  label: string;
  disabled?: boolean;
  onChange: (role: WorkspaceRole) => void;
}) {
  return (
    <select
      className="trusted-workspace__select workspace-access__role"
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value as WorkspaceRole)}
    >
      {ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABEL[role]}
        </option>
      ))}
    </select>
  );
}

export function WorkspaceAccess({
  client,
  workspace,
  me,
  onOwnAccessChanged,
}: WorkspaceAccessProps) {
  const { workspaceId } = workspace;
  const canManage = workspace.role === 'owner' && workspace.archivedAt === null;

  const [members, setMembers] = useState<TrustedMember[] | null>(null);
  const [groups, setGroups] = useState<TrustedGroupMapping[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A change waiting for the person to confirm its warning. */
  const [pending, setPending] = useState<{ change: AccessChange; warning: string } | null>(null);

  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ userId: string; displayName: string | null }[] | null>(null);
  const [personRole, setPersonRole] = useState<WorkspaceRole>('editor');
  const [groupName, setGroupName] = useState('');
  const [groupRole, setGroupRole] = useState<WorkspaceRole>('editor');

  const load = useCallback(async () => {
    try {
      const result = await client.listMembers(workspaceId);
      setMembers(result.members);
      setGroups(result.groups);
    } catch (cause) {
      setMembers([]);
      setGroups([]);
      setError(messageOf(cause));
    }
  }, [client, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Search as the name is typed, a moment after the typing stops. An answer
  // to an earlier query is dropped rather than shown under a later one.
  const trimmedQuery = query.trim();
  useEffect(() => {
    if (!canManage || trimmedQuery.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      client
        .findPeople(workspaceId, trimmedQuery)
        .then((people) => {
          if (!cancelled) setFound(people);
        })
        .catch((cause) => {
          if (!cancelled) setError(messageOf(cause));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canManage, client, workspaceId, trimmedQuery]);

  const affectsMe = (change: AccessChange) =>
    change.kind === 'member-role' || change.kind === 'member-remove'
      ? change.userId === me.user.userId
      : me.groups.includes(change.group);

  const commit = async (change: AccessChange) => {
    setBusy(true);
    setError(null);
    setPending(null);
    try {
      if (change.kind === 'member-role') {
        await client.putMember(workspaceId, change.userId, change.role);
      } else if (change.kind === 'member-remove') {
        await client.removeMember(workspaceId, change.userId);
      } else if (change.kind === 'group-role') {
        await client.putGroupMapping(workspaceId, change.group, change.role);
      } else {
        await client.removeGroupMapping(workspaceId, change.group);
      }
      if (affectsMe(change)) onOwnAccessChanged();
      await load();
    } catch (cause) {
      setError(messageOf(cause));
      // Whatever the store now holds is the truth; show that.
      await load();
    } finally {
      setBusy(false);
    }
  };

  /** Makes a change, asking first if it has a consequence worth stating. */
  const request = (change: AccessChange) => {
    const warning = warningFor(
      { members: members ?? [], groups },
      { userId: me.user.userId, groups: me.groups, isAdmin: me.isAdmin },
      change,
    );
    if (warning) setPending({ change, warning });
    else void commit(change);
  };

  const addPerson = (userId: string) => {
    setQuery('');
    setFound(null);
    request({ kind: 'member-role', userId, role: personRole });
  };

  const addGroup = () => {
    const group = groupName.trim();
    if (!group) return;
    setGroupName('');
    request({ kind: 'group-role', group, role: groupRole });
  };

  const memberIds = new Set((members ?? []).map((m) => m.userId));
  const candidates =
    trimmedQuery.length >= 2 ? (found ?? []).filter((p) => !memberIds.has(p.userId)) : [];
  // Groups the signed-in person is in and that are not mapped yet: the only
  // group names the editor knows without being told.
  const suggestedGroups = me.groups.filter((g) => !groups.some((m) => m.group === g));

  if (members === null) {
    return <p className="trusted-workspace__status">Loading members...</p>;
  }

  return (
    <div className="workspace-access">
      {error && (
        <p className="trusted-workspace__error" role="alert">
          {error}
        </p>
      )}

      {pending && (
        <div className="workspace-access__confirm" role="alertdialog" aria-label="Confirm change">
          <span>{pending.warning}</span>
          <Button
            variant="danger-outline"
            size="sm"
            className="workspace-access__confirm-yes"
            disabled={busy}
            onClick={() => void commit(pending.change)}
          >
            Do it anyway
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
            Cancel
          </Button>
        </div>
      )}

      <section className="workspace-access__section" aria-label="Members">
        <h4 className="workspace-access__heading">
          <UserPlus size={12} aria-hidden="true" /> People
        </h4>
        {members.length === 0 ? (
          <p className="trusted-workspace__status">No one has been added individually.</p>
        ) : (
          members.map((member) => {
            const name = member.displayName ?? member.userId;
            return (
              <div key={member.userId} className="workspace-access__entry" data-kind="member">
                <span className="workspace-access__name">
                  {name}
                  {member.userId === me.user.userId && (
                    <span className="workspace-access__you"> (you)</span>
                  )}
                </span>
                {canManage ? (
                  <>
                    <RoleSelect
                      value={member.role}
                      label={`Role for ${name}`}
                      disabled={busy}
                      onChange={(role) =>
                        request({ kind: 'member-role', userId: member.userId, role })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon={<Trash2 size={12} />}
                      aria-label={`Remove ${name}`}
                      title={`Remove ${name}`}
                      disabled={busy}
                      onClick={() => request({ kind: 'member-remove', userId: member.userId })}
                    />
                  </>
                ) : (
                  <span className="workspace-access__role-text">{ROLE_LABEL[member.role]}</span>
                )}
              </div>
            );
          })
        )}

        {canManage && (
          <div className="workspace-access__add">
            <div className="trusted-workspace__row">
              <label htmlFor="workspace-access-person">Add someone</label>
              <input
                id="workspace-access-person"
                className="trusted-workspace__input"
                placeholder="Search by name"
                value={query}
                autoComplete="off"
                onChange={(e) => setQuery(e.target.value)}
              />
              <RoleSelect
                value={personRole}
                label="Role for the new person"
                onChange={setPersonRole}
              />
            </div>
            {trimmedQuery.length >= 2 &&
              found !== null &&
              (candidates.length === 0 ? (
                <p className="trusted-workspace__status">
                  No one by that name who is not already here. Someone appears once they have signed
                  in to the store for the first time.
                </p>
              ) : (
                candidates.map((person) => (
                  <div key={person.userId} className="workspace-access__entry" data-kind="found">
                    <span className="workspace-access__name">
                      {person.displayName ?? person.userId}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="workspace-access__add-person"
                      disabled={busy}
                      onClick={() => addPerson(person.userId)}
                    >
                      Add as {ROLE_LABEL[personRole].toLowerCase()}
                    </Button>
                  </div>
                ))
              ))}
          </div>
        )}
      </section>

      <section className="workspace-access__section" aria-label="Groups">
        <h4 className="workspace-access__heading">
          <Users size={12} aria-hidden="true" /> Groups
        </h4>
        <p className="trusted-workspace__status">
          Everyone in a group from your identity provider gets its role here when they sign in. No
          one has to approve them.
        </p>
        {groups.map((mapping) => (
          <div key={mapping.group} className="workspace-access__entry" data-kind="group">
            <span className="workspace-access__name">{mapping.group}</span>
            {canManage ? (
              <>
                <RoleSelect
                  value={mapping.role}
                  label={`Role for the group ${mapping.group}`}
                  disabled={busy}
                  onChange={(role) => request({ kind: 'group-role', group: mapping.group, role })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon={<Trash2 size={12} />}
                  aria-label={`Remove the group ${mapping.group}`}
                  title={`Remove the group ${mapping.group}`}
                  disabled={busy}
                  onClick={() => request({ kind: 'group-remove', group: mapping.group })}
                />
              </>
            ) : (
              <span className="workspace-access__role-text">{ROLE_LABEL[mapping.role]}</span>
            )}
          </div>
        ))}

        {canManage && (
          <form
            className="trusted-workspace__row workspace-access__add"
            onSubmit={(e) => {
              e.preventDefault();
              addGroup();
            }}
          >
            <label htmlFor="workspace-access-group">Add a group</label>
            <input
              id="workspace-access-group"
              className="trusted-workspace__input"
              placeholder="Its name in your identity provider"
              list="workspace-access-group-suggestions"
              value={groupName}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => setGroupName(e.target.value)}
            />
            <datalist id="workspace-access-group-suggestions">
              {suggestedGroups.map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
            <RoleSelect value={groupRole} label="Role for the new group" onChange={setGroupRole} />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="workspace-access__add-group"
              disabled={busy || groupName.trim() === ''}
            >
              Add group
            </Button>
          </form>
        )}
      </section>

      <p className="trusted-workspace__status workspace-access__legend">
        {ROLES.map((role) => ROLE_MEANS[role]).join(' ')} Someone with more than one role has the
        highest of them. A change to someone&apos;s groups takes effect the next time they sign in.
      </p>
    </div>
  );
}
