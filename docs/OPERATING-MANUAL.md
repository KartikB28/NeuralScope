# NeuralScope — Operating Manual

How to drive NeuralScope, panel by panel and action by action. No background
needed. If you haven't installed it yet, start with the
**[Download & Install Guide](DOWNLOAD-GUIDE.md)**.

---

## The one idea that explains everything

NeuralScope is two halves:

- **The Engine** does all the work — it takes your objective, breaks it into
  steps, runs AI workers through them, checks the results, and saves what it
  learns.
- **The World** (the 3D screen) is a live window into the Engine. Every shape
  you see is a real, running thing. Clicking a shape shows its real state;
  pausing it pauses the real work.

The World never does work itself, and it never invents anything — it only
shows you what the Engine is actually doing. That's why nothing on screen is
ever fake.

---

## Starting up

Open NeuralScope. You land in the 3D world with a one-time welcome card that
walks you through the three first moves. Dismiss it with **ENTER THE WORLD**.

The small dot next to the NEURALSCOPE title is your connection light:
**green** = the Engine is connected and live, **red** = reconnecting (it
retries on its own).

---

## A tour of the screen

**Top bar (left → right)**
- **NEURALSCOPE** title + the green/red connection dot.
- **MAIN · TESTING · ONETIME** — the three territories (explained below).
  Clicking one flies the camera to it.
- **APPROVALS** — appears with a number badge only when something is waiting
  for your decision.
- **SKILLS · MEMORY · SETTINGS** — open the three management panels.
- **◼ KILL** — the global stop button (turns into "FROZEN — RESUME" once
  pressed).

**Objectives panel (left)** — every objective you've filed, newest first,
with a live status chip, a progress bar, and per-objective buttons (view,
pause, resume, open output, cancel).

**Command bar (bottom)** — where you type what you want done. The **✦** button
shows ready-made examples; the dropdown picks the territory; **RUN ▸** starts it.

**Inspector (right)** — appears when you click any shape in the 3D world.
Shows that thing's real details and its controls.

**Ticker (bottom strip)** — a live feed of what just happened.

**Legend (bottom-right)** — what each shape and color means.

**Mouse / touch:** drag to orbit · scroll or pinch to zoom · click any shape
to inspect it.

---

## Filing your first objective

1. Type a plain-language goal in the command bar, for example:
   *Build a one-page website for a cozy bakery called Amber Crumb.*
   (Or press **✦** and pick an example.)
2. Leave the territory on **main** for now.
3. Press **RUN ▸**.

A seed appears in the 3D world and immediately grows into a **circuit** — one
node per step, lines for dependencies. That shape *is* the plan the Engine
compiled. You'll watch workers ignite on each step, checks run, and the
circuit settle when it's done. The objective also shows up in the left panel
with a live progress bar.

When it finishes, click **open output** on its card to see the result (the
desktop app opens the folder; in a browser it opens the file).

### Want to see it recover from a failure?

Run the example that starts with `[demo-fail]`. The first build attempt is
broken on purpose — you'll watch validation catch it, an adversarial critic
flag the exact problem, the retry fix it, and a red "report thread" fly to the
Evolver. That's the reliability machinery earning its keep, live.

---

## Reading the 3D world

| Shape | What it is |
|---|---|
| **Octahedron node** | one step of a circuit (color = status: dim blue pending, cyan ready, **red running**, white done, dark-red failed) |
| **Green slab** | a skill (a markdown manual) attached to a step |
| **Blue rays** | the deterministic code scaffolding around a worker |
| **Turquoise frame** | the transparency block recording everything |
| **White wire sphere** | a security cycle orbiting the circuit |
| **Green giant (icosahedron)** | an Evolver — the architect that rewrites skills |
| **Amber gem** | an approval gate waiting for your click |
| **Violet crystal** | a memory |
| **The faint outer sphere** | the globe — the system's boundary; connectors sit on its shell |

Click any of them to open the Inspector. For a step or a circuit, the
Inspector has a **black box trace** button that shows every prompt, response,
tool call, and validation the Engine recorded — the complete behavioral record.

---

## Controlling work in flight

On each objective card, or in the Inspector:

- **Pause / Resume** — freezes just that circuit. Running steps finish; no new
  ones start until you resume.
- **Cancel** — stops the objective for good.
- **View** — flies the camera to that circuit.
- **Open output** — opens the delivered files.

---

## Approvals (the amber gates)

Some actions are too consequential to do without you — for example, fetching a
web page from a site that isn't on your allow-list. When that happens, the
Engine **pauses and waits**: an amber gem appears on the circuit, the
**APPROVALS** button shows a badge, and a notification slides in.

Open **APPROVALS** (or click the amber gem) to see exactly what's being
requested, then **APPROVE** or **DENY**. Nothing irreversible happens without
this click. (Capabilities you approve repeatedly can later earn the right to
run without a gate — see "Earned autonomy" in the
[Features Manual](FEATURES.md).)

---

## The kill switch

The big red **◼ KILL** button — or the keyboard shortcut **Ctrl/Cmd + Shift +
K** — instantly freezes every worker, closes every gate, and snapshots the
state. The whole world greys out with a FROZEN banner.

Nothing runs while frozen, and every command is refused except resume.
Press **RESUME THE ENGINE** (or the shortcut again) to thaw — interrupted
objectives pick up from their last checkpoint. The kill switch is yours alone;
the system can never override it.

---

## Settings

Open **SETTINGS** from the top bar.

- **Anthropic API key** — paste a key for frontier-grade planning. Stored
  encrypted on your machine; never displayed, never placed in work prompts.
  Pick the model too (Sonnet is the balanced default).
- **Ollama URL** — for free local models. If Ollama is running, you'll see a
  green "detected" line listing your installed models. Install models with
  `ollama pull <name>`.
- **Parallel workers** — how many steps run at once (1–8). Higher is faster
  but uses more memory/VRAM.
- **Run evolution every N objectives** — how often the system tries to improve
  its own skills automatically. Set **0** to only run it by hand.
- **Autonomy graduation** — how many clean approvals a capability needs before
  it earns a lighter permission tier.
- **Web allow-list** — domains the system may read freely. Anything else
  raises an amber gate.
- **Google Docs** — connect your own Google account so the system can read and
  fill in documents (see below).
- **Recurring circuits** — schedule an objective to repeat on its own (see
  below).
- **Data** — shows your data folder, with an "open folder" button.

Changes apply to the next worker that boots — work already running finishes on
the old settings, so there are no mid-flight surprises.

---

## Skills — the training manuals

Open **SKILLS**. Each skill is a markdown manual the workers read before they
act (research, copywriting, front-end build, report writing, QA). For each you
see its version, a pass-rate, and a **canary** tag if it's a brand-new version
still on probation.

Click one to edit it live. **Save as new version** and every worker booted
from that moment uses your edit; running workers finish on the old one. Every
version is kept, so you can always go back. (The Evolver edits these too — see
the Features Manual.)

---

## Memory

Open **MEMORY**. The system keeps short summaries of completed work and uses
them to plan future objectives better. Memories fade if they go unused and are
eventually swept away. You can **inject** a memory yourself — for example,
*"The user prefers serif fonts and warm colors on all sites"* — and the
planner will take it into account.

---

## Evolution — the system improving itself

Click the **green giant** in the 3D world (or rely on the automatic schedule
in Settings) and press **RUN EVOLUTION CYCLE NOW**. The Evolver:

1. picks the skill with the worst recent track record,
2. writes improved versions of it,
3. trials them against real recorded failures in the **Testing** territory,
4. promotes a winner — but only as a **canary** (on probation).

A canary has to prove itself on real live work. If it does better, it becomes
the permanent version. If it regresses, the system **rolls it back
automatically** and tells you. Every change is a new file, always reversible.

---

## The three territories

- **MAIN** — your permanent world. Completed circuits stay, memory
  accumulates, improvements compound. This is where you normally work.
- **TESTING** — the proving ground. The Evolver trials candidate skills here
  against recorded reality; nothing here can touch your real files or accounts.
- **ONE-TIME** — for throwaway jobs. The output is delivered, then the circuit
  dissolves and keeps no memory. Choose it in the command bar's dropdown.

---

## Recurring circuits (the world never sleeps)

In **Settings → Recurring circuits**, give an objective and an interval (in
minutes). The Engine will file that objective on its own, on schedule, for as
long as the app runs — and it won't pile up runs if a previous one is still
going. Remove it any time. This is how NeuralScope keeps working between your
visits.

---

## Google Docs

In **Settings → Google Docs**: paste your own Google OAuth "Desktop app"
client id and secret (created free at console.cloud.google.com with the Docs
API enabled), **Save**, then **Connect** — a browser window opens for you to
approve. After that, objectives can read and append to your documents.
Safeguards: every write snapshots the document first (so it's reversible), and
trial runs in the Testing territory only ever touch a local copy.

---

## Troubleshooting

- **Connection dot is red.** The Engine is restarting; it reconnects on its
  own within a few seconds. If it persists, quit and reopen the app.
- **"Ollama not detected."** Make sure Ollama is installed and running
  (`ollama serve`), then reopen Settings. The default address is
  `http://127.0.0.1:11434`.
- **An objective failed.** Open its card → **view**, click the failed (dark
  red) step, and read the **black box trace** to see exactly what happened.
  Failures are normal fuel — they become reports the Evolver learns from.
- **Google Docs won't connect.** You need your *own* OAuth client id+secret
  saved first; the Connect button stays disabled until they are.
- **Everything is grey / FROZEN.** The kill switch is engaged — press
  **RESUME THE ENGINE**.

---

For the full catalogue of what NeuralScope can do and how each system works,
see the **[Features Manual](FEATURES.md)**.
