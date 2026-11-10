<script lang="ts">
  // A centred dialog over a scrim. It takes the focus from the terminal, so keys (Escape
  // included) never reach the workspace.
  import type { Snippet } from 'svelte';
  import { msg } from '../i18n.svelte';

  let { title, testid, onClose, children }: { title: string; testid: string; onClose: () => void; children: Snippet } = $props();

  let panel = $state<HTMLDivElement>();
  $effect(() => panel?.focus());
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }} />

<button type="button" class="scrim" aria-label={msg().dictation.setup.close} tabindex="-1" onclick={onClose}></button>
<div class="panel" role="dialog" aria-modal="true" aria-label={title} data-testid={testid} tabindex="-1" bind:this={panel}>
  <h2>{title}</h2>
  {@render children()}
  <button type="button" class="action primary" onclick={onClose}>{msg().dictation.setup.close}</button>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 40;
  }
  .panel {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(32rem, calc(100vw - 2rem));
    max-height: min(85dvh, 44rem);
    overflow-y: auto;
    z-index: 41;
    box-sizing: border-box;
    padding: 1rem 1.15rem 1.15rem;
    border-radius: 0.75rem;
    background: var(--surface, #1b1b1b);
    color: var(--text);
    box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.45);
    font-size: 0.88rem;
    line-height: 1.45;
    outline: none;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
  }
  .panel :global(.action) {
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.6rem;
    border-radius: 0.5rem;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    text-align: center;
    text-decoration: none;
  }
  .panel :global(.action.primary) {
    border: 0;
    background: var(--accent, #3a3a3a);
  }
</style>
