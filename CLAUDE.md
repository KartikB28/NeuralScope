# CLAUDE.md — NeuralScope

> Read automatically at the start of every session. This is the operating
> manual; `PROJECT_CONTEXT.md` holds the full vision and history.

## What this is

NeuralScope = **Engine** (Node/TypeScript backend: objectives → task graphs →
validated multi-agent execution → memory → self-evolution) + **World** (three.js
3D frontend rendering the live event stream) + a thin **Electron shell** for the
downloadable desktop app. The v0.1 vertical slice is BUILT and passing its
end-to-end smoke test: plan → parallel steps → validation failure → retry →
delivery → episodic memory → failure report → evolution cycle promoting a
skill v2 → kill switch → resume.

## Stack decision (supersedes the original Python plan)

The blueprint originally said Python+FastAPI. When the goal became **a
downloadable, double-click desktop app**, we pivoted to a single runtime:
TypeScript everywhere (engine = pure Node, no Electron imports; world = Vite +
React + three; shell = Electron; installers = electron-builder + GitHub
Actions). One language, one installer, no Python-env pain for end users. All
architecture principles carried over unchanged. The Python embodiment cluster
stays vendored in `reference/` for the future Tier-D connector (subprocess).
State is JSON/JSONL files behind a registry class shaped row-like so a SQLite
swap-in later is mechanical, not architectural.

## Hard rules (do not violate without explicit user sign-off)

1. **No layer skips a layer.** World → Bridge → Tower → Runtime → Connectors.
   The World never does work; workers never draw; the Tower never executes —
   it asks the Runtime.
2. **Every Engine action = one contract event.** The schema
   (`definitions/schema/events.v1.json` + `engine/src/contract.ts`) is FROZEN
   at v1: additive changes only, validated on emit and receive, never
   repurpose a type. Update both files together.
3. **Evolvable vs never-evolvable.** Evolvable: skills, prompts, validator
   heuristics, routing profiles. NEVER: security rings, tiers, the no-go map,
   the kill switch (`engine/src/tower/security.ts` carries the banner).
4. **Graded autonomy, earned not granted.** Tiers A/B/C/D per tool call
   (`Connector.tierFor`). New capabilities start at the most restrictive
   plausible tier. Money/accounts/credentials stay Tier D.
5. **Credentials never enter model context.** Secrets → `Vault` only. The
   snapshot exposes `hasAnthropicKey`, never the key.
6. **Models propose, deterministic code disposes.** Workers return schema'd
   JSON; the scaffold performs all side effects through gated connectors.
   Keep it that way — it is both the reliability story and the injection
   blast-radius story.
7. **Every change is reversible.** Skills are versioned files + registry
   pointer; promotions archive their losers; events are append-only.
8. **Be honest about the physics.** The demo engine is labeled a demo. Cost
   figures are estimates. Behavioral transparency, not neural mind-reading.

## Repo map (actual)

```
engine/src/contract.ts        the frozen event/command contract + shared types
engine/src/bus.ts             validate → events.jsonl → fan out
engine/src/registry.ts        registry rows + skill versioning + Vault
engine/src/server.ts          ws bridge + static world + read-only inspector APIs
engine/src/tower/             tower.ts (boot/commands/snapshot) · compiler.ts ·
                              scheduler.ts (DAG + governor) · security.ts ·
                              transparency.ts · memory.ts · evolver.ts
engine/src/runtime/           worker.ts (the scaffold loop) · validators.ts
engine/src/connectors/        filesystem.ts (workspace-scoped) · web.ts (GET+allowlist)
engine/src/models/            demo.ts · ollama.ts · anthropic.ts · router.ts (profiles)
world/src/                    bridge.ts (store) · scene.ts (3D) · ui.tsx · App.tsx
desktop/                      main.ts (boots engine in-process) · preload.ts
definitions/                  skills/ profiles/ connectors/ schema/ — factory
                              defaults, seeded to ~/.neuralscope on first boot
scripts/                      build.mjs · smoke.mjs (e2e proof) · make-icon.mjs
```

## Commands

```bash
npm run build       # esbuild engine+desktop, vite world, icon
npm run typecheck   # all three tsconfigs
npm run smoke       # END-TO-END PROOF — keep this green, always
npm run engine      # headless engine + browser world at :43117
npm run app         # desktop app (after build)
npm run dist        # installers for the current OS → release/
# ship downloads: git tag v0.1.x && git push origin v0.1.x  (release.yml builds all OSes)
```

## How to work here

- **Keep `npm run smoke` green.** It boots the real engine over the real
  bridge and asserts the whole loop including evolution and the kill switch.
  Extend it when you add behavior; it has already caught three real bugs.
- Adding an event type: `contract.ts` (type + EVENT_TYPES set) and
  `definitions/schema/events.v1.json`, then a renderer mapping in
  `world/src/scene.ts`/`bridge.ts`. Additive only.
- Adding a connector: implement `Connector` (incl. `tierFor` — think no-go
  first), register in `tower.ts` boot, add a manifest row, default to the
  most restrictive tier.
- Adding a worker profile: charter in `runtime/worker.ts` ROLE_CHARTERS, route
  in `definitions/profiles/models.json`, demo template in `models/demo.ts` so
  the zero-setup path keeps working, structural checks in `validators.ts`.
- Prefer editing a definition file over hard-coding. A model name, prompt, or
  threshold in code is a smell — it belongs in `definitions/`.
- Engine code must stay Electron-free (it runs headless; the shell imports it).

## State of play / near-term roadmap

Done (v0.1): everything above. Next, in blueprint order: recurring circuits
(cron-like watchers) · Google Docs connector via OAuth (mocked in Testing) ·
sandboxed code execution for validators (Node permission model; ships OFF) ·
tier graduation ledger (C→B on clean records) · SQLite registry swap ·
embodiment cluster behind its Phase-3 review.
