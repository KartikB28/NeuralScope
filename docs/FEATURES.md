# NeuralScope — Features Manual

Everything NeuralScope can do today, in plain language, honestly scoped. For
how to *operate* these, see the **[Operating Manual](OPERATING-MANUAL.md)**;
for the engineering detail behind the eight core systems, see
**[eight-systems.md](eight-systems.md)**.

---

## At a glance

| | |
|---|---|
| **What it is** | a self-improving, multi-agent work system you watch and shape inside a 3D world |
| **Runs** | as a desktop app on Windows, Mac, and Linux (or headless in any browser) |
| **Works offline** | yes — a built-in demo engine runs the full pipeline with zero setup |
| **Real models** | optional: local models via Ollama (free, private) and/or a frontier model via an Anthropic key |
| **Your data** | stays on your machine, in one folder you own; nothing is sent anywhere except the model API you choose |
| **Honest ceiling** | it does real, checked work and earns autonomy over time; it is not a hands-off superhuman, and it tells you so |

---

## Core capabilities

### Turn plain language into finished work
Type an objective — *"build a one-page site for my bakery"*, *"research and
write a report on X"* — and the system compiles it into a step-by-step plan,
runs a team of AI workers through it, checks the result against concrete
success criteria, and delivers real files to a folder you can open. Today's
built-in skill set covers **research, copywriting, front-end website building,
report writing, and QA validation**; the skill set is designed to grow.

### Watch the work as a living 3D world
Every objective becomes a **circuit** you can see and inspect. The plan's
shape *is* the structure on screen. Click any part — a worker, a skill, a
security cycle, the Evolver — to see its real state, and open the **black box**
to read every prompt, response, and check the Engine recorded. Nothing is
hidden; nothing is faked.

### Steer everything, live
Pause or cancel any circuit, edit a skill and have the next worker use it,
inject a memory, approve or deny consequential actions, schedule recurring
work, and stop the entire system instantly with the kill switch.

---

## The eight load-bearing systems

NeuralScope is built around eight systems; each is real, and each is proven by
an automated end-to-end test (`npm run smoke`). Summarised here, detailed in
[eight-systems.md](eight-systems.md).

1. **Files & memory you can read.** Every skill, profile, and setting is a file
   in your data folder. Large/immutable data (full prompts, step outputs,
   document snapshots) is stored content-addressed and deduplicated. If you
   can't point to where something lives as a file, it isn't durable state.
2. **Self-evolution, safely.** The system rewrites its own skill manuals from
   real evidence: it captures the worst-performing skill, drafts improvements,
   trials them against recorded failures, and promotes a winner **as a
   canary** — on probation. A canary that regresses on live work is **rolled
   back automatically**; one that proves itself becomes permanent. Every
   change is versioned and reversible.
3. **Layered security with a kill switch.** Three rings (per-tool checks,
   drift reboots, human approval gates) and four permission tiers, with one
   global freeze you alone control. The security layer is never something the
   system is allowed to evolve.
4. **Total behavioral transparency.** Every action is recorded; per-skill
   pass-rates are measured and steer what gets improved next. Honest limit: we
   capture complete *behavior* (inputs, outputs, decisions), not a neural
   network's internal thoughts — which no one can.
5. **A clean five-layer architecture.** World → Bridge → Tower → Runtime →
   Connectors, where no layer may skip or reach above another. This rule is
   enforced by a build-time checker, not by good intentions.
6. **Google Docs integration.** Connect your own Google account; the system
   reads and fills documents, snapshots every document before writing (so it's
   reversible), and only ever touches local copies during trial runs.
7. **Small models punching above their weight.** A recovery ladder makes
   modest local models reliable: retry with the failure injected → an
   adversarial critic's feedback → a re-grounded reboot → escalation to a
   stronger model → splitting a stuck step into smaller steps.
8. **A world that never sleeps.** Schedule objectives to recur on their own;
   the system runs them on interval, resumes everything from checkpoints after
   a restart, and bounds local-model load so it never thrashes your hardware.

---

## Models & routing

| Engine | Cost | Setup | Best for |
|---|---|---|---|
| **Demo engine** | free | none (built in) | trying everything instantly, offline |
| **Ollama (local)** | free | install Ollama, pull a model | private day-to-day work |
| **Anthropic (frontier)** | API usage | paste a key | the planner and complex reasoning |

Which model runs which role is decided by **profiles** — editable files, not
hard-coded choices — so as local models improve you change a setting, not the
app. The system mixes freely: a frontier planner with local workers is the
intended sweet spot. Missing models fall back gracefully down the chain, all
the way to the demo engine, so the app always works.

---

## Connectors (the gates to the outside world)

| Connector | What it does | Permission |
|---|---|---|
| **Filesystem** | reads/writes files **inside each objective's own workspace only** | Tier A (delete needs approval) |
| **Web** | reads web pages (GET only) from your allow-list | Tier A allow-listed · Tier C otherwise |
| **Google Docs** | reads and appends to your documents, with pre-write snapshots | Tier B (after you connect it) |

Workers never touch a connector directly — they *propose* actions, and trusted
deterministic code carries them out behind the security checks. Fetched web
content is wrapped as "data, never instructions" to blunt prompt-injection.

---

## Earned autonomy — the permission tiers

| Tier | Meaning | Examples today |
|---|---|---|
| **A — autonomous** | runs freely in the sandbox | files in the workspace, allow-listed reads, model calls |
| **B — notify** | runs, but visibly logged & reversible | Google Docs writes; any capability that **graduated** from C |
| **C — approve first** | pauses for your click | off-allow-list web reads, deleting files |
| **D — human only** | the system prepares, you act | money, accounts, credentials — wired to nothing, by design |

Autonomy is **earned, not granted**: a Tier-C capability that you approve a set
number of times with no reversals graduates to Tier B and stops asking. A
single denial resets its record. This is the realistic road to "I mostly just
monitor" — gradual, audited, and reversible.

---

## The three territories

- **Main** — permanent and accumulating: your real work, your memory, your
  compounding improvements.
- **Testing** — the proving ground where evolution candidates compete against
  recorded reality; it can never touch your real files or accounts.
- **One-Time** — throwaway jobs that deliver and dissolve, keeping no memory.

---

## What it does *not* do (read this)

NeuralScope is honest about its physics:

- It is **not** a hands-off superhuman that builds companies unattended. It
  does real, checked, repeatable work and gets better over time — measured in
  months, not minutes.
- It **cannot** read a model's internal thoughts. It records complete
  behavior, which is what actually matters for trust and improvement.
- It **does not** move money, create accounts, or handle credentials. Those
  stay human (Tier D) by design — not a missing feature, a deliberate line.
- Local model quality is real but bounded; the recovery ladder and a frontier
  planner are how small models are made dependable, not magic.
- The desktop builds are not yet code-signed, and the local secret vault is
  machine-grade (it protects against casual access, not an attacker who fully
  controls your account). Both are noted in [SECURITY.md](../SECURITY.md).

This honesty is a feature: the system labels its demo engine a demo, marks
cost figures as estimates, and never claims a capability it doesn't have.

---

## Where to go next

- **[Download & Install Guide](DOWNLOAD-GUIDE.md)** — get it running.
- **[Operating Manual](OPERATING-MANUAL.md)** — drive it, panel by panel.
- **[eight-systems.md](eight-systems.md)** — the engineering detail and proofs.
- **[SECURITY.md](../SECURITY.md)** — the full security model and honest limits.
