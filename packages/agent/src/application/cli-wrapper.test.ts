import { describe, expect, it } from 'vitest';
import { planCli, WRAPPER_MARKER, type CliEntry, type CliState } from './cli-wrapper';

const BIN = '/home/u/.local/bin';
const TEMPLATE = `#!/bin/sh\n# ${WRAPPER_MARKER}\nexec node\n`;

function state(tarfa: CliEntry, perch: CliEntry, onPath = true): CliState {
  return { bin: BIN, onPath, wrapper: { path: `${BIN}/tarfa`, template: TEMPLATE, entry: tarfa }, perch: { path: `${BIN}/perch`, entry: perch } };
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

  it('says in one line that ~/.local/bin is off PATH, only when it matters', () => {
    expect(planCli(state({ kind: 'absent' }, { kind: 'absent' }, false)).notes).toEqual([expect.stringContaining('not on PATH')]);
    expect(planCli(state({ kind: 'file', text: TEMPLATE }, LINKED, false)).notes).toEqual([expect.stringContaining('not on PATH')]);
    expect(planCli(state({ kind: 'file', text: '#!/bin/sh\nmine\n' }, LINKED, false)).notes).toEqual([expect.stringContaining('is not Tarfa')]);
  });
});
