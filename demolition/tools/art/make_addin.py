import sys, re
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(sys.argv[1]); LETTER = Path(sys.argv[2])
RECTS = [(0, 0, 120, 127), (135, 0, 120, 58), (135, 69, 120, 58)]
SS = 4

def tile(size):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.1875), fill=(16, 18, 21, 255))
    s = big * 0.56 / 255
    ox, oy = (big - 255 * s) / 2, (big - 127 * s) / 2
    for x, y, w, h in RECTS:
        d.rounded_rectangle((ox + x * s, oy + y * s, ox + (x + w) * s, oy + (y + h) * s), radius=14 * s, fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)

for n in (16, 32, 64, 80, 128, 300):
    tile(n).save(OUT / f"workspace-icon-{n}.png")
for n in (16, 32, 64, 80, 128):
    tile(n).save(OUT / f"icon-{n}.png")
tile(300).save(OUT / "logo-filled.png")

# horizontal logo: mark + lettering (white), for the dark taskpane background
svg = LETTER.read_text()
m = re.search(r'viewBox="([-\d. ]+)"', svg); vb = [float(v) for v in m.group(1).split()]
path = re.search(r'<path[^>]*d="([^"]+)"', svg).group(1)
h = 40.0; mark_w = 80.0
lw = vb[2] / vb[3] * 24
W = mark_w + 14 + lw
horizontal = (
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{h:.0f}" viewBox="0 0 {W:.2f} {h:.2f}" fill="none">'
    f'<g transform="translate(0 {(h - 127*mark_w/255)/2:.2f}) scale({mark_w/255:.5f})" fill="#ffffff">'
    + "".join(f'<rect x="{x}" y="{y}" width="{w}" height="{hh}" rx="14"/>' for x, y, w, hh in RECTS) +
    '</g>'
    f'<svg x="{mark_w + 14:.2f}" y="{(h-24)/2:.2f}" width="{lw:.2f}" height="24" viewBox="{vb[0]} {vb[1]} {vb[2]} {vb[3]}">'
    f'<path fill="#ffffff" d="{path}"/></svg></svg>\n'
)
(OUT.parent / "logo").mkdir(exist_ok=True)
(OUT.parent / "logo" / "horizontal.svg").write_text(horizontal)
print("ok")
