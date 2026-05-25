#!/usr/bin/env python3
"""Build icon.ico from PNGs (Windows). Uses PNG-in-ICO (Vista+). Stdlib only."""
from __future__ import annotations

import struct
import sys
from pathlib import Path


def png_ico_entry(png: bytes, width: int, height: int) -> tuple[bytes, bytes]:
    # ICONDIRENTRY: width, height, colors=0, reserved=0, planes=1, bpp=32, size, offset
    entry = struct.pack(
        "<BBBBHHII",
        width if width < 256 else 0,
        height if height < 256 else 0,
        0,
        0,
        1,
        32,
        len(png),
        0,  # offset patched later
    )
    return entry, png


def build_ico(png_paths: list[Path], out: Path) -> None:
    images: list[bytes] = []
    entries: list[bytes] = []
    for path in png_paths:
        png = path.read_bytes()
        # Parse IHDR for size
        if png[:8] != b"\x89PNG\r\n\x1a\n" or png[12:16] != b"IHDR":
            raise ValueError(f"Not a PNG: {path}")
        w, h = struct.unpack(">II", png[16:24])
        entry, data = png_ico_entry(png, w, h)
        entries.append(entry)
        images.append(data)

    count = len(entries)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    patched: list[bytes] = []
    for entry, data in zip(entries, images):
        e = bytearray(entry)
        struct.pack_into("<I", e, 12, offset)
        patched.append(bytes(e))
        offset += len(data)

    out.write_bytes(header + b"".join(patched) + b"".join(images))


def main() -> int:
    icons = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
    sources = [
        icons / "32x32.png",
        icons / "128x128.png",
        icons / "128x128@2x.png",
    ]
    for s in sources:
        if not s.is_file():
            print(f"Missing {s}. Run scripts/generate-icons.sh first.", file=sys.stderr)
            return 1
    build_ico(sources, icons / "icon.ico")
    print(f"Wrote {icons / 'icon.ico'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
