import { dirname } from 'node:path';

// What the installed service runs: this checkout's deploy/run-agent.sh (a source install, until
// it is adopted) or the stable launcher a package install, and an adopted machine, runs.
export type ServiceTarget = { kind: 'clone'; repo: string } | { kind: 'launcher'; path: string };

// The templates carry AGENT_COMMAND (systemd), AGENT_ARGUMENTS and LOG_DIR (launchd); a clone's
// rendering is what installs have always had.
export function renderService(template: string, target: ServiceTarget): string {
  if (target.kind === 'clone') {
    return template
      .replaceAll('AGENT_COMMAND', `/usr/bin/env bash ${target.repo}/deploy/run-agent.sh`)
      .replaceAll('AGENT_ARGUMENTS', `<string>/bin/bash</string>\n    <string>${target.repo}/deploy/run-agent.sh</string>`)
      .replaceAll('LOG_DIR', `${target.repo}/deploy`);
  }
  return template
    .replaceAll('AGENT_COMMAND', target.path)
    .replaceAll('AGENT_ARGUMENTS', `<string>${target.path}</string>`)
    .replaceAll('LOG_DIR', dirname(dirname(target.path)));
}

// Under systemd a unit is current only with KillMode=process: it is what keeps every workspace
// alive across a restart. A unit without it still names what it runs, so it is reinstalled for that
// target rather than taken for another.
export function unitKeepsWorkspaces(kind: 'systemd' | 'launchd', installed: string): boolean {
  return kind === 'launchd' || /^KillMode=process\s*$/m.test(installed);
}

function execStartWords(installed: string): string[] {
  return (/^ExecStart=(.*)$/m.exec(installed)?.[1] ?? '').split(/\s+/);
}

export function unitRunsLauncher(kind: 'systemd' | 'launchd', installed: string | null, launcher: string): boolean {
  if (installed === null) return false;
  if (kind === 'launchd') return installed.includes(`<string>${launcher}</string>`);
  return execStartWords(installed).includes(launcher);
}

// However it gets there: dev's unit runs the script through `mise exec` from WorkingDirectory.
export function unitRunsCheckout(kind: 'systemd' | 'launchd', installed: string | null, repo: string): boolean {
  if (installed === null) return false;
  const script = `${repo}/deploy/run-agent.sh`;
  if (kind === 'launchd') return installed.includes(`<string>${script}</string>`);
  const words = execStartWords(installed);
  if (words.includes(script)) return true;
  const workingDirectory = /^WorkingDirectory=(.*)$/m.exec(installed)?.[1]?.trim();
  return workingDirectory === repo && (words.includes('deploy/run-agent.sh') || words.includes('./deploy/run-agent.sh'));
}
