<script module lang="ts">
  import type { ReadAloudSource } from '../core/read-aloud-voice';

  export type ReadAloudMenuModel = {
    // What a tap reads with now.
    source: ReadAloudSource;
    voiceName: string;
    // Why ElevenLabs cannot read here (no key on the attached machine), or null.
    elevenLabsMissing: string | null;
  };
</script>

<script lang="ts">
  // The 🔊's long-press menu: the phone's voice or ElevenLabs. Positioned fixed against the
  // viewport, since the keyboard bar clips its overflow (as DictationMenu).
  import { READ_ALOUD_BADGES } from '../core/read-aloud-voice';
  import { msg } from '../i18n.svelte';

  let {
    model,
    anchor,
    onSelect,
    onSetKey,
    onChooseVoice,
    onClose,
  }: {
    model: ReadAloudMenuModel;
    anchor: { bottom: number; right: number };
    onSelect: (source: ReadAloudSource) => void;
    onSetKey: () => void;
    onChooseVoice: () => void;
    onClose: () => void;
  } = $props();

  const keepFocus = (e: Event) => e.preventDefault();
  const choose = (source: ReadAloudSource) => {
    onSelect(source);
    onClose();
  };
  const then = (fn: () => void) => () => {
    onClose();
    fn();
  };
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onClose(); }} />

<button type="button" class="backdrop" aria-label={msg().readAloud.closeVoices} onpointerdown={keepFocus} onclick={onClose}></button>
<div class="menu" style="bottom: {anchor.bottom}px; right: {anchor.right}px" data-testid="read-aloud-menu">
  <ul role="listbox" aria-label={msg().readAloud.readWith}>
    <li>
      <button type="button" role="option" aria-selected={model.source === 'device'} onpointerdown={keepFocus} onclick={() => choose('device')}>
        <span class="badge">{READ_ALOUD_BADGES.device}</span>
        <span class="name">{msg().readAloud.deviceVoice}</span>
        {#if model.source === 'device'}<span class="hint">✓</span>{/if}
      </button>
    </li>
    <li>
      <button
        type="button"
        role="option"
        aria-selected={model.source === 'elevenlabs'}
        disabled={!!model.elevenLabsMissing}
        onpointerdown={keepFocus}
        onclick={() => choose('elevenlabs')}
      >
        <span class="badge">{READ_ALOUD_BADGES.elevenlabs}</span>
        <span class="name">{msg().readAloud.elevenLabsVoice(model.voiceName)}</span>
        {#if model.elevenLabsMissing}<span class="hint">{model.elevenLabsMissing}</span>{:else if model.source === 'elevenlabs'}<span class="hint">✓</span>{/if}
      </button>
    </li>
  </ul>
  <p class="cost">{msg().readAloud.cost}</p>
  {#if model.elevenLabsMissing}
    <button type="button" class="action" onpointerdown={keepFocus} onclick={then(onSetKey)}>{msg().readAloud.setKey}</button>
  {/if}
  <button type="button" class="action" onpointerdown={keepFocus} onclick={then(onChooseVoice)}>{msg().readAloud.chooseVoice}</button>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    border: 0;
    background: transparent;
    padding: 0;
  }
  .menu {
    position: fixed;
    z-index: 21;
    margin: 0;
    padding: 0.25rem;
    min-width: 12rem;
    max-width: min(20rem, calc(100vw - 8px));
    max-height: 60vh;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  ul { margin: 0; padding: 0; list-style: none; }
  .menu button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.6rem;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--text);
    font: 400 0.95rem system-ui, sans-serif;
    text-align: left;
    touch-action: manipulation;
  }
  .menu button:active { background: var(--surface-press); }
  .menu button:disabled { opacity: 0.5; }
  .menu button[aria-selected='true'] { background: var(--surface-press); }
  .menu .action { border-top: 1px solid var(--border); border-radius: 0; color: var(--text-dim, var(--text)); }
  .badge {
    min-width: 2rem;
    font: 600 0.8rem ui-monospace, monospace;
    text-align: center;
  }
  .name { flex: 1; }
  .hint { font-size: 0.8rem; color: var(--text-dim, var(--text)); }
  .cost {
    margin: 0.25rem 0.6rem 0.4rem;
    font-size: 0.78rem;
    color: var(--text-dim, var(--text));
  }
</style>
