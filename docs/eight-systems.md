# The Eight Load-Bearing Systems

The eight questions from `PROJECT_CONTEXT.md` §5, constructed. Each system
lists what it guarantees, where it lives, and how `npm run smoke` proves it —
not by unit-testing fragments, but by driving one long adversarial scenario
through the real engine over the real bridge.

---

## Q1 · File management — files + a registry that points at them

**Guarantee:** every durable thing is a readable file; large/immutable data is
content-addressed; nothing hides inside a running process.

| What | Where |
|---|---|
| Definitions (skills, profiles, schema, manifests) | `~/.neuralscope/definitions/` — seeded from the app, user-editable, versioned files |
| Registry (rows pointing at files) | `engine/src/registry.ts` → `state/registry.json` (row-shaped for a mechanical SQLite swap later) |
| **Blob store** (content-addressed, sha-256, deduplicated) | `BlobStore` in `registry.ts` → `state/blobs/ab/abcd….blob` |
| What flows as blobs | full prompts + responses (referenced from traces), every step's validated output (`StepState.outputBlob`), gdocs pre-write snapshots |
| Retrieval | read-only `/api/blob/:hash` |

**Proven:** smoke fetches a completed step's `outputBlob` over HTTP and
matches it against the delivered work.

## Q2 · Evolution — six phases, then probation

**Guarantee:** the system rewrites its own skills only on real evidence, and
every promotion must survive **live traffic** or it reverts itself.

Capture (worst measured fail-rate, Q4 stats) → decompose (recorded failures
as replays) → mutate → trial in the Testing territory → score against the
incumbent → promote — **as a canary**. `registry.recordSkillUse()` tallies
every validated use; a canary that regresses past its baseline triggers
`rollbackSkill()` and a `skill.rolledback` event; one that survives probation
clean becomes stable. Version numbers come from disk history, so archived
losers are never overwritten. `engine/src/tower/evolver.ts`, `registry.ts`.

**Proven:** smoke promotes `frontend` v2, regresses it with an unwinnable
objective → automatic rollback to v1; re-promotes v3, passes three clean
objectives → stable. All on the live engine.

## Q3 · Security — rings, tiers, and autonomy that is earned

**Guarantee:** three rings (tool gatekeeping / drift reboots / human gates),
four tiers, a kill switch — and a **graduation ledger**: a Tier-C capability
that accumulates N consecutive clean approvals (default 25, configurable)
graduates to Tier B (notify). One denial resets the record. Prompt-injection
posture: fetched web content travels inside `UNTRUSTED-WEB-CONTENT` envelopes,
models only ever *propose* actions, and deterministic code disposes through
ring-1. None of this layer is evolvable. `engine/src/tower/security.ts`.

**Proven:** smoke approves two off-allowlist fetches → `capability.graduated`
fires → the third identical action runs gate-free at Tier B. Kill switch
freezes mid-flight and resumes from checkpoint.

## Q4 · Analysis — behavioral transparency that steers evolution

**Guarantee:** complete behavioral records (every prompt, response, tool call,
validation — full payloads as blobs), live summaries for the inspector, and
**measured per-skill performance** (`attempts`/`failures` on every skill row)
that decides what the Evolver captures next. Honest ceiling, unchanged: we
record behavior, not neural internals. `tower/transparency.ts`, `registry.ts`.

**Proven:** evolver capture targets the skill with the worst measured fail
rate; the black box ends the scenario with 500+ schema-validated events.

## Q5 · Clean setup — the layer rule as executable law

**Guarantee:** World → Bridge → Tower → Runtime → Connectors, and no layer
skips or imports upward. The Runtime reaches the Tower only through injected
**ports** (`engine/src/runtime/ports.ts`) — dependency inversion, not
convention. `scripts/check-layers.mjs` greps every import and **fails the
build** on a violation; it runs inside `npm run typecheck` and CI.

**Proven:** the checker passes on every build; break the rule and CI goes red.

## Q6 · Google Docs — the gate, exactly as specified

**Guarantee:** OAuth tokens encrypted in the vault (never in prompts or
events); loopback OAuth with the user's own Desktop-app client; reads mirror
the document into the objective workspace; **writes are Tier B and snapshot
the document to the blob store first** (every write has a pre-image); in the
Testing territory every call hits the local mirror only — trials can never
touch a real document. `engine/src/connectors/gdocs.ts`.

**Proven:** smoke verifies the gate is registered, tiered, and refuses
cleanly without credentials (the network path needs your OAuth client —
Settings → Google Docs walks you through it).

## Q7 · Small models at human level — the compounding ladder

**Guarantee:** decomposition + skills + validation loops + role
specialization + routing, with a full recovery ladder when a step fails:

1. retry with the failure injected,
2. **adversarial critic** review fed into the retry (`critic.flagged`),
3. re-grounded reboot on drift (ring 2),
4. **escalation to a stronger model** on the final attempt (demo → ollama →
   anthropic; `worker.escalated`),
5. **re-decomposition**: the Tower splits an exhausted step into smaller
   steps and the circuit regrows (`step.decomposed`, once per objective).

`runtime/worker.ts`, `tower/compiler.ts (redecompose)`, `models/router.ts`.

**Proven:** smoke drives all rungs: `[demo-fail]` exercises 1–2, `[demo-fail-hard]`
completes only via rung 5, `[demo-fail-always]` exhausts everything and fails
honestly — validators never lie an unwinnable objective into success.

## Q8 · Auto-boot + circuits — the world never sleeps

**Guarantee:** recurring circuits are registry rows (`circuit.schedule` /
`circuit.unschedule`); the Tower ticks them, fires real objectives on
schedule, and never stacks runs of the same circuit. Model serving respects
the local machine: Ollama calls queue behind a concurrency budget instead of
thrashing one GPU. Step data flows between workers as validated outputs with
blob references along the plan's edges — the flight-plan graph IS the circuit.
`tower/tower.ts (tickCircuits)`, `models/ollama.ts`.

**Proven:** smoke schedules a circuit, watches it fire an objective by
itself, sees it delivered, and unschedules it.

---

*Every event named above is part of the frozen v1 contract
(`definitions/schema/events.v1.json`, additive extensions only) and has
exactly one visual meaning in the World.*
