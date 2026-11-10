<script lang="ts">
  // What the 🎤 opens while no dictation preset can run here: the ways to make one usable,
  // each with its own how-to.
  import type { DictationProvider } from '../core/dictation-presets';
  import { CLAUDE_VOICE_DOCS_URL, PROVIDER_NAMES, type SetupOption } from '../core/dictation-setup';
  import { msg } from '../i18n.svelte';
  import HelpPanel from './HelpPanel.svelte';
  import KeyHelp from './KeyHelp.svelte';

  let {
    options,
    onOpenSettings,
    onClose,
  }: { options: SetupOption[]; onOpenSettings: (provider: DictationProvider) => void; onClose: () => void } = $props();

  let helpFor = $state<DictationProvider | null>(null);
  const t = $derived(msg().dictation.setup);
</script>

{#if helpFor}
  <HelpPanel title={msg().dictation.keyHelp.title(PROVIDER_NAMES[helpFor])} testid="key-help" {onClose}>
    <KeyHelp provider={helpFor} />
    {#if options.some((o) => o.kind === 'key' && o.provider === helpFor && o.route === 'page')}
      <button type="button" class="action" onclick={() => helpFor && onOpenSettings(helpFor)}>{t.openSettings}</button>
    {/if}
    <button type="button" class="action" onclick={() => (helpFor = null)}>{t.back}</button>
  </HelpPanel>
{:else}
  <HelpPanel title={t.title} testid="dictation-setup" {onClose}>
    <p>{t.intro}</p>
    <ul>
      {#each options as option (option.kind === 'key' ? option.provider : option.kind)}
        <li>
          {#if option.kind === 'claude'}
            <h3>Claude voice</h3>
            {#if option.state === 'setup'}
              <p>{t.claudeSetup}</p>
              <a class="action" href={CLAUDE_VOICE_DOCS_URL} target="_blank" rel="noopener noreferrer">{t.claudeDocs}</a>
            {:else}
              <p>{option.state === 'asking' ? t.claudeAsking : t.claudeNotClaude}</p>
            {/if}
          {:else}
            {@const provider = option.provider}
            <h3>{PROVIDER_NAMES[provider]}</h3>
            <p>{t[provider]}</p>
            {#if option.route === 'update'}
              <p class="dim">{t.keyUpdateAgent}</p>
            {:else}
              <p class="dim">{option.route === 'page' ? t.keyOnPage : t.keyCliOnly}</p>
              <code>tarfa dictation-key set {provider}</code>
              {#if option.route === 'cli'}<p class="dim">{t.keyUpdateAgent}</p>{/if}
            {/if}
            <div class="pair">
              <button type="button" class="action" aria-label={t.howToGetKeyFor(PROVIDER_NAMES[provider])} onclick={() => (helpFor = provider)}>{t.howToGetKey}</button>
              {#if option.route === 'page'}
                <button type="button" class="action" aria-label={t.openSettingsFor(PROVIDER_NAMES[provider])} onclick={() => onOpenSettings(provider)}>{t.openSettings}</button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </HelpPanel>
{/if}

<style>
  p { margin: 0 0 0.5rem; }
  .dim { color: var(--text-dim); font-size: 0.82rem; }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    padding: 0.6rem 0;
    border-top: 1px solid var(--border, #333);
  }
  h3 {
    margin: 0 0 0.3rem;
    font-size: 0.92rem;
  }
  code {
    display: block;
    margin: 0 0 0.3rem;
    user-select: all;
    overflow-wrap: anywhere;
  }
  .pair {
    display: flex;
    gap: 0.5rem;
  }
  .pair :global(.action) { margin-top: 0.25rem; }
</style>
