#!/usr/bin/env python3
"""Frontend demolition lists, computed from the import graph of frontend/.

Run from anywhere:  python3 demolition/tools/frontend_reach.py

Method
  roots   = src/main.tsx, src/lib/runtimeConfigSchema.ts (vite.config.ts imports it), tailwind.config.ts, vitest.setup.ts, playwright.config.ts, .storybook/*
  kept widgets (the only entries left in Widgets/index.ts):
            custom/Markdown, custom/HtmlViewer, Iframe, RssViewer, PdfViewer,
            and ui/NavigationBar (the dashboard's inner tabs; custom-backend app templates and the Copilot's
            manage_navigation_bar tool use it)
  cuts    = demolition/frontend.cuts.json: routes removed from main.tsx, plus files/dirs never traversed
  delete  = tracked src/ files not reachable from the roots once the cuts are applied
  edit    = reachable files that import something in the delete set (the import must go)
Writes demolition/frontend-delete.txt, frontend-edit.txt, frontend-tests.txt, frontend-npm.txt and frontend-left-alone.txt
(unreachable files that are deliberately not deleted: ambient type files and the design-system kit).
"""
import json, os, re, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
ROOT = os.path.join(REPO, "workspace")
OUT = os.path.join(REPO, "demolition")
KEEP_WIDGETS = {
    "src/components/Widgets/custom/Markdown.tsx", "src/components/Widgets/custom/HtmlViewer.tsx",
    "src/components/Widgets/Iframe.tsx", "src/components/Widgets/RssViewer.tsx", "src/components/Widgets/PdfViewer.tsx",
    "src/components/Widgets/Misc/Editing/MarkdownEditor.tsx",
    "src/components/Widgets/ui/NavigationBar.tsx",
}
REGISTRY = "src/components/Widgets/index.ts"
EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".md", ".mdx", ".svg", ".csv"]
SPEC = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+(?:url\(\s*)?|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual|importMock|requireActual)\s*\(\s*)['"]([^'"\n]+)['"]""")
STMT = re.compile(r"""import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"\n]+)['"]""")


def tracked():
    # tracked files still present in the working tree (files already deleted are done)
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True).stdout.split("\n")
    return [p for p in out if p and os.path.exists(os.path.join(ROOT, p))]


def resolve(frm, spec, allfiles):
    spec = spec.split("?")[0]
    if spec.startswith("~/"): base = os.path.normpath(os.path.join("src", spec[2:]))
    elif spec.startswith("."): base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    else: return None
    if base in allfiles: return base
    for e in EXTS + [".d.ts"]:
        if base + e in allfiles: return base + e
    for e in EXTS[:4]:
        if base + "/index" + e in allfiles: return base + "/index" + e
    return None


def is_test(p):
    return bool(re.search(r"(^tests/|\.test\.|\.spec\.|\.stories\.|__tests__|^\.storybook/)", p))


def main():
    cfg = json.load(open(os.path.join(OUT, "frontend.cuts.json")))
    allfiles = set(tracked())
    code = {f for f in allfiles if re.search(r"\.(tsx?|jsx?|mjs|cjs|css)$", f)}
    text = {}
    fwd = {}
    for f in code:
        t = open(os.path.join(ROOT, f), encoding="utf-8", errors="replace").read()
        text[f] = t
        for m in SPEC.finditer(t):
            r = resolve(f, m.group(1), allfiles)
            if r: fwd.setdefault(f, set()).add(r)

    def cut_t(t): return any(t == c or t.startswith(c.rstrip("/") + "/") for c in cfg["cut_files"])
    cut_edges = {("src/main.tsx", r) for r in cfg["cut_routes"]}
    for t in fwd.get(REGISTRY, ()):
        if (t.startswith("src/components/Widgets/") or t.startswith("src/components/General/Table/")) and t not in KEEP_WIDGETS:
            cut_edges.add((REGISTRY, t))
    extra_roots = [f for f in allfiles if f in ("tailwind.config.ts", "vitest.setup.ts", "playwright.config.ts") or (f.startswith(".storybook/") and f.endswith((".ts", ".tsx")))]
    seen, stack = set(), ["src/main.tsx", "src/lib/runtimeConfigSchema.ts"] + extra_roots
    while stack:
        f = stack.pop()
        if f in seen or cut_t(f): continue
        seen.add(f)
        for t in fwd.get(f, ()):
            if (f, t) in cut_edges or cut_t(t): continue
            stack.append(t)

    src_all = {f for f in allfiles if f.startswith("src/") and not is_test(f)}
    ambient_removed = {"src/types/monaco-editor.d.ts", "src/components/Charting/react-plotly.js.d.ts"}
    # src/components/ds/ is the design-system kit (Storybook, tailwind plugins): unused kit pieces are not part of this demolition
    delete = sorted(f for f in (src_all - seen) if not f.startswith("src/components/ds/") and not (f.endswith(".d.ts") and f not in ambient_removed and not f.startswith("src/components/General/Table/") and not cut_t(f)))
    dset = set(delete)

    # edit set: reachable files importing deleted files, with the imported names
    edits = []
    for f in sorted(seen & code):
        for m in STMT.finditer(text[f]):
            r = resolve(f, m.group(2), allfiles)
            if r in dset:
                edits.append("%s | %s | %s" % (f, r, re.sub(r"\s+", " ", m.group(1)).strip()[:100]))
        for t in sorted(fwd.get(f, ())):
            if t in dset and not any(l.startswith(f + " | " + t) for l in edits):
                edits.append("%s | %s | (dynamic or side-effect import)" % (f, t))

    # tests: delete when every src import is deleted; edit when some are
    tests_delete, tests_edit = [], []
    def mirror(tf):
        # tests/unit/components/X/Y.test.tsx  ->  src/components/X/Y.tsx|ts
        m = re.match(r"tests/(?:unit|integration)/(.+?)(?:\.[A-Za-z]+)*\.(?:test|spec)\.(tsx?|jsx?)$", tf)
        if not m: return None
        base = "src/" + m.group(1)
        for ext in (".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"):
            if base + ext in allfiles: return base + ext
        return None
    for f in sorted(x for x in code if is_test(x) and not x.startswith(".storybook")):
        srcs = {t for t in fwd.get(f, ()) if t.startswith("src/")}
        mir = mirror(f)
        gone = srcs & dset
        mdir = None
        mm = re.match(r"tests/(?:unit|integration)/(.+)/[^/]+$", f)
        if mm:
            d = "src/" + mm.group(1)
            under = [x for x in allfiles if x.startswith(d + "/") and x.startswith("src/")]
            if under and all(x in dset or is_test(x) for x in under): mdir = d
        stem = re.sub(r"\.(test|spec)\.(tsx?|jsx?)$", "", os.path.basename(f))
        same = [x for x in src_all if os.path.splitext(os.path.basename(x))[0] == stem and not x.endswith(".d.ts")]
        subject_deleted = bool(same) and all(x in dset for x in same) and stem not in ("index", "utils", "constants", "types", "helpers")
        if mdir:
            tests_delete.append(f)                       # the whole directory it mirrors is deleted
        elif subject_deleted:
            tests_delete.append(f)                       # the component named in the file name is deleted
        elif mir and mir in dset:
            tests_delete.append(f)                       # its subject is deleted
        elif srcs and gone and gone == srcs:
            tests_delete.append(f)                       # everything it imports is deleted
        elif gone:
            tests_edit.append("%s | imports deleted: %s" % (f, ", ".join(sorted(os.path.basename(g) for g in gone))[:120]))
        elif not srcs and f.startswith("tests/e2e/"):
            pass

    # a test helper that is deleted is not also an edit (tests/mocks/ag-grid.ts is reachable through vitest.setup.ts)
    gone_tests = set(tests_delete)
    edits = [l for l in edits if l.split(" | ")[0] not in gone_tests]

    # npm dependencies no surviving file imports
    used = set()
    def pkg(sp):
        if sp.startswith((".", "~", "/", "virtual:")): return None
        p = sp.split("/")
        return "/".join(p[:2]) if sp.startswith("@") else p[0]
    scan = [f for f in (seen & code)] + [f for f in ("vite.config.ts", "vitest.setup.ts", "index.html", "tailwind.config.ts", "playwright.config.ts") if f in allfiles]
    scan += [f for f in allfiles if f.startswith((".storybook/", "tests/")) and f in code and f not in tests_delete]
    for f in scan:
        t = text.get(f) or open(os.path.join(ROOT, f), encoding="utf-8", errors="replace").read()
        for m in SPEC.finditer(t):
            p = pkg(m.group(1))
            if p: used.add(p)
    for f in allfiles:
        if f.endswith(".css") and f.startswith("src/"):
            for m in re.finditer(r"""@(?:import|plugin|source)\s+['"]([^'"]+)['"]""", open(os.path.join(ROOT, f), encoding="utf-8", errors="replace").read()):
                p = pkg(m.group(1))
                if p: used.add(p)
    deps = json.load(open(os.path.join(ROOT, "package.json")))["dependencies"]
    unused = sorted(d for d in deps if d not in used)

    w = lambda name, lines: open(os.path.join(OUT, name), "w").write("\n".join(lines) + "\n")
    w("frontend-delete.txt", ["frontend/" + f for f in delete])
    left_alone = sorted(src_all - seen - dset)
    w("frontend-left-alone.txt", ["frontend/" + f for f in left_alone])
    w("frontend-edit.txt", ["frontend/" + l for l in edits])
    w("frontend-tests.txt", ["DELETE frontend/" + t for t in tests_delete] + ["EDIT   frontend/" + t for t in tests_edit])
    w("frontend-npm.txt", ["# dependencies in frontend/package.json that no surviving file imports (remove):"] + unused)
    print("src files: %d | kept (reachable): %d | delete: %d | left alone: %d | edit sites: %d files" % (len(src_all), len(seen & src_all), len(delete), len(left_alone), len({l.split(' | ')[0] for l in edits})))
    print("tests: delete %d, edit %d | npm dependencies with no surviving importer: %d" % (len(tests_delete), len(tests_edit), len(unused)))


main()
