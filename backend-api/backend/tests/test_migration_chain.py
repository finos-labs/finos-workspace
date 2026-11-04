import re
from pathlib import Path

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"

_REVISION = re.compile(r"^revision\s*=\s*[\"']([^\"']+)[\"']", re.MULTILINE)
_DOWN_REVISION = re.compile(r"^down_revision\s*=\s*(?:[\"']([^\"']+)[\"']|None)", re.MULTILINE)


def _chain() -> dict[str, str | None]:
    chain: dict[str, str | None] = {}
    for path in sorted(VERSIONS.glob("*.py")):
        text = path.read_text()
        revision = _REVISION.search(text)
        down = _DOWN_REVISION.search(text)
        assert revision, f"{path.name} names no revision"
        assert down, f"{path.name} names no down_revision"
        assert revision.group(1) not in chain, f"{path.name} reuses the revision id {revision.group(1)}"
        chain[revision.group(1)] = down.group(1)
    return chain


def test_there_is_exactly_one_head():
    chain = _chain()
    parents = {down for down in chain.values() if down is not None}
    heads = sorted(revision for revision in chain if revision not in parents)

    assert len(heads) == 1, (
        f"The migrations have {len(heads)} heads ({', '.join(heads)}). "
        "`alembic upgrade head` refuses to run with more than one, so the API would not start. "
        "Give the new revision the current head as its down_revision."
    )


def test_every_revision_follows_one_that_exists():
    chain = _chain()

    for revision, down in chain.items():
        assert down is None or down in chain, f"{revision} follows {down}, which no file defines"


def test_no_two_revisions_share_a_parent():
    chain = _chain()
    seen: dict[str, str] = {}

    for revision, down in sorted(chain.items()):
        if down is None:
            continue
        assert down not in seen, (
            f"{revision} and {seen[down]} both follow {down}; one of them has to follow the other."
        )
        seen[down] = revision


def test_the_chain_reaches_every_revision_from_the_first():
    chain = _chain()
    firsts = [revision for revision, down in chain.items() if down is None]
    assert len(firsts) == 1, f"Expected one first revision, found {firsts}"

    children: dict[str | None, list[str]] = {}
    for revision, down in chain.items():
        children.setdefault(down, []).append(revision)

    reached, queue = set(), [firsts[0]]
    while queue:
        revision = queue.pop()
        if revision in reached:
            continue
        reached.add(revision)
        queue.extend(children.get(revision, []))

    assert reached == set(chain), f"Not reachable from {firsts[0]}: {sorted(set(chain) - reached)}"
