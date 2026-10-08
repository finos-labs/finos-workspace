import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from files import text_files, ROOT
from scan import FAMILIES
import purge
excl = tuple(sys.argv[1].split(",")) if len(sys.argv) > 1 else ()
fams = sys.argv[2].split(",") if len(sys.argv) > 2 else ["openbb","terminal"]
n = 0
for f in text_files():
    if any(f.startswith(e) for e in excl): continue
    with open(os.path.join(ROOT, f), encoding="utf-8", errors="ignore") as fh:
        old = fh.read()
    new = purge.apply_text(f, old)
    for i, line in enumerate(new.split("\n"), 1):
        if any(FAMILIES[x].search(line) for x in fams):
            print(f"{f}:{i}: {line.strip()[:170]}")
            n += 1
print("leftover lines:", n)
