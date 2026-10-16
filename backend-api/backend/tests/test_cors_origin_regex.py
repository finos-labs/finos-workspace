from unittest.mock import patch

import pytest

from api import auth_helpers

PREVIEW_PATTERN = r"https://pr-[0-9]+\.finos\.pro\.openbq\.org"


@pytest.fixture
def cors_settings():
    with patch.object(auth_helpers, "settings") as settings:
        settings.DISABLE_CORS = False
        settings.BACKEND_CORS_ORIGINS = ["https://finos.pro.openbq.org"]
        settings.BACKEND_CORS_ORIGIN_REGEX = PREVIEW_PATTERN
        yield settings


@pytest.mark.parametrize(
    "origin",
    [
        "https://finos.pro.openbq.org",
        "https://pr-1.finos.pro.openbq.org",
        "https://pr-1234.finos.pro.openbq.org",
    ],
)
def test_allowed_origins(cors_settings, origin):
    assert auth_helpers.check_valid(origin, "/pro/validate-and-sync")


@pytest.mark.parametrize(
    "origin",
    [
        "https://pr-.finos.pro.openbq.org",
        "https://pr-abc.finos.pro.openbq.org",
        "https://pr-1.finos.pro.openbq.org.evil.com",
        "https://evilpr-1.finos.pro.openbq.org",
        "http://pr-1.finos.pro.openbq.org",
        "",
    ],
)
def test_other_origins_are_rejected(cors_settings, origin):
    assert not auth_helpers.check_valid(origin, "/pro/validate-and-sync")


def test_no_pattern_means_the_list_only(cors_settings):
    cors_settings.BACKEND_CORS_ORIGIN_REGEX = None
    assert not auth_helpers.check_valid("https://pr-1.finos.pro.openbq.org", "/pro/validate-and-sync")
