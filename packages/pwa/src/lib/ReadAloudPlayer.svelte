<script lang="ts">
  // The read-aloud controls, floating over the bottom of the terminal while a reply is read.
  // Positions are estimates (the voice reports none), hence "about" in the skip labels.
  import type { ReadAloudState } from '../core/read-aloud';
  import { msg } from '../i18n.svelte';

  let {
    player,
    onToggle,
    onSkip,
    onClose,
  }: {
    player: { state: ReadAloudState; position: number; duration: number };
    onToggle: () => void;
    onSkip: (seconds: number) => void;
    onClose: () => void;
  } = $props();

  // Keeps the terminal's focus, so the soft keyboard stays where it was.
  const keepFocus = (e: Event) => e.preventDefault();
  const clock = (seconds: number) => {
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const playing = $derived(player.state === 'playing');
  const canSkip = $derived(player.state === 'playing' || player.state === 'paused');
</script>

<div class="player" role="region" aria-label={msg().readAloud.player} data-testid="read-aloud-player">
  <button type="button" aria-label={msg().readAloud.back} disabled={!canSkip} onpointerdown={keepFocus} onclick={() => onSkip(-10)}>↺10</button>
  <button type="button" class="main" aria-label={playing ? msg().readAloud.pause : msg().readAloud.play} onpointerdown={keepFocus} onclick={onToggle}
    ><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {#if playing}<rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" />{:else}<path d="M4 2.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 4 2.5z" />{/if}
    </svg></button>
  <button type="button" aria-label={msg().readAloud.forward} disabled={!canSkip} onpointerdown={keepFocus} onclick={() => onSkip(10)}>10↻</button>
  <span class="time" aria-hidden="true">{clock(player.state === 'ended' ? player.duration : player.position)} / {clock(player.duration)}</span>
  <button type="button" class="close" aria-label={msg().readAloud.close} onpointerdown={keepFocus} onclick={onClose}>✕</button>
</div>

<style>
  .player {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    max-width: calc(100% - 16px);
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    touch-action: manipulation;
  }
  button {
    min-width: 2.75rem;
    height: 2.75rem;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-press);
    color: var(--text);
    font: 600 14px ui-monospace, monospace;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  button:disabled { opacity: 0.45; }
  .main {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
  }
  .main svg { fill: currentColor; }
  .close { background: transparent; }
  .time {
    font: 500 12px ui-monospace, monospace;
    white-space: nowrap;
    padding: 0 0.15rem;
  }
</style>
