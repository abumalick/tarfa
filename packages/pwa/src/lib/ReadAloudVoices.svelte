<script lang="ts">
  // Settings → Read aloud: which voice a 🔊 tap reads with, and the ElevenLabs voice. The voices
  // are listed with a machine's key on request (listing and samples cost no credit).
  import { onDestroy, onMount } from 'svelte';
  import type { TarfaStore } from '../store.svelte';
  import { DEFAULT_ELEVENLABS_VOICE, type ReadAloudSource } from '../core/read-aloud-voice';
  import { SynthesisError, type ListedVoice } from '../core/ports/text-to-speech';
  import { msg } from '../i18n.svelte';
  import { silence } from '../adapters/html-audio';

  let { store }: { store: TarfaStore } = $props();

  let section = $state<HTMLElement | null>(null);
  let voices = $state<ListedVoice[] | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let sampleOf = $state<string | null>(null);
  let sampleError = $state(false);
  // One element for every sample, unlocked in the tap (iOS plays nothing started after it).
  let sampleAudio: HTMLAudioElement | null = null;
  let sampleUrl: string | null = null;
  let sampleAbort: AbortController | null = null;
  let listing: AbortController | null = null;

  const chosen = $derived(store.readAloudVoice.voice ?? DEFAULT_ELEVENLABS_VOICE);
  const catalogMachine = $derived(store.elevenLabsCatalogMachine);

  onMount(() => {
    if (!store.readAloudFocus) return;
    store.readAloudFocus = false;
    section?.scrollIntoView({ block: 'start' });
  });
  onDestroy(() => {
    listing?.abort();
    stopSample();
  });

  async function showVoices() {
    listing?.abort();
    listing = new AbortController();
    loading = true;
    error = null;
    try {
      voices = await store.listElevenLabsVoices(listing.signal);
    } catch (e) {
      const kind = e instanceof SynthesisError ? e.kind : 'network';
      const reason = kind === 'permission' ? msg().readAloud.voicesPermission : kind === 'too-long' ? msg().readAloud.failures.http : msg().readAloud.failures[kind];
      error = msg().readAloud.voicesFailed(reason);
    } finally {
      loading = false;
    }
  }

  function pick(voice: ListedVoice | null) {
    store.setElevenLabsVoice(voice && voice.id !== DEFAULT_ELEVENLABS_VOICE.id ? { id: voice.id, name: voice.name } : null);
  }

  function setSampleSource(clip: Blob) {
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    sampleUrl = URL.createObjectURL(clip);
    sampleAudio!.src = sampleUrl;
  }

  function stopSample() {
    if (!sampleOf) return;
    sampleAbort?.abort();
    sampleAbort = null;
    sampleAudio?.pause();
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    sampleUrl = null;
    sampleOf = null;
  }

  async function playSample(voice: ListedVoice) {
    const same = sampleOf === voice.id;
    stopSample();
    if (same || !voice.previewUrl) return;
    sampleOf = voice.id;
    sampleError = false;
    const abort = new AbortController();
    sampleAbort = abort;
    if (!sampleAudio) {
      sampleAudio = new Audio();
      // The silent unlock ends too, while the sample is still being fetched (`sampleAbort` set).
      sampleAudio.onended = () => {
        if (!sampleAbort) stopSample();
      };
    }
    // Inside the tap, before anything is awaited: what lets iOS play the sample once it arrives.
    setSampleSource(silence());
    sampleAudio.play()?.catch(() => {});
    try {
      const clip = await store.previewElevenLabsVoice(voice.previewUrl, abort.signal);
      if (abort.signal.aborted) return;
      sampleAbort = null;
      setSampleSource(clip);
      await sampleAudio.play();
    } catch (e) {
      if (sampleOf === voice.id && !abort.signal.aborted && (e as { name?: string })?.name !== 'AbortError') {
        stopSample();
        sampleError = true;
      }
    }
  }

  const sources: ReadAloudSource[] = ['device', 'elevenlabs'];
</script>

<p class="group" bind:this={section} id="read-aloud-settings">{msg().readAloud.settingsTitle}</p>
<div class="card">
  <p class="hint">{msg().readAloud.settingsHint}</p>
  <div class="choices" role="radiogroup" aria-label={msg().readAloud.readWith}>
    {#each sources as source (source)}
      <label class="choice">
        <input type="radio" name="read-aloud-source" checked={store.readAloudVoice.source === source} onchange={() => store.setReadAloudSource(source)} />
        <span>{source === 'device' ? msg().readAloud.deviceVoice : msg().readAloud.elevenLabsVoice(chosen.name)}</span>
      </label>
    {/each}
  </div>
  <p class="hint">{msg().readAloud.cost}</p>
</div>

<div class="card" data-testid="elevenlabs-voices">
  <span class="name">{msg().readAloud.voiceTitle}</span>
  <p class="hint">{msg().readAloud.keyAccess}</p>
  {#if !catalogMachine}
    <p class="hint">{msg().readAloud.noKeyAnywhere}</p>
  {:else if !voices}
    <button type="button" class="wide" disabled={loading} onclick={showVoices}>{loading ? msg().readAloud.loadingVoices : msg().readAloud.showVoices}</button>
  {:else}
    <p class="hint">{msg().readAloud.voicesFrom(catalogMachine)}</p>
  {/if}
  {#if error}<p class="hint error" role="alert">{error}</p>{/if}
  {#if sampleError}<p class="hint error" role="alert">{msg().readAloud.sampleFailed}</p>{/if}
  {#if voices}
    {#if voices.length === 0}<p class="hint">{msg().readAloud.noVoices}</p>{/if}
    <ul class="voices" role="listbox" aria-label={msg().readAloud.voiceTitle}>
      {#each voices as voice (voice.id)}
        <li>
          <button type="button" class="voice" role="option" aria-selected={voice.id === chosen.id} onclick={() => pick(voice)}>
            <span class="text">
              <span class="title">{voice.id === DEFAULT_ELEVENLABS_VOICE.id ? msg().readAloud.defaultVoice(voice.name) : voice.name}</span>
              {#if voice.description}<span class="sub">{voice.description}</span>{/if}
            </span>
            {#if voice.id === chosen.id}<span aria-hidden="true">✓</span>{/if}
          </button>
          {#if voice.previewUrl}
            <button
              type="button"
              class="sample"
              aria-label={sampleOf === voice.id ? msg().readAloud.stopSample : msg().readAloud.playSample(voice.name)}
              onclick={() => playSample(voice)}>{sampleOf === voice.id ? '■' : '▶'}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .group {
    margin: 1.4rem 0 0.4rem 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    scroll-margin-top: 1rem;
  }
  .card {
    margin: 0 0 0.6rem;
    padding: 0.75rem 0.9rem;
    border-radius: 0.75rem;
    background: var(--surface);
  }
  .name { font-weight: 600; font-size: 0.95rem; }
  .hint { margin: 0.4rem 0 0; font-size: 0.8rem; color: var(--text-dim); }
  .error { color: var(--danger, #e5484d); }
  .choices { display: flex; flex-direction: column; gap: 0.4rem; margin: 0.5rem 0; }
  .choice { display: flex; align-items: center; gap: 0.5rem; min-height: 2.25rem; }
  .wide {
    display: block;
    width: 100%;
    min-height: 44px;
    margin-top: 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-press);
    color: var(--text);
    font-size: 0.85rem;
  }
  .voices { list-style: none; margin: 0.5rem 0 0; padding: 0; max-height: 50vh; overflow-y: auto; }
  .voices li { display: flex; align-items: stretch; gap: 0.4rem; border-top: 1px solid var(--border); }
  .voice {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.25rem;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    font: inherit;
  }
  .voice[aria-selected='true'] { color: var(--accent); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 0.78rem; color: var(--text-dim); }
  .sample {
    flex: none;
    width: 2.5rem;
    margin: 0.3rem 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-press);
    color: var(--text);
  }
</style>
