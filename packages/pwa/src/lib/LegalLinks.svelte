<script lang="ts">
  import { LEGAL_PATHS, SOURCE_URL } from '../core/legal-pages';
  import { msg } from '../i18n.svelte';

  let { accept = false }: { accept?: boolean } = $props();
</script>

{#if accept}
  <p class="legal" data-testid="legal-accept">
    {msg().legal.acceptBefore}<a href={LEGAL_PATHS.terms}>{msg().legal.terms}</a>{msg().legal.acceptAnd}<a
      href={LEGAL_PATHS.privacy}>{msg().legal.privacy}</a
    >{msg().legal.acceptAfter}
  </p>
{:else}
  <p class="legal" data-testid="legal-links">
    <a href={LEGAL_PATHS.terms}>{msg().legal.terms}</a> · <a href={LEGAL_PATHS.privacy}>{msg().legal.privacy}</a> ·
    <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{msg().legal.source}</a>
  </p>
{/if}

<style>
  .legal { margin: 1.25rem 0 0.5rem; text-align: center; font-size: 0.8rem; color: var(--text-dim); }
  a { color: inherit; }
</style>
