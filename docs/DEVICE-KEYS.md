# Device keys, enrolment and pairing

The agent is the gate: Noise IK, device keys, the roster, pairing codes and refusals. Each bullet records a decision; read it before changing that code.

- **Device keys, enrolment and pairing: the agent is the gate.** Every byte between phone and
  agent is a Noise IK session (`packages/secure-channel`) pinned to the agent's key and carrying
  the phone's own device key. Relays once stood in front of it; they were removed, and what
  follows are the agent's and the PWA's own rules. Things not to "simplify":
  - **A machine entry is connectable only with a valid 32-byte agent key, and never connects in
    plaintext.** Without one it gets no socket at all, and Settings refuses to save an entry
    with its key cleared.
  - **The chunk flag is the AEAD's associated data.** Outside it, anything on the path (a proxy,
    Funnel) could merge or cut messages undetected. Any change to framing or the handshake is a
    wire-format change: bump the prologue, and ship the agent and PWA together
    (`serve:agent` + `serve:build`). The prologue is still `perch-relay-noise-v3` and stays so
    until a real wire change.
  - **NK is retired; IK is the only handshake** (flag `0x03`). The old NK flag `0x02` fails as
    any non-handshake frame does (4002).
  - **Media previews, the browser view and the connection-log flush ride the session**
    (`session-channels.ts` in contracts); the agent has no HTTP `/file`, `/clientlog` or
    `/browser` endpoints. The browser stream opens with the browser protocol's `auth` but its
    token is empty and never checked: the session is already authenticated, and a paired phone
    holds no token. **The phone's acknowledgements are the backpressure** (`mediaAck`,
    `browserAck`): the agent's socket drains into whatever publishes the phone port at once, so
    its `bufferedAmount` cannot see a slow phone. Keep a media chunk inside one Noise frame and
    the windows small (4 chunks, one browser message), since `seal` sends a message's frames
    back to back and whatever is in flight is what terminal output waits behind. A held browser
    frame is flushed on the ack (`onDrain`), not on the next upstream message.
  - **Each PWA keeps an X25519 + Ed25519 identity in IndexedDB** (non-extractable WebCrypto
    keys, noble per curve where the browser lacks it). **If IndexedDB will not store the
    `CryptoKey`s (or returns them broken), both keys fall back to noble raw bytes.** That falls
    under storage, not generation. Playwright's WebKit takes `CryptoKey`s without an error but
    reads them back broken, so every e2e exercises the read-back fallback; only
    `e2e/device-key.spec.ts`'s patched IndexedDB covers the `DataCloneError` path. A store that
    cannot be *read* fails the load: never make a key for the launch alone (each one would enrol
    as a new device), and never replace a stored identity. The failure reaches Settings →
    Diagnostics and the connection error with its DOMException name. **A new device key is read
    back before it is trusted:** the PWA then replaces its own just-created record with noble
    keys, and an existing record that reads back malformed fails with a way out, never a
    `TypeError` and never a silent new key.
  - **Only the X25519 key identifies a phone.** The agent checks the IK key against
    `~/.tarfa/devices.json` itself: an unknown key may send `auth` and nothing else, and it is
    enrolled only when the handler's `authResult ok` goes out. The hello's Ed25519 key (`sig`)
    is stored in the roster for its file format and checked by nothing; its `proof`, which
    relays admitted a phone by, is optional in the schema so an older PWA's hello still parses,
    and is never read (the PWA no longer sends one). **The roster knows a key by its bytes, so
    the responder refuses a non-canonical X25519 encoding** (top bit set, or ≥ p): X25519
    ignores the top bit, and a revoked key re-spelled would come back as unknown. **Nothing the
    phone sends behind an accepted `auth` reaches the handler until the roster write settles**
    (it is held with the outgoing `authResult`, and dropped if the roster declines). Hello names
    are sanitised (control characters, bidi overrides) before the journal and `tarfa devices`.
    Until `auth` is accepted the agent reads 8 KiB messages at most and three `auth`s per
    socket, both counted as messages arrive, and holds at most 16 messages while a credential is
    being checked (an honest phone sends nothing behind `auth` until `authResult`).
  - **A phone is refused in band, never with an HTTP status.** A browser's WebSocket reports
    1006 for any refused upgrade, which reads as a network failure. The phone port completes the
    upgrade and closes it with `4000 + status` (`4429` busy) or the agent's `4003`, and a
    `REFUSAL` reason (`secure-channel/src/refusal.ts`, the reasons an agent sends); the PWA words
    each one (`core/refusal.ts`) and stops redialing on a final one. The agent keeps spent and
    expired pairing codes for a day so it can say which. A reason is told only to whoever passed
    the check that produced it. `REFUSAL.signature` is the one reason no current agent sends: an agent from
    before the relays' removal refuses a new phone whose hello has no proof, and the PWA words it
    as final ("agent too old"), so update agents before deploying the app.
  - **A phone that pinned another agent key is told so, finally.** The responder tells a first
    message sealed for another static key (`WrongStaticKeyError`) from any other failure; the
    agent closes it with 4003 "wrong agent key", and the PWA words it as final. "Agent key
    mismatch" is for an answer the pinned key did not make, which the real agent never sends.
  - **Revocation is a deny list, not a deletion,** so `tarfa devices` goes on naming a revoked
    phone; `forget` drops it, and its key may then pair again.
  - **There is no shared secret: a phone joins only with a `tarfa pair` code.** Token enrolment
    (`TARFA_TOKEN`) was removed: an agent.env that still sets it starts, ignoring it with one
    warning, and `tarfa setup` neither writes nor removes the line. An unknown key whose `auth`
    carries anything but a live pairing code is refused "device not enrolled" before the handler
    sees it; an enrolled key is served whatever its `auth` carries (an old PWA may still send a
    token). The wire keeps its shape: `auth.token` carries the pairing code or nothing, and
    `credential: 'token'` and the `token not needed` / `enrolment off` refusals stay parseable for
    agents from before. Making a new device key (Settings, an unreadable key) therefore means
    pairing each machine again.
  - **A phone forgets its pairing code once its key is enrolled, and the `authResult` waits for
    the roster.** `authResult` carries `credential` (device, pairing) and `enrolled`; unless it
    says `enrolled: false` the PWA drops the entry's pairing code (`onCredentialsSpent`). For a
    new device `NoiseClientConnection` holds the `authResult` (and anything sent after it, in
    order) until the roster write resolves: `enrolled` must mean written, or a phone whose
    enrolment failed would be left with no credential. A code is dropped on the session's
    `authResult` only, never just because the machine came online. An entry stored by an older
    PWA may hold a token: `SettingsStore.list` drops it, and the next write removes it.
  - **An enrolled IK key authenticates its session on its own** (`keyCredential`: `device` for a
    key enrolled at the handshake, `pairing` for one that just spent a code): a paired phone has
    no token. That makes the device key the phone's whole credential, which is why the
    extractable fallback above matters.
  - **Enrolment is `open` (a pairing code enrols a phone) or `closed` (nothing does)**
    (`tarfa devices enrolment open|closed`; the old `on`/`off` are refused with a pointer).
    `devices.json` keeps `enrolment` as "any enrolment at all" and **holds
    `tokenEnrolment: false`**, written by every `FileDeviceStore.update` and once at agent startup
    when missing (`sealTokenEnrolment`, a missing file included; a malformed one is left to fail
    closed), and read by no current agent: an agent
    from before the removal, brought back with its agent.env's `TARFA_TOKEN`, would read an absent
    field as "the token enrols". The agent refuses at the handshake (closed only), at an unknown
    device's `auth` that carries no live code, and at `enrol(device)` after `authResult`, which
    closes the session when the roster declines (closed since the handshake, or the id taken);
    only a failed write serves it unenrolled.
  - **A pairing secret is spent atomically at `auth`** (`redeemPairing`, under the pairing file's
    lock). Only `closed` refuses it. **It is spent by the first
    `auth` that presents it, enrolled device or not**, and bound to that device's key (`usedBy`):
    an already-enrolled device needs no code, but one it left live would admit whoever else holds
    the link for twenty minutes. The binding device presenting it again is not a second use; any
    other is refused.
  - **Device ids are 48 bits, so a key is the real name.** Enrolment refuses a key whose id is
    already in the roster (enrolled or revoked), and `tarfa devices revoke/forget` take the full
    X25519 key as well as an id, which `tarfa devices` prints.
  - **`devices.json` fails closed and writes under a lock.** Malformed is an error, never an
    empty roster (that would forget every revocation and re-open enrolment), and the agent and
    `tarfa devices` write it from different processes. A pairing secret the agent never issued is
    answered without taking `pairing.json`'s lock, so made-up ones cannot keep `tarfa pair` out.
  - **The hooks have their own secret, kept off every command line.** `POST /hooks` takes a
    random secret the agent writes to `~/.tarfa/token` at each start (the path installed hooks
    already read). `POST /unpark`, `POST /close` and
    `POST /message` take the same secret, which the CLI reads from that file into a header in-process.
    `tarfa-hook.sh` gives curl the header through a file (process substitution) and the body on
    stdin, built with the `printf` builtin: any local user can read a process's argv.
    `tarfa-hook.test.sh` asserts neither reaches it.
  - **The PWA runs no script but its own bundle.** A media preview's Blob takes the type its
    path implies, never the agent's (`SessionMedia` refuses a reply naming another): a blob: URL
    has the PWA's origin, so an agent answering a `.pdf` as `text/html` once ran script beside
    every machine entry and the device keys. The build adds a Content-Security-Policy meta
    (`core/csp.ts`, `script-src 'self'`; a blob document inherits it), and specs that touch
    previews, the browser view or the terminal fail on any violation (`e2e/csp.ts`). A new
    external host the PWA must reach goes in `connect-src` there. The PDF iframe has no
    `sandbox`: WebKit draws PDFs with a plugin, which any sandbox disables.
  - **Secret files must be private, or the agent does not start.** At startup it makes
    `~/.tarfa` 0700 and exits, naming each file and the `chmod 600` that fixes it, while
    `agent-key.json` (the agent key), `devices.json`, `pairing.json`, `token`, `dictation-keys.json` or the agent.env it
    read (`~/.tarfa/agent.env`, or the file `TARFA_AGENT_ENV` names) can be read or
    written by another user. A service that crash-loops right after an update: read its log for
    that line first.
  - **No process the agent starts gets a `TARFA_` variable** (`childEnv`, used by every
    `execFile` and the pty). A tmux server copies the environment of the client that starts it
    into its global environment, which every pane inherits; when the agent's own
    `new-session` found no server, every workspace got the agent's settings. A new spawn site must use
    `childEnv()` too. The CLI reads the agent.env the service reads for every command, since a
    shell in a workspace has none of the agent's variables.
  - **An agent.env from before still starts.** `TARFA_RELAY_URLS` or `TARFA_RELAY_URL` is
    ignored with one startup warning, and `tarfa connect`, `tarfa relay-key` and
    `tarfa pair --relay` refuse in one line pointing at `tarfa setup` and `tarfa pair` (exit 2).
  - **Machines are set up with `tarfa setup`; phones pair with `tarfa pair`** (runbook:
    `docs/DEPLOY.md`). Pairing rules:
    - **What `tarfa pair` prints is a code, not a link** (`secure-channel/src/pairing-code.ts`):
      `TARFA` + upper-case Crockford base32 of a version byte, the raw agent key and secret, the
      name, the default path, 1–4 addresses (a scheme byte, `wss`/`ws`, and the rest) and a 4-byte
      SHA-256 checksum, with the QR code carrying the same text. A link looked like something to
      open, and opened outside the installed app (a desktop, an iPhone's Safari) it paired
      nothing, so the code is pasted or scanned inside the app on every device. Opaque on
      purpose: no `wss://` or host for a chat app to linkify, one alphabet a double-click selects
      whole, and the QR code's dense alphanumeric mode. Whitespace and case are ignored (a
      terminal or chat wraps it); anything else that is not exactly a valid code is refused
      whole, and an unknown version byte says "update the app". It decodes to the same
      `PairingLink` the link does, through the same checks (`isMachineUrl`, `MAX_ADDRESSES`, the
      name length, `isPairingPath`), so every rule below holds for both. A code names no origin,
      so `otherOrigin` applies to links only. **The PWA keeps reading links** (released agents
      print them, `tarfa pair --link` still does, and `deploy/sandbox.sh` opens one in its
      headless browser), so deploy a PWA that reads codes before an agent that prints them.
    - **A pasted or scanned code is confirmed like a link opened from elsewhere**
      (`store.pairFromLink` asks `pairingQuestion`): a code pasted from a chat is as foreign as a
      link, and `tarfa pair` promises the phone will show the key's fingerprint. A decline stops
      the scan, or the next frame would ask again.
    - **A link's default path (`p`, from `TARFA_DEFAULT_PATH`) is a convenience, never a reason
      to fail a pairing.** The phone drops one that is not absolute or exceeds 128 characters and
      pairs anyway, so `tarfa pair` refuses such a value up front instead. It sets a new entry's
      `defaultPath` and fills an existing entry only when that has none: a re-scan is a retry,
      and the owner's Settings value wins, like the entry's name.
    - **A pairing link carries up to four addresses and never re-pins an entry.**
      `#pair?u=<address>&u=…&k=<agent key>&s=<secret>&n=<name>&p=<path>` (`pairing-link.ts`):
      `u` repeats 1–4 times in the order the phone tries them, each `wss:` (`ws:` on loopback
      only, for the e2e) with the path `/` or one segment (a `tailscale serve --set-path` slug); a
      fifth or any invalid one nulls the whole link. A link naming an address another key's entry
      holds is refused (`pairedMachine`, `docs/CONNECTIONS.md`). A link opened from outside the app (or
      a pasted code) is confirmed first, showing every host and the machine key's fingerprint that `tarfa pair`
      prints beside the code. A full link must name this app's own origin (`readPairingLink`).
    - **A pairing link tapped inside the app is paired by the running app**
      (`store.openPairingLink`, from the terminal's link handlers and a capture-phase click
      listener), never opened: on Android it opened another page context, which added the
      entry behind the main view's back. Entries written by another page context are picked up
      on the `storage` event and on becoming visible (`refreshMachines`).
    - **The PWA takes the `#pair?…` fragment before anything connects**, and must read
      `location.hash` *before* `history.replaceState` — `location` is live, and reading it after
      the replace yields an empty hash (a plain-object unit test cannot see this; the e2e does).
    - **On iOS, a pairing link opened outside the Home Screen app is held, not paired**
      (`outsideInstalledApp`: `navigator.standalone === false`). The Home Screen app keeps its
      own storage, apart from Safari's and from the in-app browsers chat apps open links in, and
      no link ever opens it, so pairing there spent the one-time code on a context the owner
      then left. `InstallFirst` walks them through copying the link, adding the app, and
      **Paste pairing code** in Settings (which takes a link too) (the clipboard is the one thing the contexts share);
      "Pair in this browser instead" keeps the old path.
  - **An enrolled phone with no credential is served at once, right behind message 2.** Its
    device hello carries `push`; when the agent finds the key enrolled it answers `authResult`
    (`pushed`) and the opening replies (workspaces, keyterms) without waiting for the
    phone's `auth`, which saves the round trips that followed the handshake. The phone still
    sends its `auth`; the handler answers it with nothing. Things not to "simplify": **the phone
    asks only when its entry holds no pairing secret** — otherwise the pushed `enrolled` could make it forget a pairing code
    before its `auth` burned it; **a pushed session keeps its auth deadline and its
    unauthenticated slot on the phone port until the phone's first frame** (message 1 can be
    replayed by whoever saw it, and its replies are unreadable, but each one would otherwise free
    a slot as authenticated); and **`PushBudget` caps pushes at 10 a minute per device key**,
    since each replay builds the list again; past it, and with no budget wired at all, the phone
    gets the old flow.
