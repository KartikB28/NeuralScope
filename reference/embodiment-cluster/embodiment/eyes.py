"""
Embodiment · EYES · perception

Three-layer perception, degrading gracefully:
  1. raw capture      - a screenshot of the active display
  2. structure        - (optional) OS accessibility tree / OCR, if available
  3. semantic         - the vision model's reading of the frame (done in the loop)

This module owns layers 1-2 and, critically, the COORDINATE MAPPING between
what the model sees (downscaled image space) and the real screen (native pixels).
Getting that mapping right is the whole ballgame for Hands.
"""
import base64, io, time
from . import config

# Optional deps are imported lazily so the module loads on any machine
# (e.g. a headless dev box) and falls back to a stub.
try:
    import mss
    from PIL import Image
    _HAS_CAPTURE = True
except Exception:
    _HAS_CAPTURE = False


class Eyes:
    def __init__(self, bus):
        self.bus = bus
        self._sct = mss.mss() if _HAS_CAPTURE else None
        self.native_w = 0
        self.native_h = 0
        self.scale = 1.0          # native_long_edge / sent_long_edge

    # ---- layer 1: capture ----
    def capture(self):
        """Return (png_b64, sent_w, sent_h). Also stores scale for mapping back."""
        if not _HAS_CAPTURE:
            return self._stub_frame()

        mon = self._sct.monitors[1]                  # primary display
        raw = self._sct.grab(mon)
        img = Image.frombytes("RGB", raw.size, raw.rgb)
        self.native_w, self.native_h = img.size

        long_edge = max(img.size)
        if long_edge > config.MAX_LONG_EDGE:
            self.scale = long_edge / config.MAX_LONG_EDGE
            new = (round(img.width / self.scale), round(img.height / self.scale))
            img = img.resize(new, Image.LANCZOS)
        else:
            self.scale = 1.0

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        self.bus.emit("perception.captured",
                      w=img.width, h=img.height, scale=round(self.scale, 3))
        return b64, img.width, img.height

    # ---- coordinate mapping: model space -> native screen ----
    def to_native(self, x, y):
        """Map a coordinate the model produced (in sent-image space) to real pixels."""
        return round(x * self.scale), round(y * self.scale)

    # ---- fallback so the system is testable anywhere ----
    def _stub_frame(self):
        # Preserve any caller-set native resolution / scale (used in tests to
        # exercise coordinate mapping); only default when unset.
        if not self.native_w:
            self.native_w, self.native_h, self.scale = 1366, 768, 1.0
        sent_w = round(self.native_w / self.scale)
        sent_h = round(self.native_h / self.scale)
        # a 1x1 transparent png; the loop's vision step is mocked in dry-run tests
        png = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAA"
               "AMAASsJTYQAAAAASUVORK5CYII=")
        self.bus.emit("perception.captured", w=sent_w, h=sent_h,
                      scale=round(self.scale, 3), stub=True)
        return png, sent_w, sent_h
