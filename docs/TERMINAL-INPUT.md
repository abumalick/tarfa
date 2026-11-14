# Terminal input, keyboard bar, selection and files

Android input, the keyboard bar, select mode, the clipboard, links, media previews and attachments. Each bullet records a decision; read it before changing that code.

- **Android terminal input bypasses xterm's IME path, and the textarea is the model.**
  xterm.js's composition handling desyncs from the pty on Android: it tracks a composition as
  absolute indices into its accumulating hidden-textarea value, which breaks on Android's racing
  composition events, and Tarfa's keyboard-bar arrows write to the pty out-of-band. On Android
  (iOS untouched) `lib/android-input.ts` takes over: **the browser applies every keyboard edit to
  the textarea, and on each `input` (and `compositionend`) the adapter sends
  `diffLine(sent, textarea.value)`** (`core/android-terminal-input.ts`) — backspaces to the common
  prefix, then the new tail — and sets `sent` to the field. The field is thus both what the
  keyboard reads back (word boundaries, predictions, the swipe space) and the record of what the
  pty line holds since the field last started over.
  **Don't go back to inferring edits from event types.** The previous design `preventDefault`ed
  each edit and rebuilt the line from its `inputType`, which needs facts a textarea does not
  give: `getTargetRanges()` is always empty there, a keyboard can delete several characters in
  one `deleteContentBackward`, and when backspacing into a committed word HeliBoard re-opens it
  as a composition and re-announces it in full with **no `beforeinput` and no `input`**. A
  heuristic for that last case ("the update starts with the field's trailing word") split words
  on spaces while HeliBoard splits on `/ . - '`, so `path/to/file.ts` + 3 backspaces + `md` sent
  `see path/to/filefilemd` (captured on-device, replayed in `android-input.test.ts`). Under the
  diff the re-opening changes nothing in the field, so nothing is sent. Nine patches to the
  inference design preceded this; each was one more case of the same gap.
  Invariants that carry it:
  - **`sent` and the field change together** (`sync()`); nothing else writes either. A field
    emptied behind the adapter's back would make the next diff backspace the whole line.
  - **Every `input` is stopped from reaching xterm**, composing or not: xterm's input handler
    re-sends inserted text and empties the field.
  - The adapter listens on an **ancestor** (the terminal container) in the **capture phase** and
    calls `stopPropagation()`, NOT on the textarea. xterm registers its textarea listeners during
    `open()` *before* the adapter, and at the target node listeners fire in registration order
    regardless of capture flag — a textarea-level `stopImmediatePropagation` runs too late (every
    letter was sent twice). A test with a pre-registered xterm-like listener guards it.
  - **The field keeps the whole line typed since it last started over** — never blank it after a
    word. Gesture typing emits the inter-word space as a standalone `insertText " "` only when
    the keyboard sees a word before the caret, and it tracks the field as a whole: a one-word
    window passed with two words and dropped every space from the third (`one twothreefour`).
    Verify a change here with **four** swiped words on-device, never two.
  - **Anything that writes the pty line without the field starts the field over**
    (`resetContext()`): the keyboard bar, the 📋 button, and the store's own typing (a stored
    file's path, a dictation transcript) via `store.onInjectedInput`. Enter starts it over too
    (else the keyboard prepends a space to the next line), and so does a keyboard paste: xterm's
    `paste` listener sends the bracketed text and empties the field, the adapter
    `preventDefault`s the `insertFromPaste` that would put it back, and since Claude Code may fold
    a paste into a `[Pasted text]` placeholder the resulting line is unknown.
  - **`resetContext()` starts the field over even with a word open — that is what ends it.**
    Measured on-device: changing the field makes HeliBoard drop its composition (no
    `compositionend`) and start the next letter afresh in the new field, with no stale update
    for the old word. Re-setting the same value or moving the caret and back does *not* end it.
    The old rule (no-op while composing) let a bar key land on the pty while HeliBoard went on
    editing its open word, so its next backspace hit the bar's character instead.
  - **A blur starts the field over too.** xterm's `_handleTextAreaBlur` sets
    `textarea.value = ''`; without `sync('')` on `focusout`, the first edit after switching apps
    or hiding the keyboard diffed against the old line and backspaced all of it.
  - **A backspace on an empty field is sent by hand.** HeliBoard then fires `keydown`(8) +
    `beforeinput deleteContentBackward` and **no `input`**, while the pty line may still hold text
    from before the field started over; the adapter sends `DEL` when the caret is at 0.
  - An edit away from the end of the field (the keyboard moving the caret itself) diffs as
    "backspace to it, retype the tail", which is right because the pty cursor is at the end.
  Diagnose on-device by capturing the raw event stream over Chrome DevTools (window
  capture-phase listeners recording `inputType`, `data` and the field value before/after) next
  to `tmux capture-pane` of a scratch workspace; Settings → Diagnostics keeps the adapter's own
  log (`core/terminal-input-log.ts`).
  - **A keydown that edits no text goes to xterm; there is no list of shortcuts.** Swallowing
    every keydown killed a hardware keyboard's Ctrl+P, Esc, Tab and Shift+Arrow, and
    HeliBoard's dpad joystick (real `KEYCODE_DPAD_*` events). `forXterm` lets through anything
    with Ctrl/Alt/Meta held and any named key (`key` longer than one character) except Enter
    and Backspace. xterm encodes it (every modifier combination, application cursor mode),
    sends it from the keydown and cancels the event, so no text reaches the field. The adapter
    then calls `resetContext()`. These stay on the field path: soft-keyboard text (229,
    `Unidentified`, `Process`), `Dead` and AltGr characters, printable keys with or without
    Shift, and Enter/Backspace (HeliBoard sends both as real keycodes; beforeinput handles
    them). Two exceptions not to "simplify". **A bare modifier keydown is stopped without a
    reset**, or a Shift pressed before a letter would end the open word. **Ctrl+V stays the
    browser's paste**: xterm would send `^V` and cancel it, and HeliBoard's paste key is a Ctrl+V.
    A keyboard-bar Ctrl/Alt still applies to the next letter typed (it goes through the field
    and `sendTyped`); because the pty then gets a control byte the field does not hold,
    `sendTyped` starts the field over whenever it transforms the input.
    `e2e/android-hardware-keys.spec.ts` drives the real xterm with an Android user agent.
  - **A soft-keyboard space never takes an armed ⌃/⌥** (`processTypedInput`). After a swiped
    word or a picked suggestion, HeliBoard sends the space it owes as its own `insertText " "`
    just before the next letter, so ⌥ then `b` reached the pty as `ESC space` + a plain `b`
    (captured on a Galaxy Tab: `1b 20 62`). The modifier now waits for the letter; Ctrl/Alt+Space
    come from the bar's ␣, which does apply them. `e2e/android-bar-modifiers.spec.ts` replays the
    captured event shapes and asserts the exact bytes for each bar modifier.
  - **The adapter must stop `keypress` too, not just `keydown`.** One soft-keyboard Enter fires
    `keydown`(13) → `keypress`(13) → `beforeinput`(`insertLineBreak`). xterm registers a
    `keypress` listener on its textarea and sends the key from it whenever it did not handle the
    matching `keydown`, which with `keydown` stopped is always. The adapter's `beforeinput`
    path sends `\r` as well, so every Enter submitted twice. In Claude Code's `AskUserQuestion`
    the extra `\r` answers the next question with its first option (or lands on the review
    screen), which reads as "several answers submitted" or a declined prompt. The keyboard
    bar's ⏎ writes straight to the pty and never had the bug, which is what hid the cause. The
    `keypress` is stopped **without** `preventDefault`, which could cancel the `beforeinput`
    that carries the Enter. Found by capturing the WebSocket bytes on-device over Chrome
    DevTools. The in-app input log never records xterm's own sends, so it could not show this.
- **Select mode (⌶) is a frozen snapshot that looks like the terminal, the same on every platform.** xterm's
  rows cannot carry a native selection: xterm sets `user-select: none`, rebuilds a row's
  elements whenever its content changes (Claude Code's spinner collapsed an iOS selection
  within seconds), and has only the visible screen in the DOM. Each platform once had its own
  workaround (iOS re-enabled `user-select` on the rows, Android drove xterm's selection from
  touch with a Copy button). Now ⌶ covers the terminal with `core/terminal-snapshot.ts`'s
  copy of the buffer, scrollback included and soft-wrapped rows joined, in an ordinary
  scrollable element, so the OS's own selection, handles and Copy callout work as on a web
  page. It is frozen on purpose: live output would disturb the selection. It must not move
  anything the user was looking at: each cell keeps its colour (`cellStyle` mirrors xterm's
  default palette, bold brightening, inverse and dim), each paragraph is drawn row by row as the
  terminal drew it (a later row starts with a generated `\A` plus the indent it dropped, which
  no selection or copy includes), and the font, `letter-spacing` and row width are read from
  xterm's own `.xterm-rows`/`.xterm-screen`. Like xterm, every glyph outside ASCII is its own run
  whose letter spacing is measured to fill exactly its cells (`⏺`, `⎿`, CJK and emoji come from
  fallback fonts and would push the rest of the row off), and a spacer after the rows lets the
  snapshot scroll its viewport row to the top (FitAddon leaves part of a row unused at the
  bottom, so a clamped scroll drew every row lower). `e2e/terminal-select.spec.ts` checks colour,
  position with scrollback and such a glyph, and that a selection across a wrapped row still
  reads one line; it fails without either fix. Desktop copy-on-select in the
  live terminal is unchanged.
  **Claude Code wraps its own text**, so the terminal holds its paragraphs as separate lines
  (`tmux capture-pane -J` joins nothing): the snapshot rebuilds them by inference (`reflow`).
  A break counts as the app's when the row plus a space plus the next word exceeds the width
  (Claude wraps at exactly `cols`, measured on real panes), the next row has a continuation
  indent and opens no item; a full row whose token runs on rejoins with no space. A rare wrong
  join in command output is the accepted cost; it affects only what is copied.
- **A program can set the phone's clipboard (OSC 52), but never read it.** Claude Code's
  `/copy` inside tmux runs `tmux load-buffer -w`, and tmux (`set-clipboard on`, our pty is
  `xterm-256color`, which matches `xterm*:clipboard`) forwards it to the PWA as OSC 52; vim,
  shells and anything else that emits OSC 52 take the same path. `core/osc52.ts` decodes it as
  UTF-8 and **ignores a `?` read request**: answering it would let any workspace program read
  the phone's clipboard. WebKit refuses `writeText` without a user tap, so a refused write shows
  `CopyOffer` (tap Copy, or dismiss); only the latest copy is kept, and an older refused write
  that settles late cannot replace a newer one (`copySeq`). No agent or protocol change.
- **An installed Android PWA cannot hand a tapped link to another browser app; the share sheet
  can.** A link picker set as the default browser (LinkSheet) never sees a terminal link: Firefox's
  web-app mode drops any link bound for an installed browser, and Chrome keeps http(s) in-app
  unless an app declares that exact host, while an `intent://` URL renders a blank page inside the
  WebAPK (measured on-device against every variant: `package`, `component`, `action`, fallback,
  anchor, `location.href`, `window.open`). So the Android-only Settings toggle "Open links with
  the share sheet" (`tarfa.shareLinks`, off by default) sends terminal links to
  `navigator.share({ url })`, where LinkSheet's share target takes them. Don't go back to
  intent URLs; a one-tap handoff needs a native shell.
- **A dropdown inside the keyboard bar must be `position: fixed`, not `absolute`.** The bar
  is a horizontal scroller (`overflow-x: auto`), and CSS forces the cross axis to a clipping
  value when one axis scrolls — `overflow-y: visible` is impossible there. So an
  absolutely-positioned menu inside the bar renders in the DOM but is invisibly clipped
  (jsdom has no layout, so unit tests happily pass; only the Playwright e2e caught it).
  `DictationMenu` is positioned fixed against the viewport from the mic's rect, measured
  when it opens. Don't "simplify" it back to `absolute`.
- **A keyboard-bar key commits on release, never on `pointerdown`.** The bar is a horizontal
  scroller, so a drag that starts on a key is usually the user scrolling it — and firing on
  `pointerdown` typed a space / submitted the line / sent an Escape before the gesture could
  reveal itself as a scroll. A keystroke on the wire cannot be recalled, so `press` waits for
  `pointerup` and cancels on drag. Two things not to "simplify": **`pointercancel` is the
  primary cancel signal, not a backstop** — once WebKit's scroller claims the gesture it fires
  `pointerdown → pointercancel` with typically *zero* `pointermove`, so a slop-only version
  passes every unit test and does nothing on the phone; and **`suppressClick` is set in `arm`,
  not at the fire site**, or a cancelled press still sends on the `click` the browser
  synthesizes anyway. `startKeyRepeat` now owns the *first* hit of a held key (at 300ms) and
  sets `fired` so the release doesn't double-send — a held `⌫` therefore starts deleting at
  300ms, an accepted cost. `TAP_SLOP_PX` (10, exported from `KeyboardBar.svelte`) is the knob.
  Playwright can't cover this — `page.touchscreen` has only `tap()`, no drag-pan — so the
  unit tests carry it.
- **Cursor movement is a trackpad (`✥`), not four arrow buttons.** Dragging the pad emits one
  arrow key per `NOTCH_PX` of travel (Blink-Shell style), so distance controls how far the
  cursor moves instead of tap-count or hold-duration. **The tuning knobs, in order of how
  likely you are to want them:**
  - `NOTCH_PX` in `core/cursor-pad.ts` (currently 18) — px of travel per arrow key. Lower =
    faster/twitchier, higher = slower/more precise. Changing it needs no other edit; the unit
    tests derive from the constant.
  - The axis lock in `moveGesture`'s `lockAxis` — the first notch picks an axis and the
    gesture keeps it until release, so a sloppy diagonal can't spray perpendicular arrows.
  - `padKeys` in `KeyboardBar.svelte` — the four arrow definitions, kept intact (just not
    rendered as buttons) so restoring the old four-arrow bar is a small revert.
  The logic is a pure reducer (`core/cursor-pad.ts`) modelled as **reference point + notch
  crossing**, not distance-from-origin: each emitted notch advances the reference, which is
  what makes reversing the drag emit the opposite arrow for free. Two things not to
  "simplify": the pad uses its **own** pointer action, **not** the shared `press` action —
  `press` releases on `pointerleave`, which would abort the drag the instant the finger left
  the 2.75rem button; and it needs `setPointerCapture` **plus** `touch-action: none`, or the
  bar's `overflow-x: auto` scroller eats the gesture (jsdom has no layout, so only an e2e
  sees that). Each notch is emitted through the same `applyEditKey` path as a real key tap,
  so an **armed** ⌥ is consumed by the first notch only (word-left, then char-lefts) while a
  **locked** ⌥ applies to every notch — and `↑`/`↓` deliberately carry no `edit` field, so
  modifiers never transform them. A plain tap emits nothing (the button has no inherent
  direction). If the ratchet model ever loses on feel, the recorded fallback is a
  hold-to-repeat joystick reusing `core/key-repeat.ts`.
- **Media previews come in acknowledged chunks inside the session, never as one message.**
  Image, PDF and audio bytes are read with `readMedia` and arrive as `mediaChunk`s (`docs/DEVICE-KEYS.md`), never as one base64 blob on the shared session, which would stall terminal output
  behind it. The agent once served them over an HTTP `GET /file`, which on the iPhone needed
  iCloud Private Relay off: it proxies Safari's HTTPS fetches through Apple, which cannot reach
  a tailnet `100.x` address, while WebSockets and the cached PWA shell kept working and masked
  the cause. If an HTTPS fetch to a tailnet host ever fails only on an iPhone, suspect Private
  Relay first.
  Also: the image viewer's frame is sized to `calc(100dvh - 8rem)` like `FileViewer`,
  **not** `height:100%` — the narrow phone layout's `<main>` has no height, so a percentage
  height collapses the frame to 0 (image invisible). A phone-width Playwright test guards it;
  the wide-viewport e2e missed it.
- **Attaching a file: the picker takes every type, paste cannot.** The keyboard bar's 📎
  input deliberately carries **no `accept`** (and no `capture`): any `accept` greys out
  non-matching files in the OS picker, and an `image/*` one made archives unreachable in
  the iPhone's Files app. Nothing downstream ever needed an image — `putFile` is
  `{name, data}` on the wire and `storePastedFile` only sanitizes the basename — so the
  restriction was purely the two PWA entry points. **Paste is different and is not a bug:**
  WebKit's async clipboard read (`navigator.clipboard.read()`, what the 📋 button calls)
  supports only `text/plain`, `text/html`, `text/uri-list` and `image/png`, and it
  deliberately suppresses file references — with a file on the pasteboard, `text/uri-list`
  is honoured only for `http`/`https`/`data`/`blob` schemes and `text/plain` returns empty,
  so a `file:` URL from Files.app is blocked by design. Don't "fix" `clipboard-paste.ts` to
  chase it. (The *paste-event* path, `DataTransfer.files` on a real paste into a focused
  editable field, is a different API that WebKit does populate — untested here, and using it
  would mean replacing the button with a native paste callout.)
  Two things not to drop: **uploads are capped at 20 MB in `store.sendPutFile`** — `putFile`
  base64s the file over the terminal session, and the old image-only filter was
  implicitly bounding size, so accepting archives removes that bound; the guard lives in
  `sendPutFile` because paste, the picker and the share target all funnel through it. And
  `sendPutFile` **returns whether it sent**, which `attachSharedFile` must honour: the
  share-target cache entry is the only copy of a shared file, so clearing it after a refused
  send destroys the bytes. **A shared file is attached only on the user's tap**
  (`SharedFileConfirm` in the terminal view names the file, its size and the workspace): the
  service worker drops a share-target POST that carries a referrer or a cross-site
  `Sec-Fetch-Site`, but a page that hides its referrer gets past that, so opening a workspace
  or a machine coming online must never send it on its own. The Android share target accepts `*/*` and the service worker
  reads **`form.get('file') ?? form.get('image')`** — an installed PWA keeps its old manifest
  until a home-screen reinstall, so the OS goes on POSTing the old field name.
