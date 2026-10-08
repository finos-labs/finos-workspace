#!/usr/bin/env python3
"""Vendor and company references that survive the delete lists.

Reads frontend-delete.txt, backend-delete.txt, the DELETE rows of the two test lists and other-delete.txt, then scans
every other tracked text file for the term groups below. Writes demolition/residual-references.txt (one row per file)
and prints a summary. A hit is a candidate to remove by hand, not a verdict: the groups are deliberately broad and a
file can match for an unrelated reason (read the line before changing it).

Skipped: NOTICE and the LICENSE files (legal text), lockfiles (regenerated), and the plan itself (demolition/, DEMOLITION-PLAN.md).
"""
import fnmatch, os, re, subprocess
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
D = os.path.join(REPO, "demolition")

GROUPS = {
    "charting-grid": r"tradingview|charting_library|highcharts|ag-grid|ag-charts|aggrid|allenterprisemodule|licensemanager|plotly|\bvega\b|vega-lite|react-vega",
    "analytics-crm-billing": r"posthog|hubspot|mailchimp|mandrill|stripe(?![ds])|chargebee|\bjira|atlassian|formbricks|directus|liveblocks",
    # Snowflake itself stays (Native App hosting and sign-in); its SQL data connector goes through the cut lists
    "warehouse-connectors": r"databricks|clickhouse",
    "ai-services": r"nixtla|openbbrss",
    "data-vendors": r"\bpyth\b|pythnetwork|benzinga|intrinio|econdb|tradingeconomics|polygon\.io|alphavantage|alpha_vantage|financialmodelingprep|\bfmp\b|_fmp\b|\bfmp_|defillama|datagolf|polymarket|veraset|datarade",
    "company-hosts": r"openbb\.(co|dev|finance|app|link)|openbb-finance/|openbb[\w-]*\.vercel\.app|\b467649407693\b|\b149911392452\b",
    # hosting and identity services stay (S3, Azure, GCP, Cloudflare, ECR, GHCR); only company secrets and keys are flagged
    "cloud-secrets": r"ipgeolocation|whsec_|phc_|using_this_\{ag",
    "desktop-and-fonts": r"\btauri\b|fonts\.googleapis|fonts\.gstatic",
    "chat-links": r"zoom\.us|slack\.com|discord\.(gg|com)|atlassian\.net",
    # callers of backend routes and response fields that the plan removes (kept frontend, admin and test code)
    # the product and tier names, the abbreviation of the product, and the removed trial concept
    "removed-names": r"openbb|terminal|(?<![a-z])ob" r"b(?![a-z])|(?<![a-z])pro(?![a-z])|(?<=[a-z])pro(?![a-z])|trial",
    "removed-api": r"invite-emails|/pro/register|/forgot-password|/resend-confirmation|/confirm-account|/marketing\b|/newsletter|support-confirmation|/profileimage|/metrics/users|extend-trial-email|/transfer-user|create-account|invites/create|invites/remaining|/tv-state|developer-onboarding|zero-to-hero|enabled-bundles|/admin/providers|/entity/takeover|/single-widget|/run-tasks/(pat-token-check|give-pro-trial|send-four)|/stripe\b|(?<![\w-])/register\b|(?<![\w-])/booking\b|(?<![\w-])/news\b|tv_state|single_widgets|pro_zero_to_hero|developer_onboarding_info|enabled_widget_bundles|\btrading_view\b|stripe_id|pro_entitlements|\b(registerUser|forgotPassword|forgotPasswordConfirmation|submitDeveloperOnboardingQuestions|getDeveloperOnboardingQuestions|getSingleWidgets|postSingleWidget|deleteSingleWidget|PostSingleWidget|setSingleWidgets|getEnabledBundles|putEnabledBundles|getNewsletters|putNewsletters|getRemainingInvites|sendInvite|postUserTVState|updateZeroToHero)\b",
}
SKIP_PREFIX = ("demolition/", "DEMOLITION-PLAN.md", "NOTICE", "LICENSE", "excel-add-in/LICENSE")
# Files a group does not apply to: the backend routers define the kept routes (the removed ones are deleted),
# so "removed-api" only looks at callers.
# The add-in's task pane has its own /auth/forgot-password page; it is not a call to the removed backend route.
GROUP_SKIP = {"removed-api": ("backend-api/backend/routers/", "backend-api/backend/main.py", "excel-add-in/src/taskpane/pages/")}
LOCK = re.compile(r"(^|/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock)$")


def lines(name):
    return [l.rstrip("\n") for l in open(os.path.join(D, name)) if l.strip() and not l.startswith("#")]


def main():
    files = [p for p in subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=REPO, capture_output=True, text=True).stdout.split("\n") if p and os.path.exists(os.path.join(REPO, p))]
    gone = set(lines("frontend-delete.txt")) | set(lines("backend-delete.txt"))
    for name in ("frontend-tests.txt", "backend-tests.txt"):
        for l in lines(name):
            if l.startswith("DELETE "): gone.add(l.split()[1])
    globs = lines("other-delete.txt")
    rx = {g: re.compile(p, re.I) for g, p in GROUPS.items()}
    rows, per_group, per_area = [], Counter(), defaultdict(Counter)
    for p in files:
        if p in gone or p.startswith(SKIP_PREFIX) or LOCK.search(p) or any(fnmatch.fnmatch(p, g) for g in globs): continue
        try: b = open(os.path.join(REPO, p), "rb").read()
        except OSError: continue
        if b"\0" in b[:4096]: continue
        t = b.decode("utf-8", "replace")
        hit = {}
        for g, r in rx.items():
            if p.startswith(GROUP_SKIP.get(g, ())):
                continue
            n = len(r.findall(t))
            if n: hit[g] = n
        if not hit: continue
        rows.append("%s | %s" % (p, ", ".join("%s:%d" % (g, n) for g, n in sorted(hit.items()))))
        area = "/".join(p.split("/")[:2]) if p.startswith("frontend/src") or p.startswith("backend-api/") else p.split("/")[0]
        for g in hit:
            per_group[g] += 1
            per_area[area][g] += 1
    open(os.path.join(D, "residual-references.txt"), "w").write("\n".join(sorted(rows)) + "\n")
    print("files that still mention a vendor or company term after the delete lists: %d" % len(rows))
    print("%-24s %s" % ("group", "files"))
    for g, n in per_group.most_common(): print("%-24s %5d" % (g, n))
    print("\nby area (files):")
    for a, c in sorted(per_area.items(), key=lambda kv: -sum(kv[1].values())):
        print("  %-34s %s" % (a, ", ".join("%s %d" % (g, n) for g, n in c.most_common())))


main()
