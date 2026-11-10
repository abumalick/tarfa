import { describe, it, expect } from 'vitest';
import { cellStyle, dedentCopied, snapshotBuffer, type SnapshotBuffer, type SnapshotCell, type SnapshotLine } from './terminal-snapshot';

// Rows as xterm stores them: fixed width (padded with empty cells), plus whether the row is the
// soft-wrapped continuation of the one above.
type Attrs = Partial<{ fg: number; fgRgb: number; bg: number; bold: boolean; dim: boolean; inverse: boolean }>;

function cell(chars: string, attrs: Attrs = {}): SnapshotCell {
  return {
    getChars: () => chars,
    getWidth: () => 1,
    isFgRGB: () => attrs.fgRgb !== undefined,
    isFgPalette: () => attrs.fg !== undefined,
    getFgColor: () => attrs.fgRgb ?? attrs.fg ?? 0,
    isBgRGB: () => false,
    isBgPalette: () => attrs.bg !== undefined,
    getBgColor: () => attrs.bg ?? 0,
    isBold: () => (attrs.bold ? 1 : 0),
    isItalic: () => 0,
    isDim: () => (attrs.dim ? 1 : 0),
    isUnderline: () => 0,
    isStrikethrough: () => 0,
    isInverse: () => (attrs.inverse ? 1 : 0),
    isInvisible: () => 0,
  };
}

function line(cells: SnapshotCell[], cols: number, isWrapped = false): SnapshotLine {
  const all = [...cells, ...Array.from({ length: Math.max(0, cols - cells.length) }, () => cell(''))];
  return { isWrapped, length: all.length, getCell: (x) => all[x] };
}

function buffer(rows: Array<string | [string, 'wrapped']>, viewportY = 0, cols = 10): SnapshotBuffer & { cols: number } {
  const lines = rows.map((r) => {
    const [text, isWrapped] = typeof r === 'string' ? [r, false] : [r[0], true];
    return line([...text].map((c) => cell(c)), cols, isWrapped);
  });
  return { length: lines.length, viewportY, cols, getLine: (i) => lines[i] };
}

const run = (b: SnapshotBuffer & { cols: number }) => snapshotBuffer(b, b.cols);
const texts0 = (b: SnapshotBuffer & { cols: number }) => run(b).lines.map((l) => l.text);

describe('snapshotBuffer', () => {
  it('returns one line per row with trailing padding trimmed', () => {
    expect(texts0(buffer(['$ ls', 'a  b']))).toEqual(['$ ls', 'a  b']);
  });

  it('joins soft-wrapped rows into one logical line, keeping a space at the wrap point', () => {
    expect(texts0(buffer(['https://ex', ['ample.com ', 'wrapped'], ['next', 'wrapped'], 'after']))).toEqual(['https://example.com next', 'after']);
  });

  it('keeps blank rows at the end of the buffer, which the screen shows too', () => {
    expect(texts0(buffer(['one', '', 'two', '', '']))).toEqual(['one', '', 'two', '', '']);
  });

  it('maps the viewport top row to its logical line', () => {
    const rows: Array<string | [string, 'wrapped']> = ['a', 'bbbbbbbbbb', ['b', 'wrapped'], 'c', 'd'];
    expect(run(buffer(rows, 0)).viewportLine).toBe(0);
    expect(run(buffer(rows, 2)).viewportLine).toBe(1);
    expect(run(buffer(rows, 3)).viewportLine).toBe(2);
  });

  it('points at the viewport row inside a soft-wrapped line', () => {
    const rows: Array<string | [string, 'wrapped']> = ['a', 'bbbbbbbbbb', ['b', 'wrapped'], 'c'];
    expect(run(buffer(rows, 2))).toMatchObject({ viewportLine: 1, viewportRow: 1 });
  });

  it('keeps one row per terminal row, split into runs of one style', () => {
    const b = { length: 2, viewportY: 0, getLine: (i: number) => [
      line([cell('o', { fg: 1 }), cell('k', { fg: 1 }), cell(' '), cell('x', { bg: 4 })], 10),
      line([cell('a'), cell('b')], 10, true),
    ][i] };
    const [only] = snapshotBuffer(b, 10).lines;
    expect(only!.text).toBe('ok x      ab');
    expect(only!.rows).toEqual([
      { pad: 0, runs: [{ text: 'ok', style: { fg: '#cc0000' } }, { text: ' ', style: {} }, { text: 'x', style: { bg: '#3465a4' } }, { text: '      ', style: {} }] },
      { pad: 0, runs: [{ text: 'ab', style: {} }] },
    ]);
  });

  it('handles an empty buffer', () => {
    expect(run(buffer([]))).toEqual({ lines: [], viewportLine: 0, viewportRow: 0 });
  });
});

// Claude Code wraps its own text: each row arrives as a separate line, the indent repeated
// and the space at the break dropped. Shapes below are taken from real panes.
describe('snapshotBuffer: rebuilding paragraphs an app wrapped itself', () => {
  const W = 40;
  const texts = (rows: string[]) => run(buffer(rows, 0, W)).lines.map((l) => l.text);

  it('joins prose the app broke because the next word did not fit, dropping the repeated indent', () => {
    const rows = [
      '  The bank is declining the charge, and',
      '  the error says so.',
    ];
    expect(texts(rows)).toEqual(['  The bank is declining the charge, and the error says so.']);
  });

  it('keeps a line break when the next word would have fitted (a real newline)', () => {
    expect(texts(['  Short line.', '  Another line.'])).toEqual(['  Short line.', '  Another line.']);
  });

  it('joins over several rows into one paragraph', () => {
    const rows = [
      '  one two three four five six seven eig',
      '  nine ten eleven twelve thirteen fourt',
      '  end',
    ];
    expect(texts(rows)).toEqual([
      '  one two three four five six seven eig nine ten eleven twelve thirteen fourt end',
    ]);
  });

  it('continues a "-" bullet under its text and a "•" bullet under the bullet itself', () => {
    expect(texts([
      '  - Submitted the ticket for the account',
      '    asking them to retry.',
      '  • Tell them why the charges were the',
      '  declined ones.',
    ])).toEqual([
      '  - Submitted the ticket for the account asking them to retry.',
      '  • Tell them why the charges were the declined ones.',
    ]);
  });

  it('never joins the start of a new item, even when it would not have fitted', () => {
    expect(texts([
      '  - First item fills the whole row here',
      '  - Second item',
      '  1. Numbered item fills the whole row',
      '  2. Next',
    ])).toEqual([
      '  - First item fills the whole row here',
      '  - Second item',
      '  1. Numbered item fills the whole row',
      '  2. Next',
    ]);
  });

  it('joins a token cut at the edge of the row without a space', () => {
    expect(texts([
      '● Bash(curl https://example.com/a/very/l',
      '  ong/path/that/goes/on/and/on/and/on/zz',
      '  /end)',
    ])).toEqual(['● Bash(curl https://example.com/a/very/long/path/that/goes/on/and/on/and/on/zz/end)']);
  });

  it('does not join a short line to a token too long for any row', () => {
    expect(texts(['  $ cat notes', '  https://example.com/a/path/longer/than/a/row'])).toEqual([
      '  $ cat notes',
      '  https://example.com/a/path/longer/than/a/row',
    ]);
  });

  it('puts a space back when a full row simply ended on a word', () => {
    expect(texts([
      '  aaaa bbbb cccc dddd eeee ffff gggg hhh',
      '  iiii',
    ])).toEqual(['  aaaa bbbb cccc dddd eeee ffff gggg hhh iiii']);
  });

  it('keeps an indent change, a table and the prompt apart', () => {
    const rows = [
      '  A paragraph that runs to the very end',
      '      indented differently',
      '  │ cell one that is wide enough here │',
      '  │ cell two                           │',
      '❯ a prompt typed by the user that wraps',
      '  onto a second row',
    ];
    expect(texts(rows)).toEqual(rows);
  });

  it('keeps the rows of a joined paragraph, the dropped indent as padding', () => {
    const [first] = run(buffer([
      '  - Submitted the ticket for the account',
      '    asking them to retry.',
      '  plain',
    ], 0, W)).lines;
    expect(first!.rows.map((r) => [r.pad, r.runs.map((x) => x.text).join('')])).toEqual([
      [0, '  - Submitted the ticket for the account '],
      [4, 'asking them to retry.'],
    ]);
  });

  it('maps the viewport row into a rebuilt paragraph', () => {
    const rows = ['  The bank is declining the charge, and', '  the error says so.', '  next'];
    expect(run(buffer(rows, 1, W)).viewportLine).toBe(0);
    expect(run(buffer(rows, 2, W)).viewportLine).toBe(1);
    expect(run(buffer(rows, 1, W))).toMatchObject({ viewportLine: 0, viewportRow: 1 });
  });
});

describe('cellStyle', () => {
  it('leaves default colours to the page', () => {
    expect(cellStyle(cell('a'))).toEqual({});
  });

  it('brightens the first eight colours when bold, as xterm does', () => {
    expect(cellStyle(cell('a', { fg: 2, bold: true }))).toEqual({ fg: '#8ae234', bold: true });
    expect(cellStyle(cell('a', { fg: 196, bold: true }))).toEqual({ fg: '#ff0000', bold: true });
  });

  it('reads true colour', () => {
    expect(cellStyle(cell('a', { fgRgb: 0x123456 }))).toEqual({ fg: '#123456' });
  });

  it('swaps the colours of an inverse cell, defaults included', () => {
    expect(cellStyle(cell('a', { inverse: true }))).toEqual({ fg: '#000000', bg: '#ffffff' });
    expect(cellStyle(cell('a', { inverse: true, fg: 1 }))).toEqual({ fg: '#000000', bg: '#cc0000' });
  });

  it('halves a dim foreground', () => {
    expect(cellStyle(cell('a', { dim: true, fg: 244 }))).toEqual({ fg: '#80808080' });
  });
});

describe('dedentCopied', () => {
  it('trims the indent of a single copied line', () => {
    expect(dedentCopied('  ls -la')).toBe('ls -la');
  });

  it('removes the indent every line shares, keeping relative indentation', () => {
    expect(dedentCopied('  - item\n    continued\n  - next')).toBe('- item\n  continued\n- next');
  });

  it('dedents a selection that starts mid-line by the indent of the lines after it', () => {
    expect(dedentCopied('word and more\n  second line\n    nested')).toBe('word and more\nsecond line\n  nested');
  });

  it('ignores blank lines when measuring the shared indent', () => {
    expect(dedentCopied('  one\n\n  two')).toBe('one\n\ntwo');
  });

  it('leaves text unchanged when a line after the first has no indent', () => {
    expect(dedentCopied('  a\n  b\nc')).toBe('  a\n  b\nc');
  });
});
