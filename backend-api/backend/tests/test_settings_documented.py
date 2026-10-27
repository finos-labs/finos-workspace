import re
from pathlib import Path

import pytest

from scripts import export_reference_data as export

BACKEND = Path(__file__).resolve().parents[1]
ALIASES = {"S3_BUCKET"}
NAME = r"""["']([A-Z][A-Z0-9_]*)["']"""
ENVIRONMENT_READ = re.compile(rf"os\.(?:environ\.get|getenv)\(\s*{NAME}|os\.environ\[{NAME}\]")


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    yield


@pytest.fixture(scope="module")
def fields():
    return export.collect_settings()["fields"]


def test_every_setting_has_a_description(fields):
    assert [field["name"] for field in fields if not field["description"].strip()] == []


def test_a_description_is_a_sentence(fields):
    assert [field["name"] for field in fields if not field["description"].rstrip().endswith(".")] == []


def test_a_setting_of_a_few_values_lists_them(fields):
    by_name = {field["name"]: field for field in fields}
    assert by_name["DATABASE_TYPE"]["choices"] == ["mysql", "postgresql", "sqlite"]
    assert by_name["STORAGE_PROVIDER"]["choices"] == ["aws", "azure", "gcp", "folder"]
    assert by_name["LOG_LEVEL"]["choices"] == ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
    assert by_name["MODE"]["choices"] == ["production", "local", "test"]
    assert by_name["REDIS_SSL_CERT_REQ"]["choices"] == ["none", "optional", "required"]
    assert by_name["S3_SIGNATURE_VERSION"]["choices"] == ["s3v4", "v4"]


def test_the_code_reads_no_variable_that_is_not_a_setting(fields):
    known = {field["name"] for field in fields} | ALIASES
    unknown: dict[str, list[str]] = {}
    for path in sorted(BACKEND.rglob("*.py")):
        relative = path.relative_to(BACKEND)
        hidden = any(part.startswith(".") for part in relative.parts)
        if relative.parts[0] in {"tests", "alembic", "node_modules"} or hidden:
            continue
        for match in ENVIRONMENT_READ.finditer(path.read_text(encoding="utf-8")):
            name = match.group(1) or match.group(2)
            if name not in known:
                unknown.setdefault(name, []).append(str(relative))
    assert unknown == {}
