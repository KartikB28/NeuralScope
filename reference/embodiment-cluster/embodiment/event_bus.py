"""
Embodiment · Event Bus
Every action the cluster takes emits exactly one event. The 3D world subscribes
to these and renders them. The on-disk JSONL log is the black box for replay
and for the Evolver. This is the ONLY way the cluster talks to the outside.
"""
import json, os, time, threading
from collections import deque
from . import config


class EventBus:
    def __init__(self, log_path=config.EVENT_LOG_PATH):
        self.log_path = log_path
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        self._subscribers = []          # list of callables(event_dict)
        self._lock = threading.Lock()
        self.recent = deque(maxlen=500)  # in-memory ring for inspector snapshots

    def subscribe(self, fn):
        self._subscribers.append(fn)

    def emit(self, etype, **data):
        evt = {
            "ts": round(time.time(), 3),
            "cluster": config.CLUSTER_ID,
            "type": etype,
            "data": data,
        }
        with self._lock:
            self.recent.append(evt)
            with open(self.log_path, "a") as f:
                f.write(json.dumps(evt) + "\n")
        for fn in self._subscribers:
            try:
                fn(evt)
            except Exception as e:      # a broken subscriber never stops the cluster
                print(f"[eventbus] subscriber error: {e}")
        return evt

    def snapshot(self):
        with self._lock:
            return list(self.recent)


# ---- Canonical event vocabulary (the contract with the 3D world) ----
# perception.captured   { w, h, scale }        -> Eyes node pulses, frame thumbnail
# perception.described  { summary, elements }  -> inspector text updates
# intent.formed         { action, target, why} -> Hands node lights, shows intent
# action.executed       { action, coords, key} -> cursor trail animates on screen-plane
# action.blocked        { action, rule }       -> red gate flashes, action refused
# action.dryrun         { action, coords }     -> ghosted cursor, nothing real moves
# verify.checked        { ok, reason }         -> green/red flash on the step
# loop.step             { i, of }              -> progress ring advances
# loop.done             { status, steps }      -> cluster settles / brightens
# safety.kill           { source }             -> everything freezes, red global node
