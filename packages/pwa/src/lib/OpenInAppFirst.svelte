<script lang="ts">
  import type { TarfaStore } from '../store.svelte';
  import { msg } from '../i18n.svelte';

  let {
    store,
    copy = (text: string) => navigator.clipboard.writeText(text),
  }: { store: Pick<TarfaStore, 'heldWorkspaceLink' | 'openHeldLinkHere'>; copy?: (text: string) => Promise<void> } = $props();

  let copied = $state<'no' | 'yes' | 'failed'>('no');

  async function copyLink(): Promise<void> {
    try {
      await copy(store.heldWorkspaceLink!);
      copied = 'yes';
    } catch {
      copied = 'failed';
    }
  }
</script>

{#if store.heldWorkspaceLink}
  <section class="install" data-testid="open-in-app-first">
    <h1>{msg().app.openInAppFirst.title}</h1>
    <p class="lead">{msg().app.openInAppFirst.lead}</p>
    <ol>
      <li>
        <button type="button" class="cta" onclick={copyLink}>
          {copied === 'yes' ? msg().app.openInAppFirst.copied : msg().app.openInAppFirst.copyLink}
        </button>
        {#if copied === 'failed'}
          <label class="manual">
            {msg().app.openInAppFirst.copyByHand}
            <textarea readonly rows="3" onfocus={(e) => e.currentTarget.select()}>{store.heldWorkspaceLink}</textarea>
          </label>
        {/if}
      </li>
      <li>{msg().app.openInAppFirst.openTarfa}<b>{msg().app.openInAppFirst.addMachine}</b>{msg().app.openInAppFirst.then}<b>{msg().app.openInAppFirst.paste}</b>{msg().app.openInAppFirst.pasteNote}</li>
    </ol>
    <button type="button" class="link" onclick={() => store.openHeldLinkHere()}>{msg().app.openInAppFirst.openHere}</button>
  </section>
{/if}

<style>
  .install { max-width: 32rem; margin: 0 auto; padding: 1.5rem 1rem calc(1.5rem + env(safe-area-inset-bottom)); }
  h1 { margin: 0; font-size: 1.25rem; line-height: 1.3; }
  .lead { margin: 0.5rem 0 1.25rem; color: var(--text-dim); }
  ol { margin: 0; padding-left: 1.4rem; display: grid; gap: 0.9rem; }
  li { line-height: 1.45; }
  .cta {
    min-height: 44px;
    padding: 0 1.1rem;
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 0.95rem;
    font-weight: 600;
    touch-action: manipulation;
  }
  .cta:active { background: var(--accent-press); }
  .manual { display: block; margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-dim); }
  textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0.25rem;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: 16px;
    word-break: break-all;
  }
  .link {
    margin-top: 1.5rem;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-dim);
    font-size: 0.9rem;
    text-decoration: underline;
    touch-action: manipulation;
  }
</style>
