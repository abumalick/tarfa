import type { Terminal } from '@xterm/xterm';
import { linkedIdSpans } from '../core/workspace-id-links';
import { lineCells } from './workspace-id-link-provider';

// xterm underlines a link only under a hovering pointer, which a phone never has, so a tappable
// workspace id would look like plain text. This layer keeps one drawn under each. xterm's own
// decorations cannot do it: they exist only in the normal buffer, and a tmux client draws in the
// alternate one.
export function attachWorkspaceIdUnderlines(term: Terminal, isLink: (id: string) => boolean) {
  const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
  if (!screen) return { refresh() {}, destroy() {} };
  const layer = document.createElement('div');
  layer.className = 'workspace-id-underlines';
  layer.setAttribute('aria-hidden', 'true');
  screen.appendChild(layer);
  let drawn = '';
  let frame = 0;

  const draw = () => {
    frame = 0;
    const buffer = term.buffer.active;
    const rows = [];
    const reuse = buffer.getNullCell();
    for (let r = 0; r < term.rows; r++) {
      const line = buffer.getLine(buffer.viewportY + r);
      rows.push(line ? lineCells(line, reuse) : []);
    }
    const cellW = screen.clientWidth / term.cols;
    const cellH = screen.clientHeight / term.rows;
    const spans = linkedIdSpans(rows, isLink);
    const key = `${cellW}x${cellH}:${spans.map((s) => `${s.row},${s.startCol},${s.endCol}`).join(';')}`;
    if (key === drawn) return;
    drawn = key;
    layer.replaceChildren(
      ...spans.map((s) => {
        const bar = document.createElement('div');
        bar.style.left = `${s.startCol * cellW}px`;
        bar.style.top = `${(s.row + 1) * cellH - 2}px`;
        bar.style.width = `${(s.endCol - s.startCol + 1) * cellW}px`;
        return bar;
      }),
    );
  };
  // The spinner of a busy program renders many times a second: draw once per frame at most.
  const refresh = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const subscriptions = [term.onRender(refresh), term.onScroll(refresh), term.onResize(refresh)];
  refresh();
  return {
    refresh,
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      subscriptions.forEach((s) => s.dispose());
      layer.remove();
    },
  };
}
