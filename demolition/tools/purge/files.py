"""List the repository's text files that exist on disk (tracked or not, ignoring ignored ones)."""
import os, subprocess

# demolition/tools/purge/files.py -> the repository root
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BIN = (".png",".jpg",".jpeg",".webp",".gif",".ico",".woff",".woff2",".ttf",".wasm",".mp4",".pdf",".zip",".gz",".icns",".otf",".eot",".mp3",".webm",".mov")
SKIP_PARTS = ("node_modules/", "/dist/", "__pycache__/")

def text_files(skip_demolition=True):
    out = subprocess.run(["git","ls-files","-co","--exclude-standard"],cwd=ROOT,capture_output=True,text=True).stdout.split("\n")
    res = []
    for p in sorted(set(out)):
        if not p or not os.path.isfile(os.path.join(ROOT,p)): continue
        if p.endswith(BIN): continue
        if any(s in p for s in SKIP_PARTS): continue
        if p.endswith(("bun.lock","package-lock.json","poetry.lock")): continue
        if skip_demolition and (p.startswith("demolition/") or p=="DEMOLITION-PLAN.md"): continue
        try:
            with open(os.path.join(ROOT,p),"rb") as f:
                if b"\0" in f.read(4096): continue
        except OSError: continue
        res.append(p)
    return res

if __name__ == "__main__":
    fs = text_files()
    print(len(fs))
