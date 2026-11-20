import { findStage, type ProjectStage } from '@tarfa/contracts';
import type { StageConfigPort } from '../ports/stage-config-port.js';
import type { StatusStorePort } from '../ports/status-store-port.js';
import { resolveCaller, type SendMessageDeps } from './send-message.js';

export interface SetStageDeps extends Pick<SendMessageDeps, 'tmux' | 'ancestry' | 'sessionPrefix'> {
  stageConfig: StageConfigPort;
  status: Pick<StatusStorePort, 'setStage'>;
  // The turn that ends on a waiting stage waits instead of asking; any other stage set after it undoes that.
  onWaitingStaged: (workspaceId: string) => void;
  onNonWaitingStaged: (workspaceId: string) => void;
  onStaged: (workspaceId: string) => void;
}

export type SetStageResult = { result: 'set'; stage: ProjectStage } | { result: 'refused'; reason: string };

export async function setStageFromCli(
  deps: SetStageDeps,
  req: { pane: string; pid: number; codexThread?: string; stage: string },
): Promise<SetStageResult> {
  const caller = await resolveCaller(deps, req);
  if (!caller) return { result: 'refused', reason: 'not run from a Tarfa workspace' };
  const stages = await deps.stageConfig.stagesFor(caller.startPath);
  const stage = findStage(stages, req.stage);
  if (!stage) {
    return { result: 'refused', reason: `unknown stage "${req.stage.trim()}"; valid stages: ${stages.map((s) => s.name).join(', ')}` };
  }
  deps.status.setStage(caller.name, { name: stage.name, kind: stage.kind });
  (stage.kind === 'waiting' ? deps.onWaitingStaged : deps.onNonWaitingStaged)(caller.name);
  deps.onStaged(caller.name);
  return { result: 'set', stage };
}
