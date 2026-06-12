"""
Embodiment · SAFETY SCAFFOLD (phase-1 minimal)

This is NOT the full security layer (that is phase 3: no-go zones, tier gates,
takeover detection, prompt-injection screening, all visualized in the GUI).
This is the minimum required to safely DEVELOP a thing that moves your cursor:

  - kill switch        : 3x ESC within 1s, OR cursor slammed to top-left corner
  - dry-run gate       : actions are logged + visualized but NOT physically executed
  - global freeze flag : checked before every single action

Everything here is intentionally dumb and reliable. The clever safety lives in
phase 3; this just guarantees we can always stop.
"""
import threading, time
from . import config


class Killed(Exception):
    """Raised to unwind the agent loop the instant a stop is requested."""


class Safety:
    def __init__(self, bus, dry_run=config.DRY_RUN_DEFAULT):
        self.bus = bus
        self.dry_run = dry_run
        self._frozen = threading.Event()
        self._esc_times = []
        self._listener = None

    # ---- the gate every action passes through ----
    def check(self):
        if self._frozen.is_set():
            raise Killed("global freeze active")

    def gate_action(self, action, coords=None, key=None):
        """Return True if the action may physically execute, False if dry-run."""
        self.check()
        if self.dry_run:
            self.bus.emit("action.dryrun", action=action, coords=coords, key=key)
            return False
        return True

    # ---- triggers ----
    def kill(self, source="manual"):
        self._frozen.set()
        self.bus.emit("safety.kill", source=source)

    def reset(self):
        self._frozen.clear()
        self._esc_times.clear()

    @property
    def frozen(self):
        return self._frozen.is_set()

    # ---- hardware kill listener (optional dep) ----
    def start_listener(self):
        try:
            from pynput import keyboard, mouse
        except Exception:
            self.bus.emit("perception.described",
                          summary="pynput unavailable; kill via API only", elements=[])
            return

        def on_press(k):
            try:
                from pynput.keyboard import Key
                if k == Key.esc:
                    now = time.time()
                    self._esc_times = [t for t in self._esc_times if now - t < config.KILL_WINDOW_S]
                    self._esc_times.append(now)
                    if len(self._esc_times) >= config.KILL_KEY_TAPS:
                        self.kill(source="triple-esc")
            except Exception:
                pass

        def on_move(x, y):
            if config.FAILSAFE_CORNER and x <= 1 and y <= 1:
                self.kill(source="corner-failsafe")

        kl = keyboard.Listener(on_press=on_press)
        ml = mouse.Listener(on_move=on_move)
        kl.daemon = ml.daemon = True
        kl.start(); ml.start()
        self._listener = (kl, ml)
