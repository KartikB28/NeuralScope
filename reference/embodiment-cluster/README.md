# Embodiment Cluster — NeuralScope

Eyes and Hands for the brain. A self-contained cluster that gives NeuralScope
real perception of and control over a computer: it sees the screen, moves the
cursor, types, runs shortcuts — anything a human can do at the keyboard — and
broadcasts every action as an event the 3D world renders.

This is **Phase 1: the system**. Phases 2 (skills) and 3 (full security layer,
visualized in the GUI) build on top without restructuring this.

## The organs

| File | Organ | Job |
|---|---|---|
| `eyes.py` | **Eyes** | Capture the screen, downscale for the model, and map model coordinates back to native pixels. |
| `hands.py` | **Hands** | Execute mouse/keyboard actions — but only through the Safety gate, only after coordinate mapping. |
| `safety.py` | **Safety** | Phase-1 scaffold: kill switch (triple-ESC / corner failsafe), dry-run gate, global freeze. |
| `loop.py` | **Loop** | The heartbeat: perceive → think (computer-use API) → act → repeat until DONE. |
| `event_bus.py` | **Event Bus** | Every action = one JSON event → 3D world + black-box log. The only channel out. |
| `cluster.py` | **Cluster** | Wires it all together; the object the Tower boots. |

## The cycle

```
  ┌─ EYES capture screen ──► downscale ──► model-space image
  │                                              │
  │                                       LOOP think (API)
  │                                              │
  │                                    action {click @ x,y}
  │                                              │
  │                                   SAFETY gate ─► dry-run? visualize only
  │                                              │   live? ▼
  │                                    EYES map coords ─► native px
  │                                              │
  │                                     HANDS actuate OS input
  │                                              │
  └──────────────── re-capture, feed back ◄──────┘   until DONE / kill / ceiling
```

## Safety, up front

Moving a real cursor with no abort is how a debug session deletes a folder. So
even Phase 1 ships with:

- **Dry-run by default** — actions are visualized, nothing physically moves.
- **Kill switch** — triple-tap ESC within 1s, or slam the cursor to the top-left
  corner. Both freeze everything instantly.
- **Explicit live opt-in** — `go_live()` refuses unless kill listeners are armed,
  and `run_live.py --live` requires a typed confirmation.

The *full* security layer — no-go screen zones, per-action permission tiers,
prompt-injection screening on what the screen "tells" the model, takeover
detection, all rendered as gates in the 3D world — is Phase 3, as planned.

## Run it

```bash
# Dry-run proof — needs nothing but Python stdlib, runs anywhere:
python test_dryrun.py

# Live (real machine):
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...
python run_live.py "take a screenshot and tell me what's open"      # dry-run
python run_live.py --live "open notes and type hello"               # actuates
```

## How it plugs into NeuralScope

The Tower boots `EmbodimentCluster` when a flight plan requests the `embodiment`
connector. `cluster.subscribe(fn)` hands every event to the world-bridge
WebSocket. The marked extension points in `loop.py` are where the verification
stack and recovery ladder (the autonomy systems) attach in later phases — no
rewrite, just hooks.

## Event vocabulary (contract with the 3D world)

`perception.captured` · `perception.described` · `intent.formed` ·
`action.executed` · `action.dryrun` · `action.blocked` · `verify.checked` ·
`loop.step` · `loop.done` · `safety.kill`
