import type { ProjectStage } from '@tarfa/contracts';

// The stage list of the project a workspace belongs to. Never throws: a missing, unreadable or
// invalid config yields the default stages.
export interface StageConfigPort {
  stagesFor(projectPath: string): Promise<ProjectStage[]>;
  // The file stagesFor found invalid and replaced with the defaults, or null. Never throws.
  invalidConfig?(projectPath: string): Promise<string | null>;
}
