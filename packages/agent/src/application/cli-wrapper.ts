// What `tarfa setup` and `tarfa apply` do about ~/.local/bin/tarfa and ~/.local/bin/perch for a
// package install: a wrapper script (templates/tarfa-cli-wrapper.sh) for the first, a link to it
// for the second. Pure: the caller reads both entries and applies the answer.

export const WRAPPER_MARKER = 'tarfa-cli-wrapper (managed by tarfa)';

// What sits at a path, a link's target already resolved to an absolute path.
export type CliEntry = { kind: 'absent' } | { kind: 'file'; text: string } | { kind: 'link'; target: string } | { kind: 'other' };

export interface CliState {
  // ~/.local/bin, and whether it is on the running PATH.
  bin: string;
  onPath: boolean;
  // The first `tarfa` on the running PATH: its path as found and where it resolves; null when none.
  winner: { path: string; real: string } | null;
  // `real` is where the wrapper's own path resolves once written.
  wrapper: { path: string; real: string; template: string; entry: CliEntry };
  perch: { path: string; entry: CliEntry };
}

export interface CliPlan {
  // The wrapper's text, when it is to be written.
  writeWrapper: string | null;
  linkPerch: boolean;
  notes: string[];
}

// What an install from a checkout links (deploy/install-cli.sh), under either name.
const CLONE_LINK = /\/deploy\/(tarfa|perch)-cli\.sh$/;

export function planCli(cli: CliState): CliPlan {
  const notes: string[] = [];
  const { wrapper, perch } = cli;
  let writeWrapper: string | null = null;
  let ours = true;
  const entry = wrapper.entry;
  if (entry.kind === 'absent' || (entry.kind === 'link' && CLONE_LINK.test(entry.target))) writeWrapper = wrapper.template;
  else if (entry.kind === 'file' && entry.text.includes(WRAPPER_MARKER)) writeWrapper = entry.text === wrapper.template ? null : wrapper.template;
  else {
    ours = false;
    notes.push(`warning: ${wrapper.path} is not Tarfa's wrapper, so it is left alone (the \`tarfa\` you run may not be the installed package)`);
  }

  let linkPerch = false;
  const old = perch.entry;
  if (old.kind === 'absent' || (old.kind === 'link' && CLONE_LINK.test(old.target))) linkPerch = ours;
  else if (!(old.kind === 'link' && old.target === wrapper.path)) notes.push(`warning: ${perch.path} is not a link to tarfa, so it is left alone`);

  const winner = cli.winner;
  if (ours && winner !== null && winner.path !== wrapper.path && winner.real !== wrapper.real) {
    notes.push(`warning: \`tarfa\` on your PATH is ${winner.path}, not ${wrapper.path}, so it may run under a project's node: put ${cli.bin} first on PATH`);
  }
  if (!cli.onPath && ours) notes.push(`note: ${cli.bin} is not on PATH; add it to use \`tarfa\``);
  return { writeWrapper, linkPerch, notes };
}
