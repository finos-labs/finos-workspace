# Tools

Everything here was written during the demolition. They are kept so that the work can be checked and repeated.

| Tool | What it does |
| :-- | :-- |
| [`residual_references.py`](residual_references.py) | The live gate: scans every tracked and untracked file for the term groups of the plan (vendors, hosts, secrets, removed routes, and the removed product, tier and trial names) and writes `../residual-references.txt`. `python3 demolition/tools/residual_references.py` must report 0 files. It skips `NOTICE`, the `LICENSE` files, lockfiles, `demolition/` and the plan. |
| [`frontend_reach.py`](frontend_reach.py), [`backend_reach.py`](backend_reach.py) | Phase 0 and 1: import-graph reachability, which produced the delete and edit lists in `../*.txt` and `../*.cuts.json`. They describe the tree of commit `be00e95` (the `terminalpro/` folder and the old module names), so they no longer run on the current tree. |
| [`purge/`](purge) | Phase 6: the ordered, idempotent rewrite that replaced the product name, `terminal`, `pro` and the abbreviation across the repository (identifier, literal, regular-expression and phrase rules in `rules_pro.py`, `rules_openbb.py` and `purge.py`), with `--dry`, `--only` and `--exclude` options. `scan.py` counts what is left per area (`python3 demolition/tools/purge/scan.py openbb,terminal,pro,obb - NOTICE`), `preview.py` shows what a purge would still leave, `impcheck.sh` checks that the backend still imports. The rules are specific to this repository's tree at that time. |
| [`art/`](art) | Phase 6: generators of the neutral brand art. `make_art.py <frontend/public> <out>` outlines "Workspace" from the bundled Inter font and writes the lettering, the icon, the loading animation and the sprite symbols; `make_raster.py <out>` writes the PNG and ICO versions (favicon, app icons, default Copilot image); `make_addin.py <icons dir> <lettering svg>` writes the add-in's icons and horizontal logo. They need `fonttools`, `brotli` and `pillow`. |

The sprite symbol and the icon geometry are three rounded panes (one tall, two stacked); change `MARK_RECTS` in the
generators and run them again to change the mark.
