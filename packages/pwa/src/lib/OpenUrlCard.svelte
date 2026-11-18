<script lang="ts">
  import { msg } from '../i18n.svelte';

  let { url, onOpen, onDismiss }: { url: string; onOpen: () => void; onDismiss: () => void } = $props();

  // How long Open stays disabled after the card appears or its page changes: any program in the
  // workspace can ask, and a page swapped in just as a finger lands must not be what it opens.
  const ARM_MS = 600;

  // The host in full, as the URL parser gives it (punycode, never decoded to look-alike letters);
  // only the rest is shortened.
  const parts = $derived.by(() => {
    const parsed = new URL(url);
    return { host: parsed.host, rest: `${parsed.pathname}${parsed.search}${parsed.hash}` };
  });

  let armed = $state(false);
  $effect(() => {
    void url;
    armed = false;
    const timer = setTimeout(() => (armed = true), ARM_MS);
    return () => clearTimeout(timer);
  });

  const keepFocus = (e: Event) => e.preventDefault();
</script>

<div class="card" role="alertdialog" aria-label={msg().app.openUrl.label} data-testid="open-url-card">
  <div class="text">
    <span class="label">🌐 {msg().app.openUrl.label}</span>
    <span class="host" data-testid="open-url-host">{parts.host}</span>
    {#if parts.rest !== '/'}<span class="rest">{parts.rest}</span>{/if}
  </div>
  <div class="actions">
    <button type="button" class="dismiss" aria-label={msg().app.dismiss} onpointerdown={keepFocus} onclick={onDismiss}>✕</button>
    <button type="button" class="open" disabled={!armed} onpointerdown={keepFocus} onclick={onOpen}>{msg().app.openUrl.open}</button>
  </div>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    background: #16324f;
    border: 1px solid #3b82f6;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
    color: #eee;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .label { font-weight: 600; font-size: 0.95rem; }
  .host {
    font-family: monospace;
    font-size: 1rem;
    color: #fff;
    overflow-wrap: anywhere;
  }
  .rest {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #aab;
    font-family: monospace;
    font-size: 0.8rem;
  }
  .actions { display: flex; justify-content: flex-end; gap: 0.6rem; }
  button {
    min-height: 44px;
    padding: 0 1rem;
    border: 0;
    border-radius: 6px;
    font-size: 1rem;
    touch-action: manipulation;
  }
  .open { background: #3b82f6; color: #fff; min-width: 6rem; font-weight: 600; }
  .open:disabled { opacity: 0.5; }
  .dismiss { background: transparent; color: #ddd; border: 1px solid #555; }
</style>
