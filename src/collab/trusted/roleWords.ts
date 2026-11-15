import type { TrustedWorkspace } from './trustedStoreClient.ts';

const ROLE_WORDS: Record<TrustedWorkspace['role'], string> = {
  viewer: 'a viewer',
  editor: 'an editor',
  owner: 'an owner',
};

/** "You are an editor here, through the group platform-eng." */
export function describeRole(workspace: Pick<TrustedWorkspace, 'role' | 'via'>): string {
  const how =
    workspace.via.kind === 'group'
      ? `, through the group ${workspace.via.group}`
      : workspace.via.kind === 'admin'
        ? ', as a store administrator'
        : '';
  return `You are ${ROLE_WORDS[workspace.role]} here${how}.`;
}
