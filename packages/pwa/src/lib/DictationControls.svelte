<script lang="ts">
  // Floats above the mic while it records: how long the recording has run, a stop that sends it
  // to be transcribed (the mic's own second tap, made explicit) and, where the dictation can be
  // thrown away, a cancel. Fixed against the viewport, since the keyboard bar clips its overflow; it follows the
  // mic, which moves when the bar scrolls or the soft keyboard opens.
  import { onMount } from 'svelte';
  import { clampRight } from '../core/popover-position';
  import { msg } from '../i18n.svelte';

  let { mic, onStop, onCancel }: { mic: HTMLElement; onStop: () => void; onCancel?: () => void } = $props();

  const keepFocus = (e: Event) => e.preventDefault();

  const started = Date.now();
  let elapsed = $state(0);
  let anchor = $state({ bottom: 0, right: 0 });
  let pill = $state<HTMLDivElement>();
  let width = $state(0);

  function place() {
    const rect = mic.getBoundingClientRect();
    anchor = { bottom: window.innerHeight - rect.top + 6, right: Math.max(4, window.innerWidth - rect.right) };
    width = pill?.offsetWidth ?? 0;
  }

  onMount(() => {
    place();
    const tick = setInterval(() => {
      elapsed = Math.floor((Date.now() - started) / 1000);
      place();
    }, 250);
    // The bar is a scroller: catch its scroll on the way down, wherever it sits.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      clearInterval(tick);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  });

  const clock = $derived(`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`);
</script>

<div
  class="pill"
  bind:this={pill}
  style="bottom: {anchor.bottom}px; right: {clampRight(anchor.right, width, window.innerWidth)}px"
>
  <span class="status" role="timer" aria-label="{msg().dictation.recording} {clock}"><span class="dot" aria-hidden="true"></span>{clock}</span>
  {#if onCancel}
    <button type="button" class="cancel" aria-label={msg().dictation.cancelLabel} onpointerdown={keepFocus} onclick={onCancel}>✕</button>
  {/if}
  <button type="button" class="stop" aria-label={msg().dictation.stopLabel} onpointerdown={keepFocus} onclick={onStop}
    ><span class="square" aria-hidden="true"></span></button
  >
</div>

<style>
  .pill {
    position: fixed;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.25rem 0.25rem 0.75rem;
    background: var(--surface, #1c1c1f);
    border: 1px solid var(--border, #3a3a40);
    border-radius: 999px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.35);
    color: var(--text);
    font-size: 0.95rem;
    -webkit-user-select: none;
    user-select: none;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-variant-numeric: tabular-nums;
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--danger, #e5484d);
    animation: blink 1s ease-in-out infinite;
  }
  .cancel, .stop {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    padding: 0;
    font: inherit;
  }
  .cancel {
    border: 1px solid var(--border, #3a3a40);
    background: transparent;
    color: var(--text-dim, var(--text));
    font-size: 1.1rem;
  }
  .cancel:active { background: var(--border, #3a3a40); }
  .stop {
    border: none;
    background: var(--danger, #e5484d);
  }
  .stop:active { filter: brightness(0.85); }
  .square {
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 2px;
    background: #fff;
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; }
  }
</style>
