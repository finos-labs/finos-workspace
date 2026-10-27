import json

import pytest

from scripts import export_reference_data as export


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    yield


@pytest.mark.parametrize("name", sorted(export.FILES))
def test_each_collector_renders_json(name):
    assert json.loads(export.render(export.COLLECTORS[name]()))


def test_the_exporter_writes_every_file(tmp_path):
    assert export.main(["-o", str(tmp_path)]) == 0
    assert sorted(path.name for path in tmp_path.iterdir()) == sorted(export.FILES.values())
