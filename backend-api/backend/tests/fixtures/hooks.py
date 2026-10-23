import pathlib
import pytest


def pytest_collection_modifyitems(items):
    integration_dir = pathlib.Path(__file__).resolve().parents[1]

    for item in items:
        if str(integration_dir) in str(item.fspath):
            item.add_marker(pytest.mark.integration)
