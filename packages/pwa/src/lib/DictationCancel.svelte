<script lang="ts">
  // Floats above the mic while it records: how long the recording has run, and a way to throw it
  // away. Fixed against the viewport, since the keyboard bar clips its overflow; it follows the
  // mic, which moves when the bar scrolls or the soft keyboard opens.
  import { onMount } from 'svelte';
  import { clampRight } from '../core/popover-position';
  import { msg } from '../i18n.svelte';

  let { mic, onCancel }: { mic: HTMLElement; onCancel: () => void } = $props();

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
  <button
    type="button"
    class="cancel"
    aria-label={msg().dictation.cancelLabel}
    onpointerdown={(e) => e.preventDefault()}
    onclick={onCancel}>✕ {msg().dictation.cancel}</button
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
  .cancel {
    min-height: 2.75rem;
    padding: 0 1rem;
    border-radius: 999px;
    border: 1px solid var(--danger, #e5484d);
    background: transparent;
    color: var(--danger, #e5484d);
    font: inherit;
    font-weight: 600;
  }
  .cancel:active { background: var(--danger, #e5484d); color: #fff; }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; }
  }
</style>
