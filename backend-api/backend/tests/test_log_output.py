import json
from types import SimpleNamespace

import pytest
from loguru import logger

from utilities.config import settings
from utilities.log_helpers import setup_logging


@pytest.fixture
def logging_as(capsys):
    def configure(*, json_logs: bool, level: str = "INFO"):
        setup_logging(
            SimpleNamespace(JSON_LOGS=json_logs, LOGURU_COLORIZE=False, LOG_LEVEL=level)
        )
        capsys.readouterr()

    yield configure
    settings.setup_logging()


def written(capsys) -> list[str]:
    return [line for line in capsys.readouterr().out.splitlines() if line]


def test_a_record_is_written_once_as_text(logging_as, capsys):
    logging_as(json_logs=False)

    logger.info("signed in")

    [line] = written(capsys)
    assert "|INFO|" in line
    assert line.endswith("- signed in")


def test_a_record_is_written_once_as_json(logging_as, capsys):
    logging_as(json_logs=True)

    logger.bind(path="/health", status_code=200).info("served")

    [line] = written(capsys)
    record = json.loads(line)
    assert record["levelname"] == "INFO"
    assert record["message"] == "served"
    assert record["path"] == "/health"
    assert record["status_code"] == 200
    assert {"asctime", "name", "function", "line"} <= record.keys()


@pytest.mark.parametrize("json_logs", [False, True])
def test_a_record_below_the_level_is_not_written(logging_as, capsys, json_logs):
    logging_as(json_logs=json_logs, level="WARNING")

    logger.info("chatty")
    logger.warning("careful")

    [line] = written(capsys)
    assert "careful" in line
    assert "chatty" not in capsys.readouterr().out


def test_a_record_marked_to_exclude_stays_out_of_the_json(logging_as, capsys):
    logging_as(json_logs=True)

    logger.info("noise", exclude=True)
    logger.info("signal")

    [line] = written(capsys)
    assert json.loads(line)["message"] == "signal"
