import json
import socket
import subprocess
import sys
import textwrap

import pytest

SCRIPT = textwrap.dedent(
    """
    import json
    import os
    import sys
    import urllib.request

    from utilities.prometheus_server import mark_worker_dead, serve_all_workers, use_multiprocess_values

    port = int(sys.argv[1])
    use_multiprocess_values()

    from prometheus_client import Counter, Gauge

    requests = Counter("workspace_test_requests", "Requests", ["worker"])

    serve_all_workers(port)

    def scrape():
        return urllib.request.urlopen(f"http://127.0.0.1:{port}/metrics").read().decode()

    def worker(name, count, seconds):
        pid = os.fork()
        if pid == 0:
            requests.labels(name).inc(count)
            Gauge("workspace_test_lag", "Lag", multiprocess_mode="liveall").set(seconds)
            os._exit(0)
        os.waitpid(pid, 0)
        return pid

    first = worker("first", 3, 0.5)
    second = worker("second", 4, 0.25)
    before = scrape()
    mark_worker_dead(first)
    after = scrape()
    print(json.dumps({"before": before, "after": after, "first": first, "second": second}))
    """
)


@pytest.fixture(scope="module")
def scraped():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", SCRIPT, str(port)],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.splitlines()[-1])


def lines(text: str, prefix: str) -> list[str]:
    return sorted(line for line in text.splitlines() if line.startswith(prefix))


def test_the_listener_counts_what_every_worker_did(scraped):
    assert lines(scraped["before"], "workspace_test_requests_total") == [
        'workspace_test_requests_total{worker="first"} 3.0',
        'workspace_test_requests_total{worker="second"} 4.0',
    ]


def test_a_gauge_has_a_series_for_each_live_worker(scraped):
    series = lines(scraped["before"], "workspace_test_lag")
    assert len(series) == 2
    assert any(f'pid="{scraped["first"]}"' in line for line in series)
    assert any(f'pid="{scraped["second"]}"' in line for line in series)


def test_a_worker_that_exits_leaves_its_counts_and_takes_its_gauge(scraped):
    assert lines(scraped["after"], "workspace_test_requests_total") == lines(
        scraped["before"], "workspace_test_requests_total"
    )
    [remaining] = lines(scraped["after"], "workspace_test_lag")
    assert f'pid="{scraped["second"]}"' in remaining
