"""
NeuralScope · Embodiment Cluster · Configuration
Phase 1: the system. Phase 2: skills. Phase 3: full security layer.
"""
import os

# ---- Model / API ----
MODEL = "claude-sonnet-4-6"                # current computer-use capable model
BETA_HEADER = "computer-use-2025-11-24"    # latest computer-use beta
TOOL_TYPE = "computer_20251124"            # enhanced action set
MAX_TOKENS = 2048

# ---- Perception ----
# Screenshots are downscaled so the long edge <= this before being sent to the
# model; model coordinates are mapped back to native pixels by Hands.
MAX_LONG_EDGE = 1366

# ---- Loop ----
MAX_STEPS_DEFAULT = 40          # hard ceiling per objective
STEP_DELAY_S = 0.6              # settle time after each action before screenshot

# ---- Safety scaffold (minimal, phase-1; full layer arrives in phase 3) ----
DRY_RUN_DEFAULT = True          # first runs never touch the real mouse
KILL_KEY_TAPS = 3               # tap ESC this many times within KILL_WINDOW_S
KILL_WINDOW_S = 1.0
FAILSAFE_CORNER = True          # slam cursor to top-left corner = instant abort

# ---- Bridge (events → 3D world) ----
EVENT_LOG_PATH = os.path.expanduser("~/.neuralscope/events.jsonl")
WS_HOST = "127.0.0.1"
WS_PORT = 8765

# ---- Identity ----
CLUSTER_ID = "EMBODIMENT-01"
