import pytest

import scripts.generate_app_builder_specs as specs
from scripts.generate_app_builder_specs import BLOCKS, RESOURCES, main, render

KIT = {
    "types": {
        "markdown": {
            "summary": "Prose",
            "returns": "Markdown",
            "properties": {},
            "methods": ["GET", "POST"],
            "locations": ["query", "header", "body"],
            "reservedQueryNames": ["theme"],
        }
    }
}


def test_the_spec_pages_are_current(capsys):
    assert main(["--check"]) == 0, capsys.readouterr().err


def test_a_block_is_rewritten_between_its_markers_and_the_prose_is_kept():
    page = "Before\n<!-- generated:types -->\nold rows\n<!-- /generated:types -->\nAfter\n"
    rendered = render("specs/widget-types.md", page, KIT)
    assert rendered.startswith("Before\n<!-- generated:types -->\n| Type |")
    assert "| `markdown` | Prose | Markdown | GET or POST | query, header, body, or the path |" in rendered
    assert rendered.endswith("\n<!-- /generated:types -->\nAfter\n")
    assert "old rows" not in rendered
    empty = "<!-- generated:types -->\n<!-- /generated:types -->\n"
    assert render("specs/widget-types.md", empty, KIT) == rendered.removeprefix("Before\n").removesuffix("After\n")


def test_a_block_belongs_to_its_page():
    page = "<!-- generated:types -->\n<!-- /generated:types -->\n"
    with pytest.raises(SystemExit, match="no generated block named types"):
        render("specs/widgets-json.md", page, KIT)
    assert set(BLOCKS) == {"types", "returns", "widget-fields", "param-fields", "header-names"}


def test_ines_serves_the_same_pages(tmp_path, monkeypatch, capsys):
    copy = tmp_path / "app-builder"
    monkeypatch.setattr(specs, "INES_COPY", copy)
    assert main(["--check"]) == 1
    assert "ines:specs/widgets-json.md" in capsys.readouterr().err

    assert main([]) == 0
    pages = sorted(path.relative_to(RESOURCES).as_posix() for path in RESOURCES.rglob("*.md"))
    assert sorted(path.relative_to(copy).as_posix() for path in copy.rglob("*.md")) == pages
    for page in pages:
        assert (copy / page).read_bytes() == (RESOURCES / page).read_bytes()
    assert main(["--check"]) == 0

    (copy / "extra.md").write_text("mine", encoding="utf-8")
    (copy / "specs" / "widgets-json.md").write_text("edited", encoding="utf-8")
    capsys.readouterr()
    assert main(["--check"]) == 1
    assert "ines:extra.md, ines:specs/widgets-json.md" in capsys.readouterr().err
    assert main([]) == 0
    assert not (copy / "extra.md").exists()
    assert main(["--check"]) == 0
