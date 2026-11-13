# Machine load strip

The home screen's per-machine memory reading. Read it before changing the stats collector or the strip.

- **Machine load strip — two figures, both measured from the footprint left once
  reclaimable cache is gone.** The agent pushes a `stats` message (CPU, physical memory, swap,
  and the per-user cgroup limit when one exists) every 5s while a client is connected; the home
  screen shows one compact line per machine (`core/machine-load.ts` + `lib/MachineLoad.svelte`),
  cleared when the machine goes offline so a stale reading is never shown as current. The line
  is `RAM <slow> left · <kill> before kill`, from `headroomBytes`:
  `slow = totalBytes − (usedBytes − reclaimable)` and `kill = maxBytes − (usedBytes − reclaimable)`.
  **Reclaimable cache counts as free in both, never as used:** `memory.current` counts it, so
  a healthy machine sits at its `memory.high` indefinitely while the kernel just drops cache.
  The slowdown starts when the *footprint* reaches `memory.high` and every allocation must
  swap; `memory.max` is the kill. No usage ratio, fraction or swap figure is shown — they
  were dropped as noise, since none of them answers "can I start something now". The kill
  figure is omitted when there is no separate kill line (uncapped, or `max ≤ high`); an
  uncapped machine shows MemAvailable alone. Four things not to "simplify":
  - The limit is found by **walking the agent's own cgroup up to the nearest ancestor that sets
    `memory.high`/`memory.max`** — a uid- or unit-name-keyed lookup breaks on any other machine.
  - **`totalBytes` is `min(high, max)` and `maxBytes` is a separate field.** `high` is where
    the slice slows down, `max` where the kernel kills; the strip shows the room before each.
  - **`reclaimableBytes` subtracts `file_mapped`** from `file + slab_reclaimable`. Mapped pages
    are reclaimable in principle but are the working set of running programs; counting them as
    free overstates the cushion, and a safety figure that overstates is worse than none.
  - **The band is the worst of three signals**: the room before slowing down against thresholds (`HEADROOM_WARN_BYTES` 3G /
    `HEADROOM_ALERT_BYTES` 0.5G — the knobs), the PSI `some avg10` stall (what is being felt
    *now*), and **growth in `memory.events` `oom_kill` since the client connected**. That last
    one is not redundant: a kill frees the memory that caused it, so the very next reading looks
    healthy and nothing else can report that anything died. The agent sends the raw cumulative
    counter; `store.oomKillsSince` keeps the per-connection baseline (deliberately **not**
    dropped when the machine goes offline — a kill landing while the phone is backgrounded is
    the one most worth surfacing — and re-baselined if the counter goes backwards, which means
    the cgroup was recreated).
  On this class of box the kernel kills by `oom_score_adj`, **not** by size: agent-spawned
  helpers (`adb`, `esbuild`, dbus, gpg-agent) carry 200 against a Claude session's 100, so a
  real kill looks like tooling breaking oddly rather than a workspace vanishing.
  A **`?` opens `MachineLoadHelp`**, which explains that machine's own live reading — it takes
  the same `LoadDescription` the strip rendered rather than re-deriving from `stats`, so the
  two cannot disagree, and it prints the thresholds via `formatBytes(HEADROOM_*)` so the prose
  survives a retune. Two layout traps, both of which pass every size assertion:
  **`.load` must not set `overflow: hidden`** — the button is a 32px tap target pulled back
  with negative margins, so clipping the row shaves its top and bottom and the circle paints as
  an ellipse (`boundingBox` still reports 32×32, so only a screenshot catches it); truncation
  belongs to `.figures`. And the button needs **explicit equal `width`/`height`**, not `min-*`:
  a stretched flex item with `border-radius: 50%` is an ellipse too. The strip's `aria-hidden`
  sits on `.figures`, **not** the wrapper — a focusable button inside an aria-hidden subtree is
  unreachable. Whitespace at an `{#if}` boundary is trimmed, so the optional kill figure joins
  the line with an explicit `{' '}`.
  `ProcSystemStats` is Linux-only by construction: elsewhere `read()` returns null, no
  `stats` is sent, and the strip does not render. All the headroom reads are best-effort — a
  kernel that exposes none of them still yields a reading, and the fields are optional on the
  wire so a version-skewed agent degrades to the old strip. `TARFA_STATS=off` in `agent.env`
  takes the collector away the same way (`serve.ts`), for a second Linux user on a box whose load
  another agent already shows. Requires an agent restart per machine.
