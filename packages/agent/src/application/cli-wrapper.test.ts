import { describe, expect, it } from 'vitest';
import { planCli, WRAPPER_MARKER, type CliEntry, type CliState } from './cli-wrapper';

const BIN = '/home/u/.local/bin';
const TEMPLATE = `#!/bin/sh\n# ${WRAPPER_MARKER}\nexec node\n`;

function state(tarfa: CliEntry, perch: CliEntry, onPath = true, winner: CliState['winner'] = { path: `${BIN}/tarfa`, real: `${BIN}/tarfa` }): CliState {
  return { bin: BIN, onPath, winner, wrapper: { path: `${BIN}/tarfa`, real: `${BIN}/tarfa`, template: TEMPLATE, entry: tarfa }, perch: { path: `${BIN}/perch`, entry: perch } };
}
const LINKED: CliEntry = { kind: 'link', target: `${BIN}/tarfa` };

describe('planCli', () => {
  it('writes the wrapper and links perch where nothing is', () => {
    expect(planCli(state({ kind: 'absent' }, { kind: 'absent' }))).toEqual({ writeWrapper: TEMPLATE, linkPerch: true, notes: [] });
  });

  it('replaces links into a clone, under either name, and an earlier copy of the wrapper', () => {
    const clone: CliEntry = { kind: 'link', target: '/home/u/workspace/perch/deploy/tarfa-cli.sh' };
    const old: CliEntry = { kind: 'link', target: '/home/u/workspace/perch/deploy/perch-cli.sh' };
    expect(planCli(state(clone, old))).toEqual({ writeWrapper: TEMPLATE, linkPerch: true, notes: [] });
    expect(planCli(state({ kind: 'file', text: `#!/bin/sh\n# ${WRAPPER_MARKER}\nold\n` }, LINKED)).writeWrapper).toBe(TEMPLATE);
  });

  it('plans nothing when the wrapper is current and perch links to it', () => {
    expect(planCli(state({ kind: 'file', text: TEMPLATE }, LINKED))).toEqual({ writeWrapper: null, linkPerch: false, notes: [] });
  });

  it('leaves anything else alone with one warning each, and plans nothing for it', () => {
    const plan = planCli(state({ kind: 'file', text: '#!/bin/sh\necho mine\n' }, { kind: 'link', target: '/usr/bin/other' }));
    expect(plan.writeWrapper).toBeNull();
    expect(plan.linkPerch).toBe(false);
    expect(plan.notes).toEqual([expect.stringContaining(`${BIN}/tarfa is not Tarfa's wrapper`), expect.stringContaining(`${BIN}/perch is not a link to tarfa`)]);
    expect(planCli(state({ kind: 'other' }, { kind: 'other' })).notes).toHaveLength(2);
    expect(planCli(state({ kind: 'link', target: '/usr/bin/mise' }, LINKED)).writeWrapper).toBeNull();
  });

  it('does not link perch to a tarfa that is not ours, absent or left from a clone', () => {
    const foreign: CliEntry = { kind: 'file', text: '#!/bin/sh\necho mine\n' };
    const clone: CliEntry = { kind: 'link', target: '/home/u/workspace/perch/deploy/perch-cli.sh' };
    expect(planCli(state(foreign, { kind: 'absent' })).linkPerch).toBe(false);
    expect(planCli(state(foreign, clone)).linkPerch).toBe(false);
  });

  it('warns once when another tarfa comes first on PATH, and not when the wrapper, or a link to it, does', () => {
    const other = { path: '/proj/node_modules/.bin/tarfa', real: '/proj/node_modules/@tarfa/cli/bin/tarfa' };
    const ours: CliEntry = { kind: 'file', text: TEMPLATE };
    expect(planCli(state(ours, LINKED, true, other)).notes).toEqual([expect.stringMatching(/warning: .*\/proj\/node_modules\/\.bin\/tarfa.*may run under a project's node/)]);
    expect(planCli(state(ours, LINKED, true, null)).notes).toEqual([]);
    expect(planCli(state(ours, LINKED, true, { path: '/alias/tarfa', real: `${BIN}/tarfa` })).notes).toEqual([]);
    expect(planCli(state({ kind: 'absent' }, { kind: 'absent' }, true, { path: `${BIN}/tarfa`, real: '/clone/deploy/tarfa-cli.sh' })).notes).toEqual([]);
    expect(planCli(state({ kind: 'file', text: '#!/bin/sh\nmine\n' }, LINKED, true, other)).notes).toEqual([expect.stringContaining('is not Tarfa')]);
  });

  it('says in one line that ~/.local/bin is off PATH, only when it matters', () => {
    expect(planCli(state({ kind: 'absent' }, { kind: 'absent' }, false)).notes).toEqual([expect.stringContaining('not on PATH')]);
    expect(planCli(state({ kind: 'file', text: TEMPLATE }, LINKED, false)).notes).toEqual([expect.stringContaining('not on PATH')]);
    expect(planCli(state({ kind: 'file', text: '#!/bin/sh\nmine\n' }, LINKED, false)).notes).toEqual([expect.stringContaining('is not Tarfa')]);
  });
});
