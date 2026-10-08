"""Generates the neutral Workspace brand artwork.

Mark: three panes (one tall, two stacked) - a workspace layout. Lettering: "Workspace" outlined
from the Inter variable font that ships with the app (SIL OFL), so the SVGs need no font at runtime.
"""

import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

PUBLIC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

TEXT = "Workspace"
WEIGHT = 600
CAP_SIZE = 30  # font size used for the lettering paths

font = TTFont(PUBLIC / "assets/fonts/Inter.var.woff2")
font = instantiateVariableFont(font, {"wght": WEIGHT, "opsz": 14} if "opsz" in [a.axisTag for a in font["fvar"].axes] else {"wght": WEIGHT})
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm
scale = CAP_SIZE / upm

# kerning is skipped on purpose: plain advances read fine at login-screen size
x = 0.0
pen_paths = []
min_x = min_y = 1e9
max_x = max_y = -1e9
for ch in TEXT:
    name = cmap[ord(ch)]
    g = glyphs[name]
    sp = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    # font y points up; flip into SVG space with the baseline at y = 0
    tp = TransformPen(sp, (scale, 0, 0, -scale, x, 0))
    g.draw(tp)
    bp = BoundsPen(glyphs)
    g.draw(TransformPen(bp, (scale, 0, 0, -scale, x, 0)))
    if bp.bounds:
        a, b, c, d = bp.bounds
        min_x, min_y, max_x, max_y = min(min_x, a), min(min_y, b), max(max_x, c), max(max_y, d)
    pen_paths.append(sp.getCommands())
    x += g.width * scale

PAD = 1.0
vb_x, vb_y = min_x - PAD, min_y - PAD
vb_w, vb_h = (max_x - min_x) + 2 * PAD, (max_y - min_y) + 2 * PAD
path_d = " ".join(pen_paths)


def lettering_svg(fill: str, height: int = 38) -> str:
    width = round(vb_w / vb_h * height)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="{vb_x:.2f} {vb_y:.2f} {vb_w:.2f} {vb_h:.2f}" fill="none">'
        f'<path fill="{fill}" d="{path_d}"/></svg>\n'
    )


# mark: 255 x 127 viewBox (the sprite symbol keeps the aspect the sidebar expects)
MARK_RECTS = [(0, 0, 120, 127), (135, 0, 120, 58), (135, 69, 120, 58)]
RX = 14


def mark_group(fill: str) -> str:
    return "".join(
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{RX}" fill="{fill}"/>'
        for x, y, w, h in MARK_RECTS
    )


ACCENT = "#0088cc"  # same as the default main colour in runtimeConfigSchema

# square icon: rounded dark tile with the mark centred
def icon_svg(size: int = 512, radius: int = 96) -> str:
    inner_w = size * 0.56
    s = inner_w / 255
    ox = (size - 255 * s) / 2
    oy = (size - 127 * s) / 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'<rect width="{size}" height="{size}" rx="{radius}" fill="#101215"/>'
        f'<g transform="translate({ox:.2f} {oy:.2f}) scale({s:.4f})">{mark_group("#ffffff")}</g>'
        f"</svg>\n"
    )


# loading animation: the three panes fade in turn
def loading_svg(fill: str) -> str:
    rects = ""
    for i, (x, y, w, h) in enumerate(MARK_RECTS):
        rects += (
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{RX}" fill="{fill}">'
            f'<animate attributeName="opacity" values="0.15;1;0.15" dur="1.8s" begin="{i * 0.3}s" repeatCount="indefinite"/>'
            f"</rect>"
        )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 255 127">'
        f"{rects}</svg>\n"
    )


def sprite_symbols() -> str:
    mark = (
        '<symbol id="brand-mark" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 255 127">'
        + mark_group("currentColor")
        + "</symbol>"
    )
    lettering = (
        f'<symbol id="brand-lettering" xmlns="http://www.w3.org/2000/svg" fill="none" '
        f'viewBox="{vb_x:.2f} {vb_y:.2f} {vb_w:.2f} {vb_h:.2f}"><path fill="currentColor" d="{path_d}"/></symbol>'
    )
    return mark, lettering


(OUT / "brand_lettering.svg").write_text(lettering_svg("#101215"))
(OUT / "brand_lettering_light.svg").write_text(lettering_svg("#ffffff"))
(OUT / "icon.svg").write_text(icon_svg())
(OUT / "loading-light.svg").write_text(loading_svg("#101215"))
(OUT / "loading-dark.svg").write_text(loading_svg("#ffffff"))
mark, lettering = sprite_symbols()
(OUT / "sprite-mark.txt").write_text(mark)
(OUT / "sprite-lettering.txt").write_text(lettering)
print("lettering viewBox", round(vb_w, 2), round(vb_h, 2))
