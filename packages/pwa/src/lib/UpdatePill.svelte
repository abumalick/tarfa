<script lang="ts">
  import type { TarfaStore } from '../store.svelte';
  import { isTestBuild } from '../core/build-label';
  import { msg } from '../i18n.svelte';

  let { store }: { store: TarfaStore } = $props();

  let testLabel = $derived(
    store.incomingBuildLabel && isTestBuild(store.incomingBuildLabel) ? store.incomingBuildLabel : null,
  );
  let message = $derived(testLabel ? msg().app.update.testBuild(testLabel) : msg().app.update.available);
  let label = $derived(testLabel ?? msg().app.update.short);
</script>

{#if store.updateReady}
  <button
    type="button"
    class="update"
    title={message}
    aria-label="{label} · {message}"
    onclick={() => store.applyUpdate()}
  >
    <span class="icon" aria-hidden="true">↻</span>
    <span class="text">{label}</span>
  </button>
{/if}

<style>
  /* Sits in a header, never over one: the prompt stays until it is taken, so it must block nothing. */
  .update {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    height: 28px;
    padding: 0 0.6rem;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 0.8rem;
    font-weight: 600;
    touch-action: manipulation;
  }
  .update:active { background: var(--accent-press); }
  .icon { flex: 0 0 auto; }
  .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
