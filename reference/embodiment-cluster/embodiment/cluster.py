"""
Embodiment · CLUSTER · the public face

Wires Eyes + Hands + Safety + Loop + EventBus into one object the rest of
NeuralScope (and the 3D world) talks to. This is what the Tower boots when a
flight plan requests the `embodiment` connector.
"""
from .event_bus import EventBus
from .eyes import Eyes
from .hands import Hands
from .safety import Safety
from .loop import EmbodimentLoop
from . import config


class EmbodimentCluster:
    def __init__(self, dry_run=config.DRY_RUN_DEFAULT, client=None):
        self.bus = EventBus()
        self.safety = Safety(self.bus, dry_run=dry_run)
        self.eyes = Eyes(self.bus)
        self.hands = Hands(self.bus, self.eyes, self.safety)
        self.loop = EmbodimentLoop(self.bus, self.eyes, self.hands, self.safety, client=client)
        self._armed = False

    def arm(self):
        """Turn on the hardware kill listeners. Call before any live run."""
        self.safety.start_listener()
        self._armed = True
        self.bus.emit("perception.described",
                      summary=f"cluster armed · dry_run={self.safety.dry_run}", elements=[])

    def go_live(self):
        """Leave dry-run. Refuses unless kill listeners are armed."""
        if not self._armed:
            raise RuntimeError("arm() the safety listeners before going live")
        self.safety.dry_run = False
        self.bus.emit("perception.described", summary="LIVE control enabled", elements=[])

    def run(self, objective, max_steps=config.MAX_STEPS_DEFAULT):
        return self.loop.run(objective, max_steps=max_steps)

    def kill(self):
        self.safety.kill(source="api")

    def subscribe(self, fn):
        """Let the 3D-world bridge listen to every event."""
        self.bus.subscribe(fn)

    def snapshot(self):
        return self.bus.snapshot()
