import pytest

from tests.fixtures.upstream import Answer, Upstream, make_certificates
from tests.fixtures.widget_plugins import approve, enable, grant, manifest, rescan, write_package
from utilities import egress
from utilities.config import settings

HOST = "quotes.example.org"
SECRET = "k3y-for-the-test"  # noqa: S105 - a test value
CALL = "/app/widget-plugins/test-chart/proxy/quote"


def proxy_manifest(port: int, **changes) -> dict:
    data = manifest()
    data["secrets"] = [{"name": "api_key", "purpose": "Reads quotes from the quote service"}]
    data["server"] = {
        "network": [f"https://{HOST}:{port}"],
        "proxies": [
            {
                "id": "quote",
                "url": f"https://{HOST}:{port}/quotes/${{arg:symbol}}",
                "query": {"period": "${arg:period}"},
                "headers": {"Authorization": "Bearer ${secret:api_key}"},
                "args": {
                    "symbol": {"type": "string", "maxLength": 12, "required": True},
                    "period": {"type": "enum", "values": ["day", "week"]},
                },
            }
        ],
    }
    widget = data["contributes"]["widgets"][0]
    widget["permissions"] = [*widget["permissions"], "core:proxy:call"]
    widget["server"] = {"proxies": ["quote"]}
    data.update(changes)
    return data


@pytest.fixture
async def upstream(tmp_path, monkeypatch):
    ca_file, cert, key = make_certificates(tmp_path, hostname=HOST)
    monkeypatch.setattr(settings, "WIDGET_PLUGIN_PROXY_CA_FILE", str(ca_file))

    async def resolve(host, _port):
        return ["127.0.0.1"] if host == HOST else []

    monkeypatch.setattr(egress, "resolve", resolve)
    async with Upstream(cert, key, lambda _r: Answer(body=b'{"price": 101.5}')) as server:
        yield server


@pytest.fixture
def secrets_dir(tmp_path, monkeypatch):
    root = tmp_path / "secrets"
    root.mkdir()
    monkeypatch.setattr(settings, "WIDGET_PLUGIN_SECRETS_DIR", str(root))
    return root


async def call(client, args: dict, *, widget: str = "chart", path: str = CALL):
    return await client.post(path, json={"widget": widget, "args": args})


async def ready(superuser, plugins_dir, port: int, *, secret: bool = True, private: bool = True, **changes):
    write_package(plugins_dir, proxy_manifest(port, **changes))
    await rescan(superuser)
    await approve(superuser)
    await enable(superuser)
    await grant(superuser)
    if secret:
        response = await superuser.put("/plugins/test-chart/secrets/api_key", json={"value": SECRET})
        assert response.status_code == 200, response.text
    if private:
        response = await superuser.put(
            "/plugins/test-chart/overrides",
            json={"server_network": [f"https://{HOST}:{port}"], "confirmations": ["private-host"]},
        )
        assert response.status_code == 200, response.text
