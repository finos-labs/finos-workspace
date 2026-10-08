#!/usr/bin/env python3
"""Python import graph + reachability for backend-api/backend.

usage: pyreach.py importers <module-path...>        who imports these backend modules
       pyreach.py reach [--cut X ...] [--roots A B]  reachable from roots without traversing cut modules
       pyreach.py usage <regex>                      which backend modules contain the regex (non-test)
Module paths are repo-relative to backend-api/backend (e.g. api/email/hubspot.py or a dir prefix like api/email).
"""
import ast, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
ROOT = os.path.join(REPO, "backend-api", "backend")


def git_py():
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "*.py"], cwd=ROOT, capture_output=True, text=True).stdout.split("\n")
    return [p for p in out if p and not p.startswith("alembic/versions_archive") and os.path.exists(os.path.join(ROOT, p))]


def is_test(p):
    return p.startswith("tests/") or "/tests/" in p


def build(files):
    fs = set(files)
    def modfile(mod):
        base = mod.replace(".", "/")
        if base + ".py" in fs: return base + ".py"
        if base + "/__init__.py" in fs: return base + "/__init__.py"
        return None
    fwd = {}
    for f in files:
        try: tree = ast.parse(open(os.path.join(ROOT, f), encoding="utf-8").read())
        except Exception: continue
        for n in ast.walk(tree):
            tgts = []
            if isinstance(n, ast.Import):
                for a in n.names:
                    t = modfile(a.name)
                    if t: tgts.append(t)
            elif isinstance(n, ast.ImportFrom):
                if n.level:  # relative
                    pkg = os.path.dirname(f).split("/")
                    pkg = pkg[: len(pkg) - (n.level - 1)]
                    base = ".".join(pkg + ([n.module] if n.module else []))
                else:
                    base = n.module or ""
                t = modfile(base) if base else None
                if t: tgts.append(t)
                for a in n.names:
                    t2 = modfile(base + "." + a.name if base else a.name)
                    if t2: tgts.append(t2)
            for t in tgts:
                if t != f: fwd.setdefault(f, set()).add(t)
    rev = {}
    for f, ts in fwd.items():
        for t in ts: rev.setdefault(t, set()).add(f)
    return fwd, rev


def idents(node):
    """Every identifier-like token under an AST node: names, attributes, keywords, parameters, definitions,
    import aliases, and short string constants that look like identifiers or paths (route paths, column names)."""
    for n in ast.walk(node):
        if isinstance(n, ast.Name): yield n.id
        elif isinstance(n, ast.Attribute): yield n.attr
        elif isinstance(n, ast.keyword) and n.arg: yield n.arg
        elif isinstance(n, ast.arg): yield n.arg
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): yield n.name
        elif isinstance(n, ast.alias):
            yield n.name.split(".")[-1]
            if n.asname: yield n.asname
        elif isinstance(n, ast.ImportFrom) and n.module: yield n.module.split(".")[-1]
        elif isinstance(n, ast.Constant) and isinstance(n.value, str) and len(n.value) <= 60 and re.fullmatch(r"[\w./{}-]+", n.value):
            yield n.value


def members(top):
    """Split a top-level statement into (label, node) pieces: class members are separate pieces."""
    if isinstance(top, ast.ClassDef):
        head = [ast.Expr(value=ast.Name(id=top.name))] + [ast.Expr(value=b) for b in top.bases] + [ast.Expr(value=d) for d in top.decorator_list]
        yield top.name, ast.Module(body=head, type_ignores=[])
        for m in top.body:
            if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)): lab = m.name
            elif isinstance(m, ast.AnnAssign) and isinstance(m.target, ast.Name): lab = m.target.id
            elif isinstance(m, ast.Assign) and isinstance(m.targets[0], ast.Name): lab = m.targets[0].id
            else: lab = "<body>"
            yield "%s.%s" % (top.name, lab), m
    elif isinstance(top, (ast.FunctionDef, ast.AsyncFunctionDef)):
        yield top.name, top
    elif isinstance(top, (ast.Import, ast.ImportFrom)):
        yield "<imports>", top
    elif isinstance(top, ast.Assign) and isinstance(top.targets[0], ast.Name):
        yield top.targets[0].id, top
    elif isinstance(top, ast.AnnAssign) and isinstance(top.target, ast.Name):
        yield top.target.id, top
    else:
        yield "<module>", top


def expand(args, files):
    out = set()
    for a in args:
        a = a.rstrip("/")
        out |= {p for p in files if p == a or p.startswith(a + "/")}
    return out



def main():
    import json
    cfg = json.load(open(os.path.join(REPO, "demolition", "backend.cuts.json")))
    files = git_py()
    fwd, rev = build(files)
    cutset = expand(cfg["cut"], files)
    seen = set(); stack = list(cfg.get("roots", ["main.py"]))
    while stack:
        f = stack.pop()
        if f in seen or f in cutset: continue
        seen.add(f)
        for t in fwd.get(f, ()):
            if t not in cutset: stack.append(t)
    src = {f for f in files if not is_test(f) and not f.startswith("alembic/")}
    delete = sorted(cutset & src) + sorted((src - seen - cutset) - set(cfg.get("not_roots_but_keep", [])))
    edits = []
    for f in sorted(seen):
        hit = sorted(t for t in fwd.get(f, ()) if t in cutset)
        if hit: edits.append("backend-api/backend/%s | imports: %s" % (f, ", ".join(hit)))
    tests_delete, tests_edit = [], []
    for f in sorted(x for x in files if is_test(x) and x.endswith(".py")):
        imps = fwd.get(f, set())
        gone = imps & cutset
        non_helper = {t for t in imps if not is_test(t)}
        if re.search(cfg.get("test_delete_name_regex", "^$"), f) or (gone and non_helper <= cutset):
            tests_delete.append(f)
        elif gone:
            tests_edit.append("%s | imports: %s" % (f, ", ".join(sorted(gone))))
    # tests that call removed endpoints over HTTP (the import graph cannot see these)
    route_rx = re.compile(cfg.get("removed_route_regex", "^$"))
    for f in sorted(x for x in files if is_test(x) and x.endswith(".py")):
        if f in tests_delete or any(l.startswith(f + " |") for l in tests_edit): continue
        txt = open(os.path.join(ROOT, f), encoding="utf-8", errors="replace").read()
        hits = sorted(set(route_rx.findall(txt)))
        if hits: tests_edit.append("%s | calls removed routes: %s" % (f, ", ".join(hits)[:110]))
    # name-level references: the import graph cannot see attribute access (models.Tier) or a route handler
    # that is itself removed. Every identifier in a kept module is matched against the patterns in
    # backend.cuts.json "removed_names"; the hit is reported against the enclosing top-level function,
    # class member or statement, so the row says what to delete or edit.
    name_rx = {ph: re.compile(p) for ph, p in cfg.get("removed_names", {}).items()}
    dead_files = set(delete) | set(tests_delete)
    names_rows, names_by_file = [], {}
    ignore = set(cfg.get("name_ignore", {}))
    for f in sorted(x for x in files if x.endswith(".py") and not x.startswith("alembic/") and x not in dead_files and x not in ignore):
        try: tree = ast.parse(open(os.path.join(ROOT, f), encoding="utf-8").read())
        except Exception: continue
        for top in tree.body:
            for label, node in members(top):
                found = {}
                for ident in idents(node):
                    norm = ident.lower().replace("-", "_")
                    for ph, rx in name_rx.items():
                        if rx.search(norm): found.setdefault(ph, set()).add(ident)
                for ph, ids in found.items():
                    names_rows.append("backend-api/backend/%s | %s | %s | %s" % (f, label, ph, ", ".join(sorted(ids))[:120]))
                    names_by_file.setdefault(f, {}).setdefault(ph, 0)
                    names_by_file[f][ph] += 1
    # tests that reference removed names but were not already classified
    flagged_tests = {l.split(" | ")[0] for l in tests_edit}
    for f in sorted(names_by_file):
        if is_test(f) and f not in flagged_tests and not any(f.endswith(s) for s in ("conftest.py",)):
            tests_edit.append("%s | references removed names in: %s" % (f, ", ".join(sorted({r.split(' | ')[1] for r in names_rows if r.startswith('backend-api/backend/' + f + ' ')}))[:110]))
    # merge into one edit list: import-level and name-level, one row per kept source module
    merged = {}
    for l in edits:
        path, rest = l.split(" | ", 1)
        merged.setdefault(path.replace("backend-api/backend/", ""), {})["imports"] = rest.replace("imports: ", "")
    for f, phs in names_by_file.items():
        if not is_test(f): merged.setdefault(f, {})["names"] = phs
    edit_rows = []
    for f in sorted(merged):
        m = merged[f]
        parts = []
        if "imports" in m: parts.append("imports deleted: " + m["imports"])
        if "names" in m: parts.append("removed names: " + ", ".join("%s x%d" % (ph, n) for ph, n in sorted(m["names"].items())))
        edit_rows.append("backend-api/backend/%s | %s" % (f, " | ".join(parts)))
    w = lambda name, lines: open(os.path.join(REPO, "demolition", name), "w").write("\n".join(lines) + "\n")
    w("backend-delete.txt", ["backend-api/backend/" + f for f in delete])
    w("backend-edit.txt", edit_rows)
    w("backend-names.txt", names_rows)
    w("backend-tests.txt", ["DELETE backend-api/backend/" + t for t in tests_delete] + ["EDIT   backend-api/backend/" + t for t in tests_edit])
    print("backend modules: %d | delete: %d | kept modules to edit: %d (%d import the deleted modules, %d reference removed names)" % (len(src), len(delete), len(edit_rows), len(edits), len([f for f in merged if 'names' in merged[f]])))
    print("tests: delete %d, edit %d" % (len(tests_delete), len(tests_edit)))


main()
