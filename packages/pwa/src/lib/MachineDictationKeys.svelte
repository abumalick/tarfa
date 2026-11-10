<script lang="ts">
  // A machine's dictation keys, kept on the machine: whether each is set (never its value), and
  // a field that sends a new one to this machine alone.
  import { onMount } from 'svelte';
  import type { TarfaStore } from '../store.svelte';
  import type { DictationProvider } from '../core/dictation-presets';
  import { PROVIDER_NAMES } from '../core/dictation-setup';
  import HelpPanel from './HelpPanel.svelte';
  import KeyHelp from './KeyHelp.svelte';
  import { msg } from '../i18n.svelte';

  let {
    store,
    machine,
    focusKey = null,
  }: {
    store: Pick<TarfaStore, 'statuses' | 'keyRoute' | 'machineHasDictationKey' | 'dictationKeySaves' | 'setMachineDictationKey'>;
    machine: { id: string; name: string };
    focusKey?: DictationProvider | null;
  } = $props();

  const PROVIDERS: DictationProvider[] = ['elevenlabs', 'openrouter'];
  const PLACEHOLDERS: Record<DictationProvider, string> = { elevenlabs: 'sk_…', openrouter: 'sk-or-…' };

  const online = $derived(store.statuses?.[machine.id] === 'online');
  const route = $derived(store.keyRoute(machine.id));
  let drafts = $state<Record<DictationProvider, string>>({ elevenlabs: '', openrouter: '' });
  let inputs = $state<Partial<Record<DictationProvider, HTMLInputElement>>>({});
  let cards = $state<Partial<Record<DictationProvider, HTMLElement>>>({});
  let keyHelp = $state<DictationProvider | null>(null);
  const sent: Record<DictationProvider, string | null> = { elevenlabs: null, openrouter: null };

  onMount(() => {
    if (!focusKey) return;
    cards[focusKey]?.scrollIntoView({ block: 'center' });
    inputs[focusKey]?.focus();
  });

  function label(provider: DictationProvider): string {
    return provider === 'elevenlabs' ? msg().settings.elevenLabsKey : msg().settings.openRouterKey;
  }

  function save(event: SubmitEvent, provider: DictationProvider): void {
    event.preventDefault();
    const key = drafts[provider].trim();
    if (!key) return;
    store.setMachineDictationKey(machine.id, provider, key);
    sent[provider] = key;
  }

  // The typed key stays until the machine stored it, so a refusal or a drop needs no new paste.
  $effect(() => {
    for (const provider of PROVIDERS) {
      const saved = store.dictationKeySaves[machine.id]?.[provider]?.state === 'saved';
      if (saved && sent[provider]) {
        if (drafts[provider].trim() === sent[provider]) drafts[provider] = '';
        sent[provider] = null;
      }
    }
  });

  function outcome(provider: DictationProvider): { text: string; tone: 'dim' | 'ok' | 'diag' } | null {
    const save = store.dictationKeySaves[machine.id]?.[provider];
    if (!save) return null;
    if (save.state === 'pending') return { text: msg().settings.keySaving, tone: 'dim' };
    if (save.state === 'failed') return { text: msg().settings.keySaveFailed(save.error), tone: 'diag' };
    return { text: save.state === 'saved' ? msg().settings.keySaved(machine.name) : msg().settings.keyRemoved(machine.name), tone: 'ok' };
  }
</script>

<p class="group">{msg().settings.machineKeys}</p>
<div class="card" data-testid="machine-keys">
  {#if !online}
    <p class="hint">{msg().settings.machineKeysOffline}</p>
  {:else}
    <p class="hint">{msg().settings.machineKeysHint}</p>
    {#if route === 'page'}
      <p class="hint">{msg().settings.machineKeysOverwrite}</p>
    {:else}
      <p class="notice" data-testid="machine-keys-update">{msg().settings.machineKeysUpdateAgent}</p>
      {#if route === 'cli'}
        <p class="hint">{msg().settings.machineKeysCli}</p>
        {#each PROVIDERS as provider (provider)}<code>tarfa dictation-key set {provider}</code>{/each}
      {/if}
    {/if}
    {#each PROVIDERS as provider (provider)}
      {@const has = store.machineHasDictationKey(machine.id, provider)}
      {@const pending = store.dictationKeySaves[machine.id]?.[provider]?.state === 'pending'}
      {@const said = outcome(provider)}
      <form class="key" data-testid="machine-key-{provider}" onsubmit={(e) => save(e, provider)} bind:this={cards[provider]}>
        <div class="title">
          <label for="machine-key-{provider}">{label(provider)}</label>
          <span class="state" class:set={has}>{has ? msg().settings.machineKeySet : msg().settings.machineKeyNotSet}</span>
        </div>
        {#if provider === 'openrouter'}<p class="hint">{msg().settings.openRouterRecordings}</p>{/if}
        {#if route === 'page'}
          <div class="inline">
            <input
              id="machine-key-{provider}"
              type="password"
              autocomplete="new-password"
              autocapitalize="off"
              spellcheck="false"
              placeholder={has ? '••••••' : PLACEHOLDERS[provider]}
              bind:value={drafts[provider]}
              bind:this={inputs[provider]}
            />
            <button type="submit" class="small" disabled={pending || !drafts[provider].trim()}>{msg().settings.saveKey}</button>
          </div>
          {#if said}
            <p class="hint {said.tone}" role="status">{said.text}</p>
          {/if}
          <div class="actions">
            <button type="button" class="link" aria-label={msg().dictation.setup.howToGetKeyFor(PROVIDER_NAMES[provider])} onclick={() => (keyHelp = provider)}>{msg().settings.howToGetKey}</button>
            {#if has}
              <button type="button" class="link danger" disabled={pending} onclick={() => store.setMachineDictationKey(machine.id, provider, null)}>{msg().settings.removeKey}</button>
            {/if}
          </div>
        {/if}
      </form>
    {/each}
  {/if}
</div>

{#if keyHelp}
  <HelpPanel title={msg().dictation.keyHelp.title(PROVIDER_NAMES[keyHelp])} testid="key-help" onClose={() => (keyHelp = null)}>
    <KeyHelp provider={keyHelp} />
  </HelpPanel>
{/if}

<style>
  .group {
    margin: 1.25rem 0 0.4rem 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .card {
    padding: 0.75rem 0.9rem;
    border-radius: 0.75rem;
    background: var(--surface);
  }
  .key { margin-top: 0.9rem; padding-top: 0.75rem; border-top: 1px solid var(--border); }
  .title { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
  label { font-size: 0.85rem; color: var(--text-dim); }
  .state { font-size: 0.8rem; color: var(--text-dim); }
  .state.set { color: var(--ok); }
  .inline { display: flex; gap: 0.5rem; margin-top: 0.3rem; }
  .inline input { flex: 1; min-width: 0; min-height: 44px; box-sizing: border-box; }
  .small {
    min-height: 44px;
    padding: 0 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-press);
    color: var(--text);
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .small:disabled { opacity: 0.5; }
  .actions { display: flex; justify-content: space-between; align-items: center; margin-top: 0.3rem; }
  .link {
    padding: 0.2rem 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 0.8rem;
    text-decoration: underline;
  }
  .link.danger { color: var(--danger); }
  .link:disabled { opacity: 0.5; }
  .hint { margin: 0.4rem 0 0; font-size: 0.8rem; color: var(--text-dim); }
  .hint.ok { color: var(--ok); }
  .diag { color: var(--danger); }
  .notice { margin: 0.5rem 0 0; font-size: 0.85rem; color: var(--warn); }
  code { display: block; margin-top: 0.3rem; font-size: 0.8rem; user-select: all; overflow-wrap: anywhere; }
  button { touch-action: manipulation; }
</style>
