# Connections: phone port, addresses and reconnect

How a phone reaches an agent, walks its addresses, logs its connection and recovers from drops. Each bullet records a decision; read it before changing that code.

- **The phone port: phones connect to the agent directly** (`TARFA_PHONE_PORT`, default 8797,
  `infrastructure/phone-listener.ts`). It upgrades on **any** path (`tailscale serve --set-path`
  strips its prefix) and answers anything else 404, and each socket runs the unchanged Noise
  session through `WsServer.acceptPhoneSocket`. **One device gate serves every socket**
  (`startDeviceGate`): one roster, push budget, refusal log and roster monitor, so a revocation
  closes live sessions. The agent key is loaded or created at every start. Things not to "simplify":
  - **The agent bounds what strangers can make it hold** (`application/phone-admission.ts`):
    8 unauthenticated sockets per client address, 32 in all, and when full the **oldest** is
    closed, never the newcomer, so strangers holding slots cannot lock the owner out; 20 new
    sockets a minute per address. A session leaves every count once authenticated (a pushed
    session only at its first frame). Refusals are in band, `4429`.
  - **The client address is `x-forwarded-for`'s last hop, believed only from a loopback peer**;
    a loopback peer naming nobody counts against the total only. IPv6 counts by its /64 and its /56 (3× the caps); a `Tailscale-Funnel-Request` socket waits in a public pool of 16, so a public flood never evicts a tailnet handshake.
  - **Roster and pairing-file reads a stranger can cause are limited** (`DiskReadLimiter`, 4 at
    once, 10 a minute). A limited read closes the socket as busy (`4429` "too many pending", which
    the phone retries), never as a verdict on its code: an unread pairing code may still be live,
    and must not be refused as unknown. An enrolled key is answered
    from the roster the monitor last read, so the owner's phones never wait on it.
  - **A taken phone port does not stop the agent:** it logs `no phone port` and keeps serving its
    hooks, since a second Linux user's agent left on the default would otherwise crash-loop.
  - Every accepted `authResult` names `agent: { protocol: PROTOCOL_VERSION }` (contracts), so a
    PWA can tell an agent too old for it.
- **The PWA connects to each agent directly, trying its addresses in order.** The phone opens the address and starts the IK handshake
  (`adapters/noise-socket.ts`). Things not to "simplify":
  - **One entry per machine, known by its agent key** (`core/settings-store.ts`: `addresses`,
    1–4, stored normalized by `core/machine-addresses.ts`, so `wss://host` and `wss://host/` are
    one address). A pairing link naming a known key updates that entry (after the same
    confirmation, which names every host), but an entry the phone already connects with keys
    alone takes it only once the phone has connected through it (`pairingPlan`, then
    `ConnectionManager.probe`: one attempt beside the live connection, never retried). The phone
    cannot tell a fresh link from an old one opened again, and an old link's address may be dead
    or another agent's now: such a link changes nothing and the owner is told so. A link naming
    the entry's own addresses is dialed too, since its fresh code may be what re-enrols a phone the
    machine forgot, but fails silently. A proven link replaces the addresses (and switches the
    entry back on), written only when it changes the entry, since writing reconnects it. An entry
    still holding its pairing secret has usually not connected yet, so a link is a retry
    and applies at once. A link naming an address another key's entry
    holds is refused (`pairedMachine`), since it could point that entry elsewhere. IK pins the
    key, so a forged link can only redirect, never impersonate.
  - **An entry's addresses follow its agent, one proven address at a time** (`core/address-sync.ts`).
    Every accepted `authResult` names `agent.addresses` (the agent's `TARFA_PHONE_ADDRESSES`,
    `announcedAddresses`: omitted unless `tarfa pair` would accept the whole list, so a missing or
    empty list changes nothing) with the `addresses` feature. A listed address the entry lacks is
    a candidate, dialed alone through `ConnectionManager.probe` with no pairing code, and adopted only
    if it connects; one another key's entry holds is never a candidate. The entry becomes the
    listed addresses first (agent's order, held or proven), then the unlisted held ones: **never
    dropped on the agent's word**, only demoted, since a wrong list (a tailnet-only one) must not
    strand a phone off the tailnet; an unlisted one leaves the tail only when a proven address
    needs the slot (cap 4), and Settings removes one by hand. An address the agent still lists
    comes back at the next session, and so does its order: the agent's list is changed in
    `TARFA_PHONE_ADDRESSES`, not on the phone. A round is single-flight per machine,
    probes one candidate at a time and writes at most once, and only when the normalized list
    changes (a write reconnects). Triggers: each session (after its handler, never inside it), the
    browser's `online` and the app's foreground. **A failed candidate is kept in memory** (the agent
    names it again every session) and is dialed again by a session or a foreground only
    `FAILED_RETRY_MS` (5 min) after its last failure, by `online` at once: no timer, no loop. A
    write rebuilds every connection, which goes `online` → `connecting` with no `offline`; the
    store treats that as a drop (`setStatus`), so what each session held (a dictation, a media
    request, the load reading) is dropped and the open terminal re-attaches.
  - **One attempt walks the addresses inside the single connect chain** (`MachineConnection`,
    with the `generation` token as before), starting with the one that last reached `online` in
    this app session. The connection manager keeps that memory: a machine-list change rebuilds
    every connection. **Only a silent failure hands over to the next address** (no route, a
    refused upgrade, no open within `ADDRESS_OPEN_MS`, 6 s); a close the agent made, a refusal
    or a drop after the session opened, decides the attempt, so a final refusal (wrong agent
    key, revoked) never falls through to another address and redials. The last address keeps
    what is left of the 10 s connect deadline, so a lone address waits as long as before.
    Measured on a Galaxy Tab: ws-open 70–130 ms over the tailnet, 0.75–0.95 s over Funnel.
  - **Each connection-log phase names its address** (the connection manager appends it), and a
    hand-over is its own `address` phase.
  - **Android Chrome asks once before a page may open a tailnet address** (Local Network
    Access). While the prompt is up the socket hangs, and a "Block" makes the address fail like
    an unreachable one, with nothing on the socket to tell them apart, so the unreachable view
    adds an Android-only hint (Site settings → Local network access).
  - **The phone port's refusals are busy, never final**: `4429` with "too many pending" or "too
    many connections" redials on the backoff.
- **Reconnect must replace the connect chain, never stack a second one.** `MachineConnection`'s
  backoff retry is a fire-and-forget timer with no cancel handle, and `reconnect()` clears the
  `closedByUser` kill-switch. Before the fix, tapping Reconnect (or the app auto-firing
  `reconnectAll` on every foreground/`online`) started a *new* connect while a pending retry was
  still queued, so overlapping chains stacked up; each left a socket stalled in CONNECTING that
  WebKit never tears down, saturating the per-host pool and wedging reconnect until the user
  toggled the machine off/on (the only path that called `close()`, which quiesced everything).
  Fix: a monotonic `generation` token bumped by `reconnect()`/`close()`; the retry captures it
  and no-ops if superseded, so at most one chain is ever live. `onOpen`/`onMessage` also guard
  `this.socket === socket` so a late-opening orphan can't authenticate. Don't reintroduce an
  uncancellable retry or let `reconnect()` add chains without superseding the old one.
- **Reconnect UX: auto-recover calmly, don't interrupt in-flight connects.** `reconnectAll`
  (app refocus / browser `online` / the home Reconnect button) **skips machines already
  `connecting`** — aborting an in-flight attempt to restart it just resets progress on a
  slow-to-establish path (a phone waking, Tailscale cold); the 10s connect-deadline reaps a
  genuinely stalled one anyway. It only kicks idle-`offline` machines; a `connecting` one gets
  its backoff reset instead (`resetBackoff`, no abort). An attempt left in flight while the app
  was backgrounded fails right after it returns, and before this it then waited the backoff the
  background had built up (10 s), which on-device logs showed as the slowest foregrounds. The home screen shows a
  distinct calm **`reconnecting`** view ("Reconnecting…", spinner, no button) for a machine that
  reached `online` at least once this session (`store.reachedOnce`) and is briefly down — vs the
  alarming `unreachable` "Can't reach your machines / Reconnect" which is reserved for a machine
  that has **never** connected this session. **The `reconnecting` view falls through to
  `unreachable` after a longer grace** (`RECONNECT_GRACE_MS` = 25s, an adaptive duration on the
  single existing grace timer keyed off `reachedOnce`; `anyReconnecting` is gated on
  `!graceElapsed`) so a genuine extended outage surfaces the network hint + button instead of
  an eternal spinner. `deriveHomeView`'s `anyReconnecting` is otherwise stable within the window
  so it doesn't flicker with the backoff `connecting`↔`offline` cycle. The home button
  passes `reconnectAll(true)` → logs `manual-reconnect` (vs `auto-reconnect` for refocus). This
  came from on-device logs: the old 4s-grace flip to "Can't reach" made the user tap Reconnect,
  and each tap aborted an about-to-succeed connect, making recovery *slower*.
- **Connection-event log — a client→agent diagnostic that survives drops.** The PWA records
  connection lifecycle events (`connect`/`online`/`close`/`manual-reconnect` per machine —
  `manual-reconnect` = the user tapped Reconnect, `auto-reconnect` = a foreground/`online`
  event drove `reconnectAll` — plus app-global `visible`/`hidden`/`net-online`/`net-offline`),
  each stamped with the WS close `code`,
  `navigator.onLine`, and `document.visibilityState` — the three signals that separate
  iOS-backgrounding from network loss from a tailnet link drop. Events buffer in a durable
  localStorage ring (`core/connection-log.ts`, key `tarfa.connlog`) that survives an app kill,
  and flush **per-machine** inside the session after a reconnect (`clientLog` →
  `clientLogAck`; `core/connection-log-flush.ts`, driven from
  `store.setStatus`/`setConnectionError` and `App.svelte`'s visibility/online handlers via
  `store.logConnectivity`). The flush rides the *new* session, so the events about why the old
  one died are not lost with it; it fails soft (no `ok` ack → events stay buffered, drain next
  reconnect). The agent appends one JSON line per event to a gitignored
  `~/.tarfa/client-log.jsonl` (`FileClientLogStore`); a batch over 512 KB is refused. Dedup by
  `(sess, seq)` at read (a global event may appear once per machine it flushed to). No PWA/UI
  to read it; analyse the file on the box.
