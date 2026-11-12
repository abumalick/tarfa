<script lang="ts">
  import type { TarfaStore } from '../store.svelte';
  import { isTestBuild } from '../core/build-label';
  import { msg } from '../i18n.svelte';

  let { store }: { store: TarfaStore } = $props();

  let message = $derived(
    store.incomingBuildLabel && isTestBuild(store.incomingBuildLabel)
      ? msg().app.update.testBuild(store.incomingBuildLabel)
      : msg().app.update.available,
  );
</script>

<!-- No dismiss: the bar blocks nothing, so it stays until the update is taken. -->
{#if store.updateReady}
  <div class="bar" role="status">
    <span class="msg">{message}</span>
    <button type="button" class="update" onclick={() => store.applyUpdate()}>{msg().app.update.short}</button>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.4rem 0.4rem 0.75rem;
    border-radius: var(--radius);
    background: #1f2a3a;
    border: 1px solid #345;
    color: #eee;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
  .msg { flex: 1; min-width: 0; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .update {
    flex: 0 0 auto;
    min-height: 36px;
    padding: 0 0.9rem;
    border: 0;
    border-radius: 5px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    touch-action: manipulation;
  }
  .update:active { background: var(--accent-press); }
</style>
