import type { IBufferCell, IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { findWorkspaceIds, type TerminalCell } from '../core/workspace-id-links';

// `reuse` saves an allocation per cell when a whole screen is read at once.
export function lineCells(line: IBufferLine, reuse?: IBufferCell): TerminalCell[] {
  const cells: TerminalCell[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x, reuse);
    cells.push({ chars: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1 });
  }
  return cells;
}

// Links a workspace id only when `resolve` knows it, so an unknown id stays plain text.
// An id wrapped across two rows is not found.
export function workspaceIdLinkProvider<W>(
  term: Terminal,
  resolve: (id: string) => W | null,
  open: (workspace: W) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1);
      if (!line) return callback(undefined);
      const links: ILink[] = findWorkspaceIds(lineCells(line))
        .filter((m) => resolve(m.id) !== null)
        .map((m) => ({
          text: m.id,
          range: { start: { x: m.startCol + 1, y }, end: { x: m.endCol + 1, y } },
          // The list can change between hover and tap, so resolve again.
          activate: () => {
            const workspace = resolve(m.id);
            if (workspace) open(workspace);
          },
        }));
      callback(links.length ? links : undefined);
    },
  };
}
