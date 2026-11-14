# Dictation, Claude voice and read-aloud

The 🎤 presets and their keys, Claude voice on Linux, and 🔊 read-aloud with the phone's voice or ElevenLabs. Each bullet records a decision; read it before changing that code.

- **Dictation presets are on-device config; the keys live only on the machines.** The 🎤 records in the PWA
  and sends the audio straight from the phone, either to ElevenLabs Scribe or to an OpenRouter
  model that hears it and follows the preset's prompt (`adapters/openrouter-transcriber.ts`);
  `PresetTranscriber` picks one per dictation from the current preset. A long press (500 ms,
  `HOLD_MS`) on the mic opens the presets; its badge shows the current one; Settings edits them.
  **A provider key is the attached workspace's machine's, and nothing else** (`store.dictationKey`,
  `core/dictation-key-source.ts`; the transcribers and `presetKeys` read only that). It is stored in
  `~/.tarfa/dictation-keys.json` (0600, in the startup private-file check, and mode-checked again on
  every read since the file may appear later; a malformed file reports a fixed message, since
  `JSON.parse`'s quotes the text), by `tarfa dictation-key set <provider>` (stdin or an echo-off
  prompt, never argv) or by a paired phone from the machine's page in Settings
  (`MachineDictationKeys.svelte`): `setDictationKey { id, provider, key | null }`, answered
  `dictationKeySet { id, provider, ok, error? }`; a save is settled only by its own `id` (a late answer
  to one that timed out must not settle the next), and any `ok` makes the phone ask `getDictationKeys`
  again. Other phones on that machine get the change at their next connect. Both
  paths run `changeDictationKey` (`application/dictation-keys.ts`: `checkKey` trims and refuses
  whitespace inside or over 512 characters, then `keyFormatError` refuses a key not shaped like
  its provider's, naming the shape and the other provider when it looks like that one's) and write under `withFileLock`, since the CLI and the agent
  are different processes. The agent advertises `AGENT_FEATURES.dictationKeys` (it hands keys out) and
  `AGENT_FEATURES.setDictationKey` (it takes one), and the PWA sends `getDictationKeys` on each
  accepted `authResult`; the handler answers both only behind `authed`, and a refusal or a failed
  write is a `dictationKeySet` with `checkKey`'s fixed wording or the file's problem line (its path,
  never its text), never the generic `error`. **The shape check (`dictationKeyProblem`,
  contracts) runs on both sides and only when a key is set:** the machine page refuses before
  sending, in the phone's language, since released agents lack the check; the agent refuses for
  the CLI and older PWAs; a stored key is never re-checked on read, so one stored before the
  check keeps working. Its lengths are minimums, not exact (ElevenLabs `sk_` + 48 hex today, or 32
  bare hex from before the prefix; OpenRouter `sk-or-v1-` + 64 hex): a valid key wrongly refused
  has no way round. Things not to
  "simplify": **a request, not a field on `authResult.agent`** (a malformed field there would
  wipe `features` too, and the transport layer should read no secret file); **held in memory per
  machine, never in localStorage**, dropped when the machine goes offline, is removed, or stops
  naming the feature, so a lost phone holds none at rest; the build deletes the
  `tarfa.elevenLabsApiKey`/`tarfa.openRouterApiKey` an older build typed into the device
  (`SettingsStore.forgetDeviceDictationKeys`, at every `start`), so agents' keys must be set before
  such a PWA ships; **the machine page shows only whether a key is set** (`••••••`), never binds the
  held value to the field and clears the field after sending; **its key forms are apart from the
  page's save form**, which closes the page and rewrites the entry, reconnecting the session the key
  rides on; **a key saved on a page goes to that machine alone** (machines on one phone may have
  different operators, and each pays for its own workspaces' dictation); **any enrolled phone of a
  machine can overwrite or remove its keys**, accepted since it can already run anything in that
  machine's terminals; and **no cross-machine fallback**: with no workspace open, `presetKeys`
  counts a key some machine holds (as Claude voice does), and Settings names the machines that hold
  each key. A page whose agent lacks `setDictationKey` asks for an agent update (with the
  `tarfa dictation-key` lines when it still hands keys out). When nothing can run, the mic's setup
  gives each keyless provider its route (`setupOptions`' `KeyRoute`: `page` opens that machine's page
  at the field, beside the CLI line; `cli` the CLI line and the update note; `update` the note). A
  revoked phone may still hold a key it fetched: the remedy is rotating it at the
  provider. **Only a preset whose provider has a key can be used**: the current
  preset is the chosen one if it has its key, else the first that does (`currentPreset`), a
  keyless one is disabled in the menu. **With no usable preset at all the mic stays** (no badge,
  "Set up dictation"): a tap opens `DictationSetup`, whose entries come from the user's own list
  (`core/dictation-setup.ts`, so it never offers a key no preset uses): Claude voice, worded "if
  this machine runs Linux" with the setup guide on `main` when the agent says `claudeVoice: false`
  (macOS, no loopback and an old agent look alike) or with the reason when it says true, and each
  missing key with its how-to (`KeyHelp`: key page, a hedged cost with the pricing link, where to
  paste) and a jump to the attached machine's page (`openDictationKeySettings`, which sets
  `dictationKeyFocus` to `{ machineId, provider }`). The machine page has the same how-to beside each
  key field. The long press still opens the menu. A bar with no setup handler
  (the browser view) has no mic.
  Things not to "simplify":
  - **The defaults live in code until the user edits the list** (`DEFAULT_PRESETS`, nothing
    seeded into `tarfa.dictationPresets`), so an update can replace a model id OpenRouter has
    retired for everyone who never customised. Nothing personal ships: the default prompt
    cleans up in the language spoken, and a translation preset is the user's own. **Claude
    voice is the first default, falling back to Scribe v3, then Scribe v2:** `currentPreset` skips it wherever it
    cannot run, so one list serves every machine. A list the user edited is kept as it is.
  - **A Scribe preset names its model; no `model` is v2** (stored lists predate v3). A v3 preset
    may list languages, sent as `language_code` (the first) plus `secondary_language_codes`.
    Measured: v2 answers 400 to those fields, secondary codes without a main one fail with a 500,
    and the main one steers the transcript (with `en` first a French word came back translated),
    so the editor's hint says to put the main language first. **Never send `numbers_format` to
    v3:** any value, `digits` included, makes it ignore `no_verbatim`, so "uh", "um" and stutters
    come back; without it v3 drops them and still writes numbers as digits (English, French,
    Arabic, with or without languages).
  - **An OpenRouter reply is typed as one line.** A newline reaching the pty submits the line
    (a shell would run a half-dictated command); a bracketed paste is no better, since Claude
    Code folds it into an unreadable `[Pasted text]`.
  - **Each attempt gets 15 s + 10 s per MB of audio, then one retry** (hang, network error,
    429/5xx, or a 200 carrying an upstream `error`). Measured: Gemini Flash answers in ~2 s
    when routed through Vertex and in ~13 s through AI Studio, which OpenRouter picks about one
    time in three, with rare minutes-long hangs. The `google-vertex` provider order is
    best-effort tuning, not a guarantee; forbidding fallbacks produced the worst hang.
  - **The long press ends the key's press itself** (`cancel()` in the hold timer): the finger
    lifts over the menu's backdrop, so the mic never sees its own `pointerup`. While recording
    the hold is not armed, so a slow press still stops the recording.
- **A Claude voice preset (Linux) streams the dictation to Claude Code's own `/voice`.**
  While the user speaks, the phone sends 16 kHz PCM from Web Audio (`adapters/web-audio-pcm.ts`)
  as `voiceStart` / `voiceChunk` / `voiceEnd`, each naming the dictation's `id`; the agent (`application/claude-voice.ts`)
  holds space in the attached workspace from `voiceStart` (a space every 30 ms: a terminal has
  no key release, so Claude reads a held key from its repeats), plays the audio into an ALSA
  loopback with `aplay` as it arrives, releases after the end, and answers `voiceDone`. Claude
  writes the transcript into the prompt, unsent; the phone types nothing. Things not to
  "simplify":
  - **Playback starts `LEAD_MS` (1 s) after the hold, with the audio that arrived meanwhile.**
    Claude warms up for about a second before it records, so starting at once loses the first
    words; the cost is a second of lag, and the text lands about 1.5 s after the user stops.
  - **PCM, not MediaRecorder.** Safari's MP4 has its index at the end and cannot be decoded
    until it is finished, which is what forced record-then-send (and a second, real-time
    playback of the whole clip). An underrun from late chunks is harmless: `aplay` plays on and
    Claude still hears the speech (measured with a 1.5 s stall).
  - **The hold always ends:** no chunk for `IDLE_MS`, `MAX_MS` in all, a player still going
    `DRAIN_MS` after the end or dying mid-stream, and losing the attachment (detach, another
    workspace opened, a takeover, the phone disconnecting; `cancelVoice`) all end it. A failure
    can arrive while the user still talks, and stops the recording at once (`SpeechToText.abort`);
    the phone fails its dictation itself when the machine goes offline, since no reply can come.
  - **An aborted player is killed with SIGKILL, never SIGTERM.** aplay's SIGTERM handler only
    flags the abort and goes back to reading its still-open stdin, so it kept the loopback open
    and every later dictation failed "Device or resource busy" until it was killed by hand.
  - **The phone keeps its screen on while it records** (`WakeLockRecorder`, the Screen Wake
    Lock): a phone that sleeps stops the microphone mid-sentence. A refused lock is ignored.
  - **Every reply is matched by the dictation's `id`,** never the workspace: a superseded
    dictation's late "Superseded" reply would otherwise stop the new one on the same workspace.
  - **Refused before anything is pressed** unless voice is explicitly on in hold mode in
    `~/.claude/settings.json` (voice is off until `/voice`, and in tap mode each space would
    toggle recording and submit), and unless the workspace's command runs `claude` (anywhere
    else the spaces are typed). The phone applies the same `runsClaude` (contracts) first: in a
    Codex or shell workspace the preset is disabled ("Claude Code only") and the mic falls back to
    another preset, through the `claude` flag of `PresetKeys`. A shell where `claude` was started
    by hand does not count.
  - **Not while Claude shows a question or a permission menu.** There space is a menu key, not
    /voice: measured, the held spaces were typed into an AskUserQuestion's text answer. The agent
    refuses when the pane's OSC 7501 state is `blocked` (read live at `voiceStart`), stops a running
    dictation when its pane turns `blocked` (at the next program-status poll, `stopVoiceIn`), and marks
    such a workspace `asking`, pushing it from the program-status poll whenever it flips, since the
    status alone does not change (needs-feedback either way). The phone then disables the preset
    ("question open"), so the mic falls back for answering by voice, and comes back once the
    question closes. The fallback is the preset's own `fallbackId` (its editor's Fallback
    field), else the first preset that can run (`currentPreset`). Needs the patched tmux; a stock tmux reports neither.
  - **One dictation's recorder and transcriber use the preset it started with**
    (`PresetRecorder.startedWith`): picking another mid-recording would hand a stream to a
    clip transcriber.
  - **Each agent says whether Claude voice can work on its machine** (`claudeVoice` on its
    `workspaces` reply: Linux with the loopback card in `/proc/asound/cards`). Elsewhere the
    phone marks the preset "not on this machine" (`ClaudeVoiceHere` `unavailable`) and the mic
    uses the fallback, as during a question. **An agent that omits the field counts as
    unavailable:** an older agent either predates Claude voice (it would drop the messages
    silently) or just needs a restart. Voice being off or in tap mode stays a refusal at
    `voiceStart`: it changes without a reconnect, and the refusal says how to fix it.
  - **Users sharing a machine share one loopback card, so each pins its own subdevice.** ALSA
    pairs playback subdevice *n* with capture *n* and hands each open the lowest free one, so two
    unpinned users dictating at once cross over (measured with `arecord`/`aplay`: a recorder
    heard the tone another player sent; pinned subdevices kept apart). Each user's `~/.asoundrc` names `Loopback,1,<n>` and its `TARFA_VOICE_DEVICE` the
    matching `plughw:Loopback,0,<n>` (default `plughw:Loopback,0`, right for one user only).
  - **A recording can be thrown away** (the controls above the mic while it records,
    `lib/DictationControls.svelte`: a timer, ✕ to cancel where the dictation can be, and ■ to stop
    and transcribe, the mic's own second tap made explicit): a clip preset discards its recording (`AudioRecorder.discard`)
    and sends nothing; Claude voice sends `voiceCancel`, offered only to an agent naming the
    `voiceCancel` feature (an older one drops it, and Claude would type what it heard). The agent
    kills the player, keeps holding space until the pane shows `listening…` on the line above
    the prompt box (`claudeVoiceListening`, polled up to `CANCEL_WAIT_MS`), then stops the hold
    and writes **Ctrl+C**, which Claude Code takes as "discard the recording", keeping what was
    typed before. Measured on 2.1.322: **an Esc written through the attached client never
    cancelled** (8/8, unlike `tmux send-keys Escape`), Ctrl+C did (24/24, from the moment the
    indicator shows, ~145 ms into the hold, and mid-turn without interrupting it); before the
    indicator Claude is not recording yet, and the same Ctrl+C clears the prompt or interrupts the
    turn. So with no indicator nothing is pressed and the dictation is released as is: a Claude
    that words its indicator differently turns cancel into stop, never into a stray Ctrl+C, and
    the phone shows the agent's "not cancelled" answer (`discardedVoiceId`). A cancelling
    dictation stays the handler's current one until it settles, so a newer dictation, a question
    opening or the phone leaving still stops it.
  One dictation at a time per agent. The PWA gives up `VOICE_REPLY_MS` after
  the end, since an older agent's `bad_message` is silent. Set up by hand per machine
  (`docs/SETUP-MACHINE.md`, step 11): `alsa-utils`, the user in `audio`, `snd-aloop` loaded at
  boot, a `~/.asoundrc` whose default capture is `plughw:Loopback,1` (Claude records from the
  default device), and `/voice` on in hold mode.
- **🔊 reads Claude's last reply with the phone's own voice (free), or with ElevenLabs.** The agent
  keeps each workspace's `last_assistant_message` from the `Stop`/`StopFailure` payload in memory
  (`application/last-replies.ts`, capped at 64 000 characters, dropped with the workspace's state,
  never logged), and answers `lastReply` with it, or `null`. Claude workspaces only (`runsClaude`).
  The hooks route joins a body's chunks before decoding: decoding each chunk alone broke any
  multibyte character split between two, which status never noticed and a voice reads out.
  Things not to "simplify":
  - **The PWA shows a control only for what the agent says it answers.** Every accepted
    `authResult` names `agent.features` (`AGENT_FEATURES` in contracts); the 🔊 key needs
    `lastReply` there and a `speechSynthesis` in the browser. A version compare cannot do this (a
    worktree agent carries a release's version), and an older agent omits the list, so a PWA
    deployed ahead of its agents shows nothing new. A new agent-side capability adds a feature
    name the same way.
  - **The player never uses the voice's pause/resume** (unreliable on iOS and Android) **nor its
    boundary events** (iOS fires none). `core/read-aloud.ts` queues one utterance per sentence
    (`core/speakable.ts`, markdown syntax dropped, content kept), pausing cancels and remembers
    the sentence, and ±10 s jumps by sentences at an estimated 15 characters a second. A
    generation token ignores the `end` events a cancel fires on what it dropped.
  - **On iOS the tap speaks a silent utterance first** (`SpeechPort.unlock`): the reply arrives
    after the gesture is over, and WebKit lets a page speak only once it spoke inside one.
    Elsewhere it does not: Chrome drops a `speak()` that follows a `cancel()` too closely, so the
    adapter cancels only what is speaking and holds a speak back 150 ms after a cancel.
  - **Android's Chrome speaks only through Google's speech engine.** Measured on a Galaxy Tab
    with Samsung's engine as the default and Google's absent: no voices, and an utterance that
    never starts; with "Speech Services by Google" installed it speaks. The first utterance after
    a browser start waits for the engine to start (4.2 s), so the player gives a silent voice
    12 s (`START_TIMEOUT_MS`) before it says so. That notice (and a voice error) offers "How
    to fix", whose steps follow the device (`lib/voice-platform.ts`: iOS, Android Chromium
    browsers, Android Firefox, which uses the phone's own engine, desktop).
    **A voice answering `synthesis-failed` on Android Chrome leads with restarting Chrome**, the
    install steps below it (`VoiceHelp`'s `trouble`: `failed` for that code alone, `silent` for any other): measured on a Galaxy
    Tab, an update of Google's engine while Chrome runs leaves Chrome unbound from it for good
    (`synthesis-failed` with every voice still listed, logcat `not bound to TTS engine`), and only
    a Force stop of Chrome rebinds it; swiping the WebAPK away does not stop Chrome.
  - **The speed (0.75–2×, `tarfa.readAloudRate`) is the utterance's `rate`;** positions, the
    duration and the ±10 s skips are in seconds of the voice at 1× (as a video player counts),
    so a speed change never moves the clock; it restarts the sentence under way. Inside a
    sentence the clock runs on wall time × speed from the utterance's `start`, held at the
    sentence's estimated end, and a pause shows the sentence start it will resume from.
  - **The voice follows the reply's language, not the app's** (`core/reply-language.ts`: Arabic
    by its script, English or French by their commonest words, else the app's language): a French
    voice reading English is barely understandable.
  - The player and its notice float over the terminal's bottom (`.term` is the positioned box),
    never inside the keyboard bar, which clips. Leaving the workspace stops the voice; the machine
    dropping only cancels a request still waiting, since a reading under way needs no connection.
    When both show (an ElevenLabs failure while the phone reads on), the notice sits above the player.
  - **A long press on 🔊 picks the voice** (`ReadAloudMenu`, the mic's `HOLD_MS` and fixed
    positioning): "Device voice" or "ElevenLabs · <voice>", remembered as `tarfa.readAloudVoice`
    (`core/read-aloud-voice.ts`); the badge shows what a tap will use (`readAloudSource`).
    **ElevenLabs reads only with the attached machine's key** (`store.dictationKey('elevenlabs')`,
    the dictation rule): without one the entry is disabled with the reason and "Add an ElevenLabs
    key" opens that machine's page, and a tap reads with the phone. The menu and Settings say once
    that ElevenLabs charges credits per character. **The 🔊 still acts on its `click`**, the event
    its iOS unlock was proven on: `press` arms a `hold` with no `fire`, and a flag swallows the
    click after a hold (reset on the next `pointerdown`, since iOS may send no click).
  - **ElevenLabs synthesises the whole reply in one request and plays it as one clip**
    (`core/audio-read-aloud.ts`, `adapters/elevenlabs-speech.ts`, `adapters/html-audio.ts`): Flash
    v2.5 (half Multilingual v2's credits, and it takes `language_code`, which Multilingual v2 ignores,
    so the voice follows `replyLanguage`), MP3, the speakable text (no code fences billed). Pause,
    ±10 s, speed (`playbackRate`, re-set after each load, since a load resets it) and the clock are
    the element's own and exact. By sentence would start sooner and cost less when the user stops
    early, but brings back the estimated clock, can fail mid-reading, and needs the key after the
    machine drops (a reading under way must not, and the key is dropped with the connection): the
    key is read once, when the reply arrives. Measured: 500 characters answer in 1.9 s, 3,000 in
    3.7 s; the player shows a loading state meanwhile. **Over `ELEVENLABS_MAX_CHARS` (10,000) the
    tap reads with the phone instead**, which also bounds what one tap spends. A late clip after a
    stop, a back or a second tap is dropped by a generation token, and the request aborted.
  - **Any ElevenLabs failure falls back to the phone's voice from the start, with a notice saying
    why** (no credits arrives as a 401 with a quota status, `adapters/elevenlabs-errors.ts`, shared
    with Scribe; a key without Text to Speech access says so), never silently, and never naming the
    key. A chosen voice the account lacks (a voice picked from another machine's account) reads with
    the default, George (premade, verified for English, French and Arabic), and says so.
  - **The tap unlocks both voices**: `SpeechPort.unlock` (the fallback speaks later) and a silent WAV
    played on the one reused `<audio>` element, which iOS then lets play the clip that arrives after
    the gesture. A blob, never a `data:` URL, which the CSP's `media-src 'self' blob:` refuses.
  - **Settings → Read aloud picks the ElevenLabs voice** (`ReadAloudVoices`, reached from the menu's
    "Choose a voice…"): it lists `GET /v2/voices` on request with the open workspace's machine's key,
    else the first machine holding one, naming it (listing spends no credit), with a ▶ sample
    fetched from the voice's `preview_url` into a blob (ElevenLabs serves them with CORS), so the CSP
    needs no media host. Samples play on one element that the ▶ tap unlocks with the same silent clip
    before the fetch, for the same iOS rule; the silent clip's own `ended` must not stop the sample.
    **An `AbortError` from `play()` is a pause or a load cutting the start short, never a failure**
    (treating it as one switched a reading paused at once to the phone's voice).
