<script lang="ts">
  // How to turn the phone's voice on, for this device's system and browser.
  import { msg } from '../i18n.svelte';
  import { GOOGLE_SPEECH_URL, type VoicePlatform } from './voice-platform';

  let { platform, onClose }: { platform: VoicePlatform; onClose: () => void } = $props();

  // Takes the focus from the terminal, so keys (Escape included) never reach the workspace.
  let done = $state<HTMLButtonElement>();
  $effect(() => done?.focus());
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }} />

<button type="button" class="scrim" aria-label={msg().readAloud.dismiss} onclick={onClose}></button>
<div class="panel" role="dialog" aria-modal="true" aria-label={msg().readAloud.helpTitle} data-testid="voice-help">
  <h2>{msg().readAloud.helpTitle}</h2>
  <ol>
    {#each msg().readAloud.helpSteps[platform] as step (step)}
      <li>{step}</li>
    {/each}
  </ol>
  {#if platform === 'android-chrome'}
    <a class="store" href={GOOGLE_SPEECH_URL} target="_blank" rel="noopener noreferrer">{msg().readAloud.openStore}</a>
  {/if}
  <button type="button" class="done" bind:this={done} onclick={onClose}>{msg().readAloud.done}</button>
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
    max-height: min(80dvh, 40rem);
    overflow-y: auto;
    z-index: 41;
    padding: 1rem 1.15rem 1.15rem;
    border-radius: 0.75rem;
    background: var(--surface, #1b1b1b);
    color: var(--text);
    box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.45);
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
  }
  ol {
    margin: 0 0 0.75rem;
    padding-left: 1.25rem;
    font-size: 0.88rem;
    line-height: 1.45;
  }
  li + li { margin-top: 0.45rem; }
  .store, .done {
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin-top: 0.5rem;
    padding: 0.6rem;
    border-radius: 0.5rem;
    font-size: 0.9rem;
    text-align: center;
  }
  .store {
    border: 1px solid var(--accent);
    color: var(--text);
    text-decoration: none;
  }
  .done {
    border: 0;
    background: var(--accent, #3a3a3a);
    color: var(--text);
  }
</style>
