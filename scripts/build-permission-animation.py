"""Convert the approved, embedded preview frames to display-order RGB565.

Requires ffmpeg with WebP decoding. All artwork comes from the local preview;
the converter never downloads assets or reads device configuration.
"""

import argparse
import base64
import hashlib
import json
import re
import struct
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WIDTH = 118
HEIGHT = 203
FRAME_COUNT = 41
BACKGROUND = (6, 14, 24)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--preview", type=Path, default=ROOT / "output/permission-question-demo.html")
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "firmware/stackchan/assets/lol_enemy_missing.rgb565",
    )
    args = parser.parse_args()
    preview = args.preview.read_bytes()
    match = re.search(
        rb'<script type="application/json" id="pq-frames">(.*?)</script>', preview, re.DOTALL
    )
    if not match:
        raise SystemExit("Preview does not contain the approved embedded frames")
    sources = json.loads(match.group(1))
    if len(sources) != FRAME_COUNT:
        raise SystemExit(f"Expected {FRAME_COUNT} frames, found {len(sources)}")

    with tempfile.TemporaryDirectory(prefix="willump-question-") as temporary:
        directory = Path(temporary)
        for index, source in enumerate(sources):
            prefix = "data:image/webp;base64,"
            if not source.startswith(prefix):
                raise SystemExit("Expected embedded lossless WebP frames")
            data = base64.b64decode(source[len(prefix):], validate=True)
            (directory / f"frame-{index:03}.webp").write_bytes(data)
        decoded = subprocess.run(
            [
                args.ffmpeg,
                "-v", "error",
                "-i", str(directory / "frame-%03d.webp"),
                "-frames:v", str(FRAME_COUNT),
                "-vf", f"scale={WIDTH}:{HEIGHT}:flags=bilinear",
                "-f", "rawvideo",
                "-pix_fmt", "rgba",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
        ).stdout

    pixels = WIDTH * HEIGHT * FRAME_COUNT
    if len(decoded) != pixels * 4:
        raise SystemExit("Decoded frame size does not match the firmware layout")
    encoded = bytearray(pixels * 2)
    for index, (red, green, blue, alpha) in enumerate(struct.iter_unpack("4B", decoded)):
        red = (red * alpha + BACKGROUND[0] * (255 - alpha) + 127) // 255
        green = (green * alpha + BACKGROUND[1] * (255 - alpha) + 127) // 255
        blue = (blue * alpha + BACKGROUND[2] * (255 - alpha) + 127) // 255
        color = ((red >> 3) << 11) | ((green >> 2) << 5) | (blue >> 3)
        struct.pack_into(">H", encoded, index * 2, color)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    manifest = {
        "preview": str(args.preview.relative_to(ROOT)),
        "previewSha256": hashlib.sha256(preview).hexdigest(),
        "format": "RGB565 big-endian, precomposed on #060e18",
        "width": WIDTH,
        "height": HEIGHT,
        "x": 101,
        "y": 8,
        "frames": FRAME_COUNT,
        "framesPerSecond": 30,
        "durationMs": 1350,
        "afterLanding": "Hold frame 40 until the waiting state ends",
        "bytes": len(encoded),
        "sha256": hashlib.sha256(encoded).hexdigest(),
    }
    args.output.with_suffix(".json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
