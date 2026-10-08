"""Apply the openbb / terminal / pro purge to the working tree.

Usage: python3 purge.py [--dry] [--only PATH_PREFIX]
Rules run in a fixed order on every text file; each rule is idempotent (its input token is gone afterwards).
"""
import os, re, sys, collections
sys.path.insert(0, os.path.dirname(__file__))
from files import text_files, ROOT
from rules_pro import IDENT as PRO_IDENT
from rules_openbb import IDENT as OB_IDENT, CAMEL_PREFIX, PHRASES as OB_PHRASES

DRY = "--dry" in sys.argv
ONLY = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
EXCLUDE = tuple(sys.argv[sys.argv.index("--exclude") + 1].split(",")) if "--exclude" in sys.argv else ()

B = r"(?<![A-Za-z0-9_])"
E = r"(?![A-Za-z0-9_])"

def word(old):
    return re.compile(B + re.escape(old) + E)

# ---------------------------------------------------------------- 1. exact literal replacements (run first)
LITERALS = [
    # session sources and the Literal lists that name them
    ('Literal["terminal", "hub", "sdk", "pro", "oauth-pro", "oauth-hub", "excel"]', 'Literal["sdk", "app", "oauth-app", "excel"]'),
    ('Literal["terminal", "hub", "sdk", "pro", "oauth-hub", "excel"]', 'Literal["sdk", "app", "oauth-app", "excel"]'),
    ('Literal["pro", "oauth-pro", "excel"]', 'Literal["app", "oauth-app", "excel"]'),
    ('source=source or "hub"', 'source=source or "app"'),
    ('["pro", "oauth-pro", "excel"]', '["app", "oauth-app", "excel"]'),
    ('["pro", "oauth-pro"]', '["app", "oauth-app"]'),
    ('["oauth-pro", "pro"]', '["oauth-app", "app"]'),
    ('"oauth-pro"', '"oauth-app"'),
    # tiers
    ('Literal["pro", "terminal"]', 'Literal["full", "basic"]'),
    ('Literal["terminal"]', 'Literal["basic"]'),
    ('z.enum(["pro", "terminal"])', 'z.enum(["full", "basic"])'),
    ('"pro" | "terminal"', '"full" | "basic"'),
    ('"pro | terminal"', '"full | basic"'),
    ('{ value: "pro", label: "Pro" }', '{ value: "full", label: "Full" }'),
    ('{ value: "terminal", label: "Terminal" }', '{ value: "basic", label: "Basic" }'),
    ('"Pro Trial"', '"Trial"'),
    ('"Pro Tier"', '"Full Tier"'),
    # lists of routers that a deployment suppresses (no router is tagged "bot" or "terminal")
    ('["bot", "terminal", "sdk", "run_tasks", "testing"]', '["sdk", "run_tasks"]'),
    ('["bot", "pro", "sdk"]', '["app", "sdk"]'),
    ('"bot", "openbb", "copilot", "excel", "findb", "pro"', '"copilot", "excel", "app"'),
    # backend paths / prefixes / tags
    ('prefix="/pro/dash"', 'prefix="/app/dash"'),
    ('prefix="/pro"', 'prefix="/app"'),
    ('tags=["pro-dash"]', 'tags=["app-dash"]'),
    ('tags=["pro-data-connectors"]', 'tags=["app-data-connectors"]'),
    ('tags=["pro-file-storage"]', 'tags=["app-file-storage"]'),
    ('tags=["pro-user-apps"]', 'tags=["app-user-apps"]'),
    ('tags=["pro"]', 'tags=["app"]'),
    ('/accepted-pro-tos', '/accepted-tos'),
    ('pro:sessions:', 'app:sessions:'),
    ("pro-file-storage-dev", "file-storage-dev"),
    ("openbb_pro_users", "workspace_users"),
    ("openbb_pro_apps", "workspace_apps"),
    ("openbb_pro_", "workspace_"),
    # kwargs
    ("pro=True", "app_session=True"),
    ("pro=pro", "app_session=app_session"),
    # CI secret names
    ("PRO_DEV_S3_BUCKET", "DEV_S3_BUCKET"),
    ("PRO_PROD_S3_BUCKET", "PROD_S3_BUCKET"),
    ("secrets.PRO_", "secrets."),
]

# ---------------------------------------------------------------- 2. regex rules (order matters)
REGEX = [
    # route strings: "/pro/..." and "pro/..." (axios relative paths) and `/pro` at the end of a string
    (re.compile(r"/pro/"), "/app/"),
    (re.compile(r"""(["'`])pro/"""), r"\1app/"),
    (re.compile(r"""(["'`])/pro\1"""), r"\1/app\1"),
    # session column / parameters of the auth helpers
    (re.compile(r"\bself\.pro\b"), "self.app_session"),
    (re.compile(r"\bSession\.pro\b"), "Session.app_session"),
    (re.compile(r"\bpro: Mapped\[bool\]"), "app_session: Mapped[bool]"),
    (re.compile(r'sa\.Column\("pro", sa\.Boolean\(\)'), 'sa.Column("app_session", sa.Boolean()'),
    (re.compile(r"\bpro: bool = False\b"), "app_session: bool = False"),
    (re.compile(r"^(\s*)pro: bool$", re.M), r"\1app_session: bool"),
    (re.compile(r"\bpro\s*: bool\b"), "app_session : bool"),
    (re.compile(r"\bif pro:"), "if app_session:"),
    (re.compile(r"(columns, tables, )pro(, from_logout)"), r"\1app_session\2"),
    (re.compile(r"(get_columns_task\(token, columns, )pro\)"), r"\1app_session)"),
    (re.compile(r"(get_table_task\(token, table, )pro\)"), r"\1app_session)"),
    (re.compile(r"(self\.columns, self\.tables, )self\.pro\b"), r"\1self.app_session"),
    (re.compile(r"(columns, tables, )pro(: bool)"), r"\1app_session\2"),
]

# ---------------------------------------------------------------- 3. tier context: "pro"/"terminal" mean tiers on lines that talk about tiers
TIER_LINE = re.compile(r"[Tt]ier|TIER|[Ee]ntitlement|\bplan\b|FeatureFlags|featureFlags|feature_entitlements")
TIER_SUBS = [
    (re.compile(r"""(\\?["'`])pro\1"""), r"\1full\1"),
    (re.compile(r"""(\\?["'`])terminal\1"""), r"\1basic\1"),
    (re.compile(r"""(\\?["'`])Pro\1"""), r"\1Full\1"),
    (re.compile(r"""(\\?["'`])Terminal\1"""), r"\1Basic\1"),
    (re.compile(r"\bpro tier\b"), "full tier"),
    (re.compile(r"\bPro tier\b"), "Full tier"),
    (re.compile(r"\bnon-pro tier\b"), "non-full tier"),
    (re.compile(r"\bterminal tier\b"), "basic tier"),
    (re.compile(r"\bTerminal tier\b"), "Basic tier"),
    (re.compile(r"\bPro Tier\b"), "Full Tier"),
]
# anywhere else a bare quoted "pro" is the name of the application (session source, subject of a token, redis database)
APP_SUBS = [
    (re.compile(r"""(\\?["'`])pro\1"""), r"\1app\1"),
]

SKIP_OPENBB = ("NOTICE", "LICENSE")
NB = r"(?:(?<![A-Za-z0-9_])|(?<=\\n))"

def apply_openbb(path, text):
    if path in SKIP_OPENBB or path.endswith("LICENSE"):
        return text
    # settings that name the removed Copilot service
    text = "\n".join(l for l in text.split("\n") if "OPENBB_AI_USER_AGENT" not in l)
    for old, new in OB_IDENT:
        text = re.compile(NB + re.escape(old) + E).sub(new, text)
    old, new = CAMEL_PREFIX
    text = re.compile(NB + old + r"(?=[A-Z])").sub(new, text)
    text = re.compile(r"(?<=[a-z])OpenBB(?=[A-Z])").sub(new, text)
    text = re.compile(r"docker exec openbb\b").sub("docker exec workspace", text)
    text = re.compile(r"--name openbb\b").sub("--name workspace", text)
    for old, new in OB_PHRASES:
        text = re.compile(NB + re.escape(old) + E).sub(new, text)
    text = re.compile(r"""(["'`])openbb\1""").sub(r"\1workspace\1", text)
    return text

def apply_text(path, text):
    for old, new in LITERALS:
        text = text.replace(old, new)
    for old, new in PRO_IDENT:
        text = word(old).sub(new, text)
    for rx, rep in REGEX:
        text = rx.sub(rep, text)
    out = []
    for line in text.split("\n"):
        if TIER_LINE.search(line):
            for rx, rep in TIER_SUBS:
                line = rx.sub(rep, line)
        for rx, rep in APP_SUBS:
            line = rx.sub(rep, line)
        out.append(line)
    return apply_openbb(path, "\n".join(out))

def main():
    changed = 0
    for f in text_files(skip_demolition=True):
        if ONLY and not f.startswith(ONLY):
            continue
        if EXCLUDE and f.startswith(EXCLUDE):
            continue
        p = os.path.join(ROOT, f)
        with open(p, encoding="utf-8", errors="surrogateescape") as fh:
            old = fh.read()
        new = apply_text(f, old)
        if new != old:
            changed += 1
            if not DRY:
                with open(p, "w", encoding="utf-8", errors="surrogateescape", newline="") as fh:
                    fh.write(new)
    print(("would change" if DRY else "changed"), changed, "files")

if __name__ == "__main__":
    main()
