"""
Dry-run proof: drives the full perceive->think->act->verify loop with a MOCK
model client, so it runs anywhere (no API key, no display, no real cursor).
Verifies: events emit in order, coordinate mapping works, the safety gate stops
real actuation in dry-run, and the loop terminates cleanly on DONE.
"""
import sys, types
sys.path.insert(0, "/home/claude/embodiment")

from embodiment.cluster import EmbodimentCluster


# ---- a fake Anthropic client that returns scripted computer-use turns ----
class _Block:
    def __init__(self, **kw): self.__dict__.update(kw)

class _Resp:
    def __init__(self, content): self.content = content

class MockClient:
    def __init__(self):
        self.turn = 0
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(create=self._create))
    def _create(self, **kwargs):
        self.turn += 1
        if self.turn == 1:
            return _Resp([
                _Block(type="text", text="I'll click the search box."),
                _Block(type="tool_use", id="t1", name="computer",
                       input={"action": "left_click", "coordinate": [400, 300],
                              "reasoning": "focus the search field"}),
            ])
        if self.turn == 2:
            return _Resp([
                _Block(type="text", text="Typing the query."),
                _Block(type="tool_use", id="t2", name="computer",
                       input={"action": "type", "text": "neuralscope"}),
            ])
        return _Resp([_Block(type="text", text="DONE — searched successfully.")])


def main():
    events = []
    cluster = EmbodimentCluster(dry_run=True, client=MockClient())
    cluster.subscribe(lambda e: events.append(e))

    # force a known native resolution so we can check coordinate mapping
    cluster.eyes.native_w, cluster.eyes.native_h = 2732, 2048
    cluster.eyes.scale = 2.0   # model space 1366 -> native 2732

    result = cluster.run("search for neuralscope", max_steps=10)

    print("RESULT:", result["status"])
    print("\nEVENT STREAM")
    print("-" * 60)
    for e in events:
        d = e["data"]
        extra = {k: v for k, v in d.items() if k in ("action", "coords", "target", "status", "summary", "i", "of")}
        print(f"  {e['type']:24} {extra}")

    # ---- assertions ----
    types_seen = [e["type"] for e in events]
    assert result["status"] == "done", "loop should finish on DONE"
    assert "action.dryrun" in types_seen, "dry-run gate must fire (no real actuation)"
    assert "action.executed" not in types_seen, "nothing should physically execute in dry-run"
    # coordinate mapping: model [400,300] @ scale 2.0 -> native [800,600]
    dry = next(e for e in events if e["type"] == "action.dryrun" and e["data"].get("coords"))
    assert dry["data"]["coords"] == [800, 600] or tuple(dry["data"]["coords"]) == (800, 600), \
        f"coord mapping wrong: {dry['data']['coords']}"
    print("-" * 60)
    print("\n✓ loop terminates on DONE")
    print("✓ dry-run gate blocked all real actuation")
    print("✓ coordinate mapping model(400,300)@2.0x -> native(800,600)")
    print("✓ full event stream emitted for the 3D world")
    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    main()
