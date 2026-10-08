import re, sys, os, collections
sys.path.insert(0, os.path.dirname(__file__))
from files import text_files, ROOT

OPENBB = re.compile(r'(?i)openbb')
TERMINAL = re.compile(r'(?i)terminal')
# "pro" as its own segment: a word, a snake/kebab segment, or a camel-case word start/end
PRO = re.compile(
    r"(?<![A-Za-z])pro(?![A-Za-z])"
    r"|(?<![A-Za-z])Pro(?![a-z])|(?<=[a-z])Pro(?![a-z])"
    r"|(?<![A-Za-z])PRO(?![A-Za-z])"
)
# the abbreviation: obb-btn, OBB_ENV, obb.equity, Obb
OBB = re.compile(r"(?<![A-Za-z])(?:obb|OBB|Obb)(?![a-z])")
FAMILIES = {"obb": OBB, "openbb": OPENBB, "terminal": TERMINAL, "pro": PRO}

def scan(families=("openbb","terminal","pro"), prefix=None, exclude=()):
    hits = collections.defaultdict(list)
    for f in text_files():
        if prefix and not f.startswith(prefix): continue
        if any(f.startswith(e) for e in exclude): continue
        with open(os.path.join(ROOT,f), encoding="utf-8", errors="ignore") as fh:
            for i, line in enumerate(fh, 1):
                for fam in families:
                    if FAMILIES[fam].search(line):
                        hits[fam].append((f, i, line.rstrip("\n")))
    return hits

if __name__ == "__main__":
    fams = sys.argv[1].split(",") if len(sys.argv) > 1 else ["openbb","terminal","pro"]
    prefix = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "-" else None
    excl = tuple(sys.argv[3].split(",")) if len(sys.argv) > 3 else ()
    h = scan(fams, prefix, excl)
    for fam in fams:
        files = collections.Counter(f for f,_,_ in h[fam])
        print(f"## {fam}: {len(h[fam])} lines in {len(files)} files")
        by_area = collections.Counter(f.split('/')[0] if not f.startswith('backend-api') else '/'.join(f.split('/')[:2]) for f,_,_ in h[fam])
        print("   ", dict(by_area.most_common()))
