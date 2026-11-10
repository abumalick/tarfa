<script lang="ts">
  // How to get a dictation provider's API key: where, roughly what it costs, where it goes.
  import type { DictationProvider } from '../core/dictation-presets';
  import { PROVIDER_LINKS } from '../core/dictation-setup';
  import { msg } from '../i18n.svelte';

  let { provider }: { provider: DictationProvider } = $props();

  const links = $derived(PROVIDER_LINKS[provider]);
</script>

<ol>
  {#each msg().dictation.keyHelp.steps[provider] as step (step)}
    <li>{step}</li>
  {/each}
</ol>
<p>{msg().dictation.keyHelp.cost[provider]}</p>
<p class="dim">{msg().dictation.keyHelp.stored}</p>
<a class="action" href={links.keys} target="_blank" rel="noopener noreferrer">{msg().dictation.keyHelp.openKeys}</a>
<a class="action" href={links.pricing} target="_blank" rel="noopener noreferrer">{msg().dictation.keyHelp.pricing}</a>

<style>
  ol {
    margin: 0 0 0.75rem;
    padding-left: 1.25rem;
  }
  li + li { margin-top: 0.45rem; }
  p { margin: 0 0 0.6rem; }
  .dim { color: var(--text-dim); font-size: 0.82rem; }
</style>
