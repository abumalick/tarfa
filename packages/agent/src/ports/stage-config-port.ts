import type { ProjectStage } from '@tarfa/contracts';

// The stage list of the project a workspace belongs to. Never throws: a missing, unreadable or
// invalid config yields the default stages.
export interface StageConfigPort {
  stagesFor(projectPath: string): Promise<ProjectStage[]>;
}
