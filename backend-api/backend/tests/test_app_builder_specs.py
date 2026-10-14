"""The lists in the app-builder spec pages are generated from the widgets.json schema kit."""

import pytest

from scripts.generate_app_builder_specs import BLOCKS, main, render

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
    """To rewrite them, from backend-api/backend: python -m scripts.generate_app_builder_specs"""
    assert main(["--check"]) == 0, capsys.readouterr().err


def test_a_block_is_rewritten_between_its_markers_and_the_prose_is_kept():
    page = "Before\n<!-- generated:types -->\nold rows\n<!-- /generated:types -->\nAfter\n"
    rendered = render("specs/widget-types.md", page, KIT)
    assert rendered.startswith("Before\n<!-- generated:types -->\n| Type |")
    assert "| `markdown` | Prose | Markdown | GET or POST | query, header, body, or the path |" in rendered
    assert rendered.endswith("\n<!-- /generated:types -->\nAfter\n")
    assert "old rows" not in rendered
    # An empty block is filled too
    empty = "<!-- generated:types -->\n<!-- /generated:types -->\n"
    assert render("specs/widget-types.md", empty, KIT) == rendered.removeprefix("Before\n").removesuffix("After\n")


def test_a_block_belongs_to_its_page():
    page = "<!-- generated:types -->\n<!-- /generated:types -->\n"
    with pytest.raises(SystemExit, match="no generated block named types"):
        render("specs/widgets-json.md", page, KIT)
    assert set(BLOCKS) == {"types", "returns", "widget-fields", "param-fields", "header-names"}
