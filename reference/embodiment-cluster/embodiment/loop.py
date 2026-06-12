"""
Embodiment · THE LOOP · perceive -> think -> act -> verify

This is the cluster's heartbeat. Given an objective in plain language, it:
  1. captures the screen (Eyes)
  2. asks the model what to do next, given the goal + screen (computer-use API)
  3. executes the model's action(s) (Hands, through Safety)
  4. repeats until the model says done, or a ceiling/kill is hit

In phase 1 the loop is deliberately simple and single-threaded. Verification,
recovery ladders, and the preference model (from the autonomy systems discussion)
hook in at the marked extension points without restructuring this file.
"""
import os
from . import config
from .safety import Killed

try:
    import anthropic
    _HAS_SDK = True
except Exception:
    _HAS_SDK = False


SYSTEM = (
    "You operate a computer to accomplish the user's objective. "
    "You see the screen as an image and act through mouse and keyboard. "
    "Work in small, verifiable steps. After each action, re-read the screen. "
    "Prefer keyboard shortcuts when reliable. If you cannot proceed safely or the "
    "goal is ambiguous in a way that risks an irreversible action, stop and explain. "
    "When the objective is fully complete, say DONE and summarize what you did."
)


class EmbodimentLoop:
    def __init__(self, bus, eyes, hands, safety, client=None):
        self.bus = bus
        self.eyes = eyes
        self.hands = hands
        self.safety = safety
        self.client = client or (anthropic.Anthropic() if _HAS_SDK else None)

    def run(self, objective: str, max_steps=config.MAX_STEPS_DEFAULT):
        messages = [{"role": "user", "content": objective}]
        tools = [{
            "type": config.TOOL_TYPE,
            "name": "computer",
            "display_width_px": config.MAX_LONG_EDGE,
            "display_height_px": round(config.MAX_LONG_EDGE * 0.75),
        }]

        for i in range(max_steps):
            self.safety.check()
            self.bus.emit("loop.step", i=i + 1, of=max_steps)

            # --- perceive: attach a fresh screenshot each turn ---
            b64, w, h = self.eyes.capture()
            if i == 0:
                messages[0]["content"] = [
                    {"type": "text", "text": objective},
                    {"type": "image",
                     "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                ]

            if not self.client:
                self.bus.emit("loop.done", status="no-client (dry skeleton)", steps=i)
                return {"status": "no-client"}

            # --- think ---
            try:
                resp = self.client.beta.messages.create(
                    model=config.MODEL,
                    max_tokens=config.MAX_TOKENS,
                    system=SYSTEM,
                    tools=tools,
                    messages=messages,
                    betas=[config.BETA_HEADER],
                )
            except Killed:
                raise
            except Exception as e:
                self.bus.emit("loop.done", status=f"api-error: {e}", steps=i)
                return {"status": "api-error", "error": str(e)}

            messages.append({"role": "assistant", "content": resp.content})

            # narrate any text the model produced
            text = "".join(b.text for b in resp.content if b.type == "text")
            if text:
                self.bus.emit("perception.described", summary=text[:400], elements=[])
                if "DONE" in text.upper():
                    self.bus.emit("loop.done", status="complete", steps=i + 1)
                    return {"status": "done", "summary": text}

            # --- act: run every tool_use block, return results to the model ---
            tool_results = []
            for block in resp.content:
                if block.type != "tool_use":
                    continue
                action = dict(block.input)
                result = self.hands.execute(action)

                # === EXTENSION POINT: verification stack hooks here ===
                #   self.verify(action, result)  -> emit verify.checked
                # === EXTENSION POINT: recovery ladder hooks here ===

                # feed a fresh screenshot back as the tool result
                shot, _, _ = self.eyes.capture()
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": [
                        {"type": "text", "text": f"executed={result.get('executed')}"},
                        {"type": "image",
                         "source": {"type": "base64", "media_type": "image/png", "data": shot}},
                    ],
                })

            if not tool_results:
                # model spoke but took no action and didn't say DONE -> stop
                self.bus.emit("loop.done", status="stalled", steps=i + 1)
                return {"status": "stalled"}

            messages.append({"role": "user", "content": tool_results})

        self.bus.emit("loop.done", status="max-steps", steps=max_steps)
        return {"status": "max-steps"}
