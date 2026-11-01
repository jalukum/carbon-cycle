"""Draw the Carbon Cycle app icons as PNGs, with no third-party libraries."""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public"


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y, size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def pixel(x: int, y: int, size: int) -> bytes:
    nx = (x + 0.5) / size * 2 - 1
    ny = (y + 0.5) / size * 2 - 1
    r = (nx * nx + ny * ny) ** 0.5
    bg = (16, 18, 22, 255)
    # Rounded-rect mask so maskable icons keep a quiet margin.
    margin = 0.08
    ax, ay = abs(nx), abs(ny)
    if ax > 1 - margin or ay > 1 - margin:
        bg = (9, 10, 12, 255)
    ring = 0.62
    width = 0.075
    accent = (47, 227, 198, 255)
    # Arc with a gap on the right, plus a center dot.
    angle = (struct_angle(nx, ny) + 360) % 360
    if abs(r - ring) < width and not (330 <= angle or angle <= 28):
        return accent
    if r < 0.16:
        return accent
    return bg


def struct_angle(x: float, y: float) -> float:
    # 0° at the right, clockwise-ish via atan2 (y down in screen space).
    import math

    return math.degrees(math.atan2(y, x))


if __name__ == "__main__":
    write_png(ROOT / "apple-touch-icon.png", 180)
    write_png(ROOT / "icon-192.png", 192)
    write_png(ROOT / "icon-512.png", 512)
