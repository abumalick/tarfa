import { isOpenableUrl } from '@tarfa/contracts';
import type { ProcessAncestry } from '../ports/process-ancestry-port.js';
import type { TmuxPort } from '../ports/tmux-port.js';
import type { OpenRequest, OpenRequests } from './open-requests.js';
import { resolveCaller } from './send-message.js';

export interface OpenUrlDeps {
  tmux: TmuxPort;
  ancestry: ProcessAncestry;
  sessionPrefix: string;
  requests: OpenRequests;
  push: (workspaceId: string, request: OpenRequest) => void;
}

export type OpenUrlResult = { result: 'shown' } | { result: 'refused'; reason: 'not a web page' | 'not run from a Tarfa workspace' };

// A program in a workspace asked for a browser (tarfa-open.sh, the workspace's BROWSER): the page
// waits for the phone viewing that workspace. Which workspace asked is for routing, not security:
// anything that can read the hooks secret could type into any pane anyway.
export async function openUrl(deps: OpenUrlDeps, req: { pane: string; pid: number; url: string; codexThread?: string }): Promise<OpenUrlResult> {
  if (!isOpenableUrl(req.url)) return { result: 'refused', reason: 'not a web page' };
  const caller = await resolveCaller(deps, req);
  if (!caller) return { result: 'refused', reason: 'not run from a Tarfa workspace' };
  const request = deps.requests.set(caller.name, req.url);
  if (request) deps.push(caller.name, request);
  return { result: 'shown' };
}
