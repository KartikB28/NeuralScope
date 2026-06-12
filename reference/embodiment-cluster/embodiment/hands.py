"""
Embodiment · HANDS · actuation

Translates the model's computer-use actions into real OS input events, but ONLY
after passing through the Safety gate and ONLY after mapping model coordinates
back to native pixels via Eyes.

Supported actions mirror the computer_20251124 tool vocabulary:
  screenshot, mouse_move, left_click, right_click, middle_click, double_click,
  triple_click, left_mouse_down, left_mouse_up, scroll, type, key, hold_key, wait
"""
import time
from . import config
from .safety import Killed

try:
    import pyautogui
    pyautogui.FAILSAFE = True       # native corner failsafe, belt-and-suspenders
    pyautogui.PAUSE = 0.0           # we manage our own pacing
    _HAS_INPUT = True
except Exception:
    _HAS_INPUT = False


class Hands:
    def __init__(self, bus, eyes, safety):
        self.bus = bus
        self.eyes = eyes
        self.safety = safety

    def execute(self, action: dict):
        """action = {'action': 'left_click', 'coordinate': [x,y], 'text': ...}"""
        self.safety.check()
        name = action.get("action")
        coord = action.get("coordinate")
        text = action.get("text")
        native = None
        if coord:
            native = self.eyes.to_native(coord[0], coord[1])

        # gate: in dry-run this returns False and we only visualize
        live = self.safety.gate_action(name, coords=native, key=text)

        self.bus.emit("intent.formed", action=name, target=native,
                      why=action.get("reasoning", ""))

        if not live:
            return {"executed": False, "reason": "dry-run"}

        if not _HAS_INPUT:
            self.bus.emit("action.blocked", action=name, rule="no input backend")
            return {"executed": False, "reason": "no backend"}

        try:
            self._do(name, native, text)
            self.bus.emit("action.executed", action=name, coords=native, key=text)
            time.sleep(config.STEP_DELAY_S)
            return {"executed": True}
        except Killed:
            raise
        except Exception as e:
            self.bus.emit("action.blocked", action=name, rule=f"exec error: {e}")
            return {"executed": False, "reason": str(e)}

    # ---- the actual OS calls ----
    def _do(self, name, native, text):
        x, y = native if native else (None, None)
        if name == "mouse_move":
            pyautogui.moveTo(x, y, duration=0.2)
        elif name == "left_click":
            pyautogui.click(x, y)
        elif name == "right_click":
            pyautogui.click(x, y, button="right")
        elif name == "middle_click":
            pyautogui.click(x, y, button="middle")
        elif name == "double_click":
            pyautogui.doubleClick(x, y)
        elif name == "triple_click":
            pyautogui.click(x, y, clicks=3, interval=0.05)
        elif name == "left_mouse_down":
            pyautogui.mouseDown(x, y)
        elif name == "left_mouse_up":
            pyautogui.mouseUp(x, y)
        elif name == "scroll":
            amount = int(text or 3)
            pyautogui.scroll(amount, x=x, y=y)
        elif name == "type":
            pyautogui.typewrite(text or "", interval=0.012)
        elif name == "key":
            # supports combos like "ctrl+s", "cmd+shift+4"
            keys = [k.strip() for k in (text or "").replace("+", " ").split()]
            pyautogui.hotkey(*keys)
        elif name == "hold_key":
            pyautogui.keyDown(text)
        elif name == "wait":
            time.sleep(float(text or 1.0))
        else:
            raise ValueError(f"unknown action: {name}")
