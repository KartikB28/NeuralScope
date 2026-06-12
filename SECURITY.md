# NeuralScope Security Model

This system runs AI workers with access to your machine. That access is
survivable because it is **graded, audited and reversible** — and because the
restraints below are hard-coded, versioned, and **never evolvable**. The
Evolver improves the system's work, never its own restraints.

## The three rings

**Ring 1 — per tool call.** Every connector invocation passes the gatekeeper:
is this connector in the step's compiled allow-list? Is the path inside the
objective's workspace? Is the domain on the web allow-list? Denials emit
`security.blocked` events; nothing fails silently.

**Ring 2 — per worker.** The scaffold watches for drift: repeated identical
outputs or a validation-failure streak triggers a reboot with a re-grounded
prompt (the original objective and success criteria restated). Events:
`worker.rebooted`.

**Ring 3 — per environment.** Tier-C actions pause at an amber gate in the
World and wait for your explicit click. Stale gates from a previous process
are denied loudly on boot, never honored.

## Permission tiers

| Tier | Meaning | current reality |
|---|---|---|
| **A — autonomous** | sandboxed work | fs read/write *inside the objective workspace*; GET on allow-listed domains; gdocs reads (mirrored); model calls |
| **B — notify** | autonomous but loudly visible | gdocs appends (with pre-write blob snapshots) · any capability that **graduated** from C |
| **C — approve first** | amber gate, waits for you | fs delete; GET on non-allow-listed domains |
| **D — human only** | the system prepares, you act | nothing wired. Money, accounts, credentials, sending as you — stays here |

**Graduation ledger (earned autonomy).** Every Tier-C capability has a row:
N consecutive clean approvals (default 25, `tierGraduationThreshold` in
Settings) graduates it to Tier B; a single denial resets the count to zero.
Graduations emit `capability.graduated` and are visible in Settings. The
ledger lives in the registry — auditable, and never evolvable.

## The no-go map (hard blocks, not gates)

- Any filesystem path outside the objective's workspace (including `..`
  traversal and absolute paths — rejected at the connector).
- Private/loopback network ranges from worker context.
- Any HTTP verb other than GET in v0.1.
- Credentials in model context: secrets live in the encrypted vault; workers
  ask trusted code to act and never see the secret. The Anthropic key is sent
  only to `api.anthropic.com` by provider code.
- The Embodiment Cluster (mouse/keyboard control, in `reference/`) is **not
  wired**. It ships dry-run-first with its own kill listeners and stays out
  until a dedicated security review (Phase 3 of the blueprint).

## The kill switch

`◼ KILL` in the top bar, Ctrl/Cmd-Shift-K, or the `system.kill` command:
aborts every worker mid-call, closes every gate (waiting approvals are
denied), checkpoints all circuits as paused, and rejects every command except
`system.resume` and `snapshot.request`. Resume is yours alone; interrupted
circuits restart from their last checkpoint.

## Honest limits (read this part twice)

- **The vault is local-grade.** Secrets are AES-256-GCM encrypted with a
  machine-derived key — protection against casual file reads and accidental
  copies, not against an attacker who fully controls your user account. That
  is the realistic ceiling for any local-only secret store.
- **Transparency is behavioral, not neural.** The black box records every
  prompt, response, tool call and validation — a complete record of behavior.
  It does not (cannot) record a model's internal reasoning.
- **Prompt injection is a real surface** once web content enters worker
  context. Mitigations: GET-only, allow-list-first, content stripped to text
  and wrapped in explicit `UNTRUSTED-WEB-CONTENT` envelopes ("data, never
  instructions"), and the deterministic scaffold — not the model — performs
  all side effects against schema-validated output, behind ring-1
  allow-lists. This shrinks the blast radius; it does not eliminate the
  surface. Treat the web allow-list as part of your security boundary.
- **Google Docs writes are reversible by construction**: every append
  snapshots the document to the content-addressed blob store first
  (`preImageBlob` in the tool result), and Testing-territory trials only
  ever touch a local mirror. Reverting is restoring a blob — but restoring
  is a human action in v0.x, not an automatic one.
- **Local server.** The engine binds `127.0.0.1` only. Anyone with local
  access to your machine can reach it; it has no auth of its own in v0.1.

Found a hole? Open an issue with the `security` label.
