// A link that opens the PWA on one workspace. The machine is named by its agent key, the one
// thing every phone paired with it knows it by (each phone's entry id is its own).
export interface WorkspaceLink {
  agentKey: string;
  workspaceId: string;
}

export const WORKSPACE_LINK_PREFIX = '#open?';
const KEY = /^[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

const valid = (link: WorkspaceLink) => KEY.test(link.agentKey) && ID.test(link.workspaceId);

export function workspaceLink(pwaOrigin: string, link: WorkspaceLink): string {
  if (!valid(link)) throw new Error(`not a linkable workspace: ${link.workspaceId}`);
  return `${new URL(pwaOrigin).origin}/${WORKSPACE_LINK_PREFIX}k=${link.agentKey}&w=${link.workspaceId}`;
}

// A full link or just its fragment; null for anything incomplete or malformed.
export function parseWorkspaceLink(text: string): WorkspaceLink | null {
  const trimmed = text.trim();
  const at = trimmed.indexOf('#');
  if (at === -1) return null;
  const hash = trimmed.slice(at);
  if (!hash.startsWith(WORKSPACE_LINK_PREFIX)) return null;
  const query = new URLSearchParams(hash.slice(WORKSPACE_LINK_PREFIX.length));
  const link = { agentKey: query.get('k') ?? '', workspaceId: query.get('w') ?? '' };
  return valid(link) ? link : null;
}
