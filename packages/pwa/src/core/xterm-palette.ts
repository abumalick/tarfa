// xterm.js's default 256-colour palette (ThemeService's DEFAULT_ANSI_COLORS). The terminal
// uses the default theme, so select mode paints a cell with the colour xterm gave it.
const BASE = [
  '#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
  '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',
];

const hex = (n: number) => n.toString(16).padStart(2, '0');
export const rgbCss = (rgb: number) => `#${hex((rgb >> 16) & 0xff)}${hex((rgb >> 8) & 0xff)}${hex(rgb & 0xff)}`;

const PALETTE: readonly string[] = (() => {
  const colors = [...BASE];
  const v = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  for (let i = 0; i < 216; i++) colors.push(`#${hex(v[Math.floor(i / 36) % 6]!)}${hex(v[Math.floor(i / 6) % 6]!)}${hex(v[i % 6]!)}`);
  for (let i = 0; i < 24; i++) colors.push(`#${hex(8 + i * 10).repeat(3)}`);
  return colors;
})();

export const ansiColor = (index: number): string => PALETTE[index] ?? PALETTE[7]!;

export const DEFAULT_FOREGROUND = '#ffffff';
export const DEFAULT_BACKGROUND = '#000000';
