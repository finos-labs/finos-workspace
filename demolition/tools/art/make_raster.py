"""PNG/ICO renditions of the Workspace mark (same geometry as make_art.py)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(sys.argv[1])
RECTS = [(0, 0, 120, 127), (135, 0, 120, 58), (135, 69, 120, 58)]
SS = 4


def tile(size, bg, fg, radius_ratio=0.1875, mark_ratio=0.56):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * radius_ratio), fill=bg)
    s = big * mark_ratio / 255
    ox, oy = (big - 255 * s) / 2, (big - 127 * s) / 2
    for x, y, w, h in RECTS:
        d.rounded_rectangle((ox + x * s, oy + y * s, ox + (x + w) * s, oy + (y + h) * s), radius=14 * s, fill=fg)
    return img.resize((size, size), Image.LANCZOS)


DARK, WHITE = (16, 18, 21, 255), (255, 255, 255, 255)
for size in (192, 512):
    tile(size, DARK, WHITE).save(OUT / f"android-launchericon-{size}-{size}.png")
tile(180, DARK, WHITE, radius_ratio=0).save(OUT / "apple-touch-icon.png")
# default Copilot image: white mark on neutral grey, square
tile(256, (96, 99, 106, 255), WHITE, radius_ratio=0, mark_ratio=0.62).save(OUT / "brand.png")
ico_base = tile(256, DARK, WHITE, radius_ratio=0.18, mark_ratio=0.7)
ico_base.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print(sorted(p.name for p in OUT.iterdir()))
