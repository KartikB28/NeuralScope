# NeuralScope — Project Context

> Full background for any Claude Code session. `CLAUDE.md` holds the day-to-day
> rules; this file holds the *why* and the complete state of thinking so far.
> Generated from the originating design conversation.

---

## 0. STATUS AMENDMENT (2026-06-12) — v0.1 is built

The 7-day vertical slice was built in one pass as a **complete downloadable
desktop app** (the user's directive: "complete app, not just html; downloadable
and easiest to use"). Two deltas against the plan below, both deliberate:

1. **Stack pivot, principles intact.** TypeScript/Node everywhere instead of
   Python+FastAPI, so the whole thing ships as one Electron installer (Windows/
   macOS/Linux via GitHub Actions on tag push). The five layers, the frozen
   event contract, files+registry, the security rings/tiers, the evolvable
   line — all implemented exactly as specified below. The Python embodiment
   cluster is vendored untouched in `reference/` as the future Tier-D connector.
2. **A built-in offline demo engine** (deterministic, honestly labeled) backs
   every worker profile, so the installed app demonstrates the ENTIRE loop —
   planning, parallel execution, validation catching a forced failure, retry,
   delivery, memory, failure reports, and a full evolution cycle promoting a
   skill v2 — with zero setup. Ollama is auto-detected for real local models;
   an Anthropic key (vault-encrypted) upgrades the planner/mutator. Routing is
   profile rows in `definitions/profiles/models.json`, as designed.

Proof: `npm run smoke` boots the real engine over the real WebSocket bridge
and asserts the full loop, including kill-switch freeze and checkpoint resume.
Everything below remains the operative vision and roadmap.

---

## 1. The vision (in the user's words, distilled)

NeuralScope is a **living cognitive environment**: a self-evolving multi-agent
system with extreme security and a strong codebase that makes small local LLMs
work in coordinated sets at human-level efficiency and precision. It runs on the
user's machine with deep access, does real work (builds apps, code, websites,
whole neural nets; fills Google Docs; researches; eventually builds brands, SaaS
products, online shops), learns and improves itself, and over time becomes a
**digital workforce** the user mostly just monitors — and that eventually earns
for them.

The user described it as "soon to be a brain that I talk to. It works for me."
The honest engineering framing we aligned on: this is achievable as a *graded,
audited, reversible* system that earns autonomy over months — not a system handed
unsupervised control of real-world consequences on day one.

### The 3D World concept
One persistent space-like environment with **three territories**:
- **Main** — the permanent, accumulating cluster of self-evolving circuits, working 24/7.
- **Testing** — where Evolver Blocks run cloned circuits, mutate/compete, and approve improvements before they touch Main.
- **One-Time** — ephemeral jobs (build a thing, deliver, destroy; no learning kept).

A **globe** surrounds all three (the system boundary); connectors sit on its shell
as gates to the outside world; security is the shell.

### The visual vocabulary (from the user's reference image)
- Red spheres = worker models (LLMs)
- Green slabs = skills (markdown capability files)
- Blue rays = code structure / scaffolding
- Turquoise frames = transparency blocks (audit/analysis)
- White wireframe spheres = security cycles (focus/reboot)
- Green polyhedra (large) = Evolver Blocks (the architects)
- Thin red threads = failure/analysis reports flowing to Evolvers
- A **circuit** = one objective's living structure; hundreds form a cluster.

---

## 2. The architecture (decided)

### Two halves, one rule
- **Engine** (backend) does all work; broadcasts every action as a JSON event.
- **World** (3D frontend) renders the event stream; sends commands back.
- **The rule:** the World never does work. This separation lets either side be
  rebuilt without breaking the other.

### Five layers (events flow up, commands flow down, no layer skips a layer)
1. **Gates / Connectors** — local LLMs (Ollama), API models, Google Docs/Drive, web APIs, filesystem, memory. Each behind a permission gate.
2. **Runways / Execution Runtime** — worker processes, sandboxed code execution, validators, retry/reboot, skill injection, timeouts.
3. **Tower / Orchestrator** — objective compiler, task-graph scheduler, environment manager, security gatekeeper, evolution manager, governor.
4. **Bridge / Event Bus** — one WebSocket; every Engine action = one JSON event; commands return down the same pipe.
5. **World / 3D Frontend** — three.js scene, inspector panels, reshape controls. Renders only.

### The airport metaphor (shared language with the user)
Tower = Orchestrator · Flight plan = task graph · Pilots = worker models ·
Training manuals = skills · Black box = transparency blocks · Airport security =
security cycles · Engineering bay = Evolver blocks · Hangar = Testing env ·
Charter flight = One-Time env · Gates = connectors · Cargo warehouse = memory ·
Departures board = the 3D world.

---

## 3. How each block works (resolved)

### Objective → flight plan
User gives a plain-language objective. The **Objective Compiler** (one call to the
strongest model) turns it into task-graph JSON: goal restated, success criteria,
steps as a dependency graph (independent steps parallelize), worker profile +
skills + allowed connectors per step, a risk rating, and target environment.
**This JSON literally IS the circuit shown in 3D** — steps are nodes, `depends_on`
edges are the lines.

### Workers (red spheres)
A worker is NOT a model — it's a disposable runtime wrapping a model call-loop:
chosen model (local via Ollama or API, hot-swappable) + injected skills + scoped
tools + step budget/timeout + required output schema. Booted on demand, torn down
after the step. Intelligence lives in the structure, not the worker.

### Skills (green slabs)
Markdown files in `definitions/skills/` with instructions, examples, checklists,
known failure patterns. Editable live (next worker boot picks up changes),
rewritable by the Evolver, versioned in git.

### Code structure / scaffold (blue rays)
Deterministic (non-AI) code around every worker: input parsing, output validation,
retry loops, step decomposition, checkpointing. **This is where most reliability
comes from.** A small LLM is a brilliant unreliable intern; the scaffold is the
SOP that makes their work shippable.

### Transparency blocks (turquoise)
Every action emits a structured event recorded with inputs/outputs/timing/cost and
exact blob hashes. Three views: live summaries (for the inspector), full trace
(black box, replayable), analysis reports (pattern-spotting → Evolver feed).

### Security cycles (white spheres) — three rings
- Ring 1 (per step): connector/path/command allow-list gatekeeping.
- Ring 2 (per worker): drift detection → reboot with re-grounded objective.
- Ring 3 (per environment): human approval gates on irreversible actions.
Plus the global kill switch.

### Evolver blocks (green polyhedra) — six phases
Capture worst-scoring structure → decompose (pull real failed tasks as replay set)
→ mutate (2–5 hypothesis-driven rewrites) → trial (vs incumbent in mocked sandbox)
→ score & gate (must beat by a margin, zero safety regressions) → promote (git
commit + registry flip; losers archived as data). One structure per cycle. Runs
nightly or every N objectives. **Evolves definitions, never model weights.**

### Three environments (in code)
- **Main** = registry of promoted/versioned `stable` structures + long-running circuits. Only the Evolver's promote step writes here.
- **Testing** = sandboxed runtime copy; candidates run against recorded replay tasks; all write-connectors mocked.
- **One-Time** = a job with `persist: false`; temp folder; outputs delivered; memory writes discarded.

---

## 4. The autonomy systems (what makes processes complete without a human)

Discussed as the path to ~99% autonomous. In rough priority:
1. **Verification stack** (≈60% of autonomy) — syntax/functional/behavioral checks + adversarial review + final re-check against original success criteria. Autonomy dies from *not noticing* failure, so replace the human-as-detector.
2. **Recovery engine** — escalation ladder: retry → reboot → stronger model → re-decompose → re-plan branch → re-plan from checkpoint. Root-cause diagnosis before retrying.
3. **Long-horizon state** — per-objective project-state file, hierarchical summarization, periodic re-anchoring to the original objective.
4. **Assumption engine + preference model** — log explicit assumptions for ambiguity; the preference model learns the user's taste from every approval/rejection/edit and lets validators ask "would the user accept this?" This is what genuinely replaces the human in the loop.
5. **Capability coverage** — browser automation, deployment pipelines, credential vault, comms connectors, sandboxed VM, live web research.
6. **Governor** — meta-watchdog for stuck loops, runaway cost, anomalies, budget breaches.
7. **Simulation-before-action** — mock irreversible actions, diff predicted vs intended outcome, fire only on match; trust ledger auto-promotes/demotes capabilities.

**Honest ceiling:** ~99% of steps autonomous; residual ~1% (account ownership,
payments, genuinely novel situations, irreversible-action sign-off) stays human by
design — structural, not an engineering failure.

---

## 5. The eight load-bearing questions (resolved)

1. **File management** — files+DB principle; definitions in git, data in SQLite + content-addressed blobs; see repo layout in CLAUDE.md.
2. **Evolution** — six-phase file-rewriting loop with proof gates (above).
3. **Security** — three rings + four tiers + kill switch; NEW front is prompt injection via the screen (eyes/hands) — defended by content/instruction separation, action-origin checks, allow-listed surfaces, anomaly watcher, and a no-go map.
4. **Analysis** — procedures: fully transparent. Inside an LLM: behavioral (full) + probabilistic/logprobs (yes for local) capturable; activations (advanced, later); causal "why" (impossible for anyone). Don't depend on the impossible tier for safety.
5. **Clean setup** — one repo, five packages = five layers, dependency rule enforced, one boot command, stateless restart-resume.
6. **Google Sheets/Docs** — OAuth tokens encrypted in vault; work against a local mirror; gated reversible write-back; per-objective scoped access; mocked in Testing.
7. **Small LLMs at human level** — five compounding techniques: decomposition, skills, validation loops, role specialization (incl. adversarial critic), routing/escalation. Earned per task class; ~20%→80-90% on classes you've built for.
8. **Auto-boot + circuits** — Ollama serves models, profiles are registry rows, lazy boot within VRAM budget; the flight-plan graph IS the circuit; data flows as blob references along validated edges.

### The ten that bite later (also resolved in the engineering doc)
9. State/concurrency/"never resets" — only the Tower writes shared state, serialized; checkpoints; bounded concurrency.
10. Cost/hardware/speed — VRAM caps concurrency; per-objective token+$+time budgets; speed comes from parallelism + never sleeping.
11. Failure/rollback/regression — git commits, canary + auto-rollback, failed objectives are fuel.
12. Secrets — encrypted vault, scoped time-limited grants, credentials never in context.
13. Versioning/time-travel — git + append-only + content addressing = reconstruct any past state.
14. Event contract/schema drift — frozen versioned schema, validate on emit+receive, additive-only, loud version mismatch.
15. Testing a self-changing system — frozen regression suite the Evolver can't touch, mocked Testing env, safety code is never an evolvable definition.
16. Context windows — retrieval + hierarchical summarization + project state files, not stuffing.
17. Observability 24/7 — Governor + daily self-written plain-English report + alerts only when needed.
18. The 100% ceiling — ~99%; the rest is a door we keep a hand on.

---

## 6. What's already built (in `/artifacts`, reuse don't rebuild)

- **`neuralscope.jsx`** — the 3D World prototype (React + three.js). Three
  territories, procedurally-grown circuits, click-to-inspect inspector, pause/
  resume, live counters. Currently simulated data; becomes the real World once
  wired to the bridge. Next visual step: globe shell, refined geometry, the
  evolver capture→promote animation, level-of-detail zoom into nodes.

- **`embodiment-cluster/`** (zipped) — working Python package implementing the
  Embodiment Cluster (eyes + hands). Modules: `eyes.py` (screen capture +
  coordinate mapping), `hands.py` (mouse/keyboard actuation via safety gate),
  `safety.py` (dry-run gate, triple-ESC + corner kill switch, freeze flag),
  `loop.py` (perceive→think→act loop using the computer-use API; has marked
  extension points for verification + recovery), `event_bus.py` (the event
  stream), `cluster.py` (the public object the Tower boots). Dry-run tested
  end-to-end (loop terminates on DONE, gate blocks real actuation, coordinate
  mapping verified). This is the Layer-1 `embodiment` connector. Phase 2 (skills)
  and Phase 3 (full security layer, visualized) build on top.

- **`neuralscope-blueprint.html`** — the master architecture document (airport
  metaphor, five layers, boot sequence, life-of-an-objective, evolution cycle,
  security tiers, event contract, honest physics, 7-day plan, roadmap, glossary).

- **`neuralscope-engineering-decisions.html`** — the 18-question engineering
  reference (the eight + the ten that bite later), with diagrams.

---

## 7. Roadmap beyond the 7-day slice

- **Weeks 1–2 — Working Organism:** the slice hardened; recurring circuits; 10+ skills; nightly evolution; daily objective delivery.
- **Month 1–2 — Department:** multi-objective concurrency; browser automation; email drafting (Tier C); multi-day projects; first C→B graduations; system files its own improvement ideas for approval.
- **Month 3–4 — Studio:** end-to-end product builds with gated approvals; first revenue experiments (user owns accounts/payments).
- **Month 5+ — The Company You Monitor:** most capabilities at Tier A/B with clean records; daily report + handful of gated decisions; Evolver has rewritten most skills several times.

---

## 8. Immediate next actions

1. **User sign-off** on three decisions: file layout, evolvable-vs-never line, permission tiers + no-go map.
2. **Day 1 build:** Engine skeleton (`engine/` packages), event bus, WebSocket bridge, freeze the event schema in `definitions/schema/`, wire the existing 3D prototype to render real raw events.
3. In parallel: keep the Embodiment Cluster as the reference `embodiment` connector; do not wire it live until Phase-3 security + tiers are confirmed.

### Event vocabulary to formalize in the schema (starting set)
`objective.created` · `plan.compiled` · `worker.booted` · `step.progress` ·
`validation.passed` · `validation.failed` · `security.check` ·
`security.gate.waiting` · `worker.rebooted` · `objective.completed` ·
`evolver.cycle.*` · `memory.written` · `memory.decayed` · `connector.added` ·
`connector.down`
Embodiment subset: `perception.captured` · `perception.described` ·
`intent.formed` · `action.executed` · `action.dryrun` · `action.blocked` ·
`verify.checked` · `loop.step` · `loop.done` · `safety.kill`

Commands (World → Engine): `objective.create` · `circuit.pause` · `skill.edit` ·
`memory.inject` · `experiment.promote` · `gate.approve` · `embodiment.kill`.
