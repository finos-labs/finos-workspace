import pytest

from scripts import export_reference_data as export


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    yield


@pytest.mark.parametrize("name", sorted(export.FILES))
def test_reference_data_matches_the_code(name):
    path = export.FIXTURES / export.FILES[name]
    assert export.render(export.COLLECTORS[name]()) == path.read_text(encoding="utf-8")
