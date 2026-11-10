// A copy of the terminal buffer (scrollback included) for select mode, which the PWA shows in
// an ordinary scrollable element so every platform's native text selection works on it. xterm
// keeps its own rows unselectable, rebuilds them on every redraw (which collapses a native
// selection) and has only the visible screen in the DOM. Each row keeps its colours and its
// place, so the snapshot looks like the terminal it covers.
//
// Lines come back whole in two steps. A line the terminal wrapped is stored as several rows,
// each continuation marked `isWrapped`; those are joined exactly. A row followed by a
// continuation is read untrimmed, or a space at the wrap point would be lost.
//
// Claude Code (and Codex) wrap their own text instead: each row arrives as a separate line,
// with the indent repeated and the space at the break dropped, so the terminal holds nothing
// to tell such a break from a real newline. `reflow` rebuilds those paragraphs by inference.
// A paragraph keeps the rows it was built from, so it is still drawn row for row; only what
// is copied is joined.

import { ansiColor, DEFAULT_BACKGROUND, DEFAULT_FOREGROUND, rgbCss } from './xterm-palette';

export interface SnapshotCell {
  getChars(): string;
  getWidth(): number;
  isFgRGB(): boolean;
  isFgPalette(): boolean;
  getFgColor(): number;
  isBgRGB(): boolean;
  isBgPalette(): boolean;
  getBgColor(): number;
  isBold(): number;
  isItalic(): number;
  isDim(): number;
  isUnderline(): number;
  isStrikethrough(): number;
  isInverse(): number;
  isInvisible(): number;
}

export interface SnapshotLine {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell(x: number): SnapshotCell | undefined;
}

export interface SnapshotBuffer {
  readonly length: number;
  readonly viewportY: number;
  getLine(y: number): SnapshotLine | undefined;
}

export interface RunStyle {
  fg?: string;
  bg?: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
}

export interface Run {
  text: string;
  style: RunStyle;
  // Set on a glyph the view must fit to this many cells, as xterm does: anything outside
  // ASCII may come from a fallback font, whose advance is not the cell width.
  cells?: number;
}

// One terminal row. `pad` is the indent (in columns) a rebuilt paragraph dropped from this
// row's text: drawn, but not part of what is copied.
export interface SnapshotRow {
  pad: number;
  runs: Run[];
}

export interface SnapshotText {
  text: string;
  rows: SnapshotRow[];
}

export interface TerminalSnapshot {
  lines: SnapshotText[];
  // The viewport's top row, so the snapshot opens where the user was.
  viewportLine: number;
  viewportRow: number;
}

interface Logical {
  text: string;
  rows: SnapshotRow[];
}

export function snapshotBuffer(buffer: SnapshotBuffer, cols: number): TerminalSnapshot {
  const logical: Logical[] = [];
  let rowIndex = 0;
  let viewportIndex = 0;
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    if (y <= buffer.viewportY) viewportIndex = rowIndex;
    rowIndex++;
    const continued = buffer.getLine(y + 1)?.isWrapped ?? false;
    const row = readRow(line, !continued);
    const text = rowText(row);
    const last = logical[logical.length - 1];
    if (line.isWrapped && last) {
      last.text += text;
      last.rows.push(row);
    } else logical.push({ text, rows: [row] });
  }

  const paragraphs = reflow(logical, cols);
  let viewportLine = 0;
  let viewportRow = 0;
  let seen = 0;
  for (const [i, p] of paragraphs.entries()) {
    if (seen + p.rows.length > viewportIndex) {
      viewportLine = i;
      viewportRow = viewportIndex - seen;
      break;
    }
    seen += p.rows.length;
  }
  return { lines: paragraphs.map(({ text, rows }) => ({ text, rows })), viewportLine, viewportRow };
}

const rowText = (row: SnapshotRow) => row.runs.map((r) => r.text).join('');

// The row's text exactly as xterm's translateToString gives it (a wide character's second
// cell adds nothing, an empty cell is a space, a trimmed row ends at its last written cell),
// cut into runs of one style.
function readRow(line: SnapshotLine, trimRight: boolean): SnapshotRow {
  let end = line.length;
  if (trimRight) {
    end = 0;
    for (let x = line.length - 1; x >= 0; x--) {
      const cell = line.getCell(x);
      if (cell && cell.getChars() !== '') {
        end = x + Math.max(cell.getWidth(), 1);
        break;
      }
    }
  }
  const runs: Run[] = [];
  for (let x = 0; x < end; ) {
    const cell = line.getCell(x);
    if (!cell) break;
    const style = cellStyle(cell);
    const chars = cell.getChars() || ' ';
    const width = cell.getWidth() || 1;
    const last = runs[runs.length - 1];
    if (width !== 1 || /[^\x20-\x7e]/.test(chars)) runs.push({ text: chars, style, cells: width });
    else if (last && last.cells === undefined && sameStyle(last.style, style)) last.text += chars;
    else runs.push({ text: chars, style });
    x += cell.getWidth() || 1;
  }
  return { pad: 0, runs };
}

type Colour = { kind: 'default' } | { kind: 'palette'; index: number } | { kind: 'rgb'; value: number };

const colourOf = (rgb: boolean, palette: boolean, value: number): Colour =>
  rgb ? { kind: 'rgb', value } : palette ? { kind: 'palette', index: value } : { kind: 'default' };

const cssOf = (c: Colour, fallback?: string) =>
  c.kind === 'rgb' ? rgbCss(c.value) : c.kind === 'palette' ? ansiColor(c.index) : fallback;

// Mirrors xterm's DOM renderer under its default options: inverse swaps the two colours (a
// default one taking the theme's), then bold brightens a foreground among the first eight
// palette colours, and dim halves the foreground's opacity, except a true-colour one (xterm
// writes that inline, over its dim class).
export function cellStyle(cell: SnapshotCell): RunStyle {
  let fgc = colourOf(cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor());
  let bgc = colourOf(cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor());
  let fg: string | undefined;
  let bg: string | undefined;
  if (cell.isInverse()) {
    [fgc, bgc] = [bgc, fgc];
    fg = cssOf(fgc, DEFAULT_BACKGROUND);
    bg = cssOf(bgc, DEFAULT_FOREGROUND);
  } else {
    fg = cssOf(fgc);
    bg = cssOf(bgc);
  }
  if (cell.isBold() && fgc.kind === 'palette' && fgc.index < 8) fg = ansiColor(fgc.index + 8);
  if (cell.isDim() && fgc.kind !== 'rgb') fg = `${fg ?? DEFAULT_FOREGROUND}80`;
  if (cell.isInvisible()) fg = 'transparent';
  const style: RunStyle = {};
  if (fg) style.fg = fg;
  if (bg) style.bg = bg;
  if (cell.isBold()) style.bold = true;
  if (cell.isItalic()) style.italic = true;
  if (cell.isUnderline()) style.underline = true;
  if (cell.isStrikethrough()) style.strike = true;
  return style;
}

const sameStyle = (a: RunStyle, b: RunStyle) =>
  a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike;

function dropIndent(row: SnapshotRow, indent: number): SnapshotRow {
  let left = indent;
  const runs: Run[] = [];
  for (const run of row.runs) {
    if (left >= run.text.length) {
      left -= run.text.length;
      continue;
    }
    runs.push(left > 0 ? { ...run, text: run.text.slice(left) } : run);
    left = 0;
  }
  return { pad: indent, runs };
}

// A line that opens an item: its continuation rows line up under the item's text ("- foo")
// or under the marker itself ("• foo"), so both indents are accepted.
const ITEM = /^(?:[-*+•●⏺⎿]\s+|\d+[.)]\s+)/;
// A line that must never be joined to the one above it.
const NEW_ITEM = /^(?:[-*+•●⏺⎿❯✻]|\d+[.)]\s|[│├└┌┐┘┤┬┴┼╭╮╯╰─])/;
// A line nothing is joined onto: a table row, or the prompt line, whose box wraps narrower.
const UNJOINABLE = /^[❯│├└┌┐┘┤┬┴┼╭╮╯╰─]/;

const indentOf = (s: string) => s.length - s.trimStart().length;
const firstToken = (s: string) => s.trimStart().split(' ')[0] ?? '';
const lastToken = (s: string) => s.slice(s.lastIndexOf(' ') + 1);

interface Paragraph extends Logical {
  lastRowLength: number;
  hangs: number[];
}

// An app that wraps text breaks a row only when the next word does not fit, so a break is
// taken as the app's own when the row plus a space plus the next word exceeds the width, and
// the next row is indented as a continuation and does not open a new item. Measured on Claude
// Code: it wraps at exactly the terminal width. A row filled to the last column whose last
// token cannot fit on any row (a long URL or command) was cut mid-token, so it rejoins with
// no space. Rows the terminal wrapped itself are already whole when they get here.
function reflow(lines: Logical[], cols: number): Paragraph[] {
  const out: Paragraph[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const lastRowLength = line.text.length - (line.rows.length - 1) * cols;
    if (prev && joins(prev, line.text, cols)) {
      const indent = indentOf(line.text);
      const rest = line.text.slice(indent);
      const cut = prev.lastRowLength === cols && lastToken(prev.text).length + firstToken(rest).length > cols - indent;
      if (!cut) prev.rows[prev.rows.length - 1]!.runs.push({ text: ' ', style: {} });
      prev.text += (cut ? '' : ' ') + rest;
      prev.hangs = [indent];
      prev.lastRowLength = lastRowLength;
      prev.rows.push(dropIndent(line.rows[0]!, indent), ...line.rows.slice(1));
      continue;
    }
    const trimmed = line.text.trimStart();
    const indent = indentOf(line.text);
    const item = ITEM.exec(trimmed);
    out.push({
      ...line,
      rows: [...line.rows],
      lastRowLength,
      hangs: item ? [indent, indent + item[0].length] : [indent],
    });
  }
  return out;
}

function joins(prev: Paragraph, next: string, cols: number): boolean {
  if (prev.text.trim() === '' || next.trim() === '') return false;
  if (UNJOINABLE.test(prev.text.trimStart())) return false;
  const rest = next.trimStart();
  if (NEW_ITEM.test(rest)) return false;
  const indent = indentOf(next);
  if (!prev.hangs.includes(indent)) return false;
  const token = firstToken(rest).length;
  // A token too long for any row says nothing about whether it fitted, unless the row
  // before was filled to the edge: then it was cut there.
  if (token > cols - indent) return prev.lastRowLength === cols;
  return prev.lastRowLength + 1 + token > cols;
}

// What the OS copies from the snapshot keeps the terminal's left margin (Claude Code indents
// its whole reply), so a copy drops the indent the selected lines share. A first line with no
// indent is left out of the measure: the selection most likely started mid-line.
export function dedentCopied(text: string): string {
  const lines = text.split('\n');
  if (lines.length === 1) return text.trimStart();
  const [first = '', ...rest] = lines;
  const measured = (indentOf(first) > 0 ? lines : rest).filter((l) => l.trim() !== '');
  const shared = measured.length > 0 ? Math.min(...measured.map(indentOf)) : 0;
  return lines.map((l) => l.slice(Math.min(shared, indentOf(l)))).join('\n');
}
