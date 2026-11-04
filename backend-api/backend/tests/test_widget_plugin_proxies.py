import json

import pytest

from api.widget_plugins import proxy as proxy_rules
from api.widget_plugins.manifest import Manifest
from api.widget_plugins.proxy import Proxy, CallError, build_call, check_proxy
from tests.fixtures.upstream import Answer, Upstream, make_certificates
from tests.fixtures.widget_plugins import manifest
from utilities import egress
from utilities.egress import EgressRefused, blocked, check_destination, pinned_request

NETWORK = ["https://api.example.org"]
PUBLIC_V4 = "93.184.215.14"
PUBLIC_V6 = "2606:2800:21f:cb07:6820:80da:af6b:8b2c"


def make_proxy(**changes) -> Proxy:
    data = {
        "id": "quote",
        "method": "GET",
        "url": "https://api.example.org/quotes/${arg:symbol}",
        "query": {"period": "${arg:period}", "format": "json"},
        "headers": {"Authorization": "Bearer ${secret:api_key}"},
        "args": {
            "symbol": {"type": "string", "maxLength": 12, "required": True},
            "period": {"type": "enum", "values": ["day", "week"]},
        },
    }
    return Proxy.model_validate({**data, **changes})


def server_manifest(**changes) -> dict:
    data = manifest()
    data["secrets"] = [{"name": "api_key", "purpose": "Reads quotes"}]
    data["server"] = {"network": NETWORK, "proxies": [make_proxy().model_dump(exclude_none=True)]}
    widget = data["contributes"]["widgets"][0]
    widget["permissions"] = [*widget["permissions"], "core:proxy:call"]
    widget["server"] = {"proxies": ["quote"]}
    data.update(changes)
    return data


class TestTemplates:
    def test_a_valid_proxy(self):
        assert check_proxy(make_proxy(), NETWORK, {"api_key"}) == []

    @pytest.mark.parametrize(
        ("changes", "problem"),
        [
            ({"url": "http://api.example.org/quotes"}, "only https"),
            ({"url": "https://${arg:symbol}.example.org/quotes"}, "literals"),
            ({"url": "https://api.example.org:${arg:symbol}/q"}, "literals"),
            ({"url": "https://other.example.org/quotes"}, "not on server.network"),
            ({"url": "https://api.example.org/quotes?x=1"}, "no query"),
            ({"url": "https://user@api.example.org/quotes"}, "no credentials"),
            ({"url": "https://api.example.org/q/${secret:api_key}"}, "may not appear here"),
            ({"url": "https://api.example.org/q/${arg:missing}"}, "not a declared argument"),
            ({"url": "https://api.example.org/q/${env:HOME}"}, "only ${arg:<name>}"),
            ({"query": {"key": "${secret:api_key}"}}, "may not appear here"),
            ({"headers": {"X-Symbol": "${arg:symbol}"}}, "may not appear here"),
            ({"headers": {"X-Key": "${secret:other}"}}, "not a declared secret"),
            ({"headers": {"Host": "api.example.org"}}, "cannot be set"),
            ({"headers": {"Cookie": "a=b"}}, "cannot be set"),
            ({"headers": {"Accept-Encoding": "gzip"}}, "cannot be set"),
            ({"headers": {"X-Key\n": "a"}}, "cannot be set"),
            ({"headers": {"X-Key": "a\n"}}, "printable ASCII only"),
            ({"headers": {"Sec-Fetch-Site": "none"}}, "cannot be set"),
            ({"body": {"q": "${arg:symbol}"}}, "needs the method POST"),
            ({"method": "POST", "body": {"key": "${secret:api_key}"}}, "may not appear here"),
            ({"args": {"symbol": {"type": "string", "values": ["a"]}}}, "values are for an enum"),
            ({"args": {"symbol": {"type": "enum"}}}, "lists its values"),
            ({"args": {"symbol": {"type": "string", "minimum": 1}}}, "for a number"),
        ],
        ids=str,
    )
    def test_where_arguments_and_secrets_may_go(self, changes, problem):
        problems = check_proxy(make_proxy(**changes), NETWORK, {"api_key"})
        assert any(problem in p for p in problems), problems

    def test_a_wildcard_covers_the_names_under_it(self):
        assert proxy_rules.host_allowed("eu.api.example.org", 443, ["https://*.api.example.org"])
        assert not proxy_rules.host_allowed("api.example.org", 443, ["https://*.api.example.org"])
        assert not proxy_rules.host_allowed("api.example.org", 8443, NETWORK)


class TestManifest:
    def test_a_plugin_with_a_proxy_and_a_secret(self):
        Manifest.model_validate(server_manifest())

    @pytest.mark.parametrize(
        "change",
        [
            {"server": {"network": ["https://localhost"], "proxies": []}},
            {"server": {"network": ["https://10.0.0.1"], "proxies": []}},
            {"server": {"network": ["http://api.example.org"], "proxies": []}},
            {"server": {"network": ["https://api.example.org/path"], "proxies": []}},
            {"secrets": [{"name": "api_key", "purpose": "a"}, {"name": "api_key", "purpose": "b"}]},
        ],
        ids=str,
    )
    def test_invalid_server_parts(self, change):
        with pytest.raises(ValueError):
            Manifest.model_validate(server_manifest(**change))

    def test_a_widget_names_declared_proxies_with_the_permission(self):
        undeclared = server_manifest()
        undeclared["contributes"]["widgets"][0]["server"] = {"proxies": ["other"]}
        with pytest.raises(ValueError, match="not a declared proxy"):
            Manifest.model_validate(undeclared)
        without = server_manifest()
        without["contributes"]["widgets"][0]["permissions"].remove("core:proxy:call")
        with pytest.raises(ValueError, match="core:proxy:call"):
            Manifest.model_validate(without)


class TestBuild:
    SECRETS = {"api_key": "s3cret"}  # noqa: S105

    def test_arguments_and_secrets_go_where_the_template_says(self):
        call = build_call(make_proxy(), {"symbol": "BRK/B", "period": "week"}, self.SECRETS)
        assert call.method == "GET"
        assert call.url == "https://api.example.org/quotes/BRK%2FB?period=week&format=json"
        assert call.headers == {"Authorization": "Bearer s3cret", "Accept-Encoding": "identity"}
        assert call.body is None

    def test_an_absent_query_value_is_left_out_and_a_path_argument_is_required(self):
        call = build_call(make_proxy(), {"symbol": "IBM"}, self.SECRETS)
        assert call.url == "https://api.example.org/quotes/IBM?format=json"
        with pytest.raises(CallError, match="symbol is required"):
            build_call(make_proxy(), {}, self.SECRETS)

    def test_a_body_field_that_is_one_argument_keeps_its_type(self):
        proxy = make_proxy(
            method="POST",
            url="https://api.example.org/search",
            query={},
            body={"limit": "${arg:limit}", "label": "top ${arg:limit}", "fixed": True, "skip": "${arg:skip}"},
            args={"limit": {"type": "number", "minimum": 1, "maximum": 100}, "skip": {"type": "number"}},
        )
        call = build_call(proxy, {"limit": 5}, self.SECRETS)
        assert json.loads(call.body) == {"limit": 5, "label": "top 5", "fixed": True}
        assert call.headers["Content-Type"] == "application/json"

    def test_a_missing_secret_sends_nothing(self):
        with pytest.raises(CallError) as error:
            build_call(make_proxy(), {"symbol": "IBM"}, {})
        assert error.value.code == "secret_missing"

    @pytest.mark.parametrize(
        "args",
        [
            {"symbol": "IBM", "other": 1},
            {"symbol": "X" * 13},
            {"symbol": 5},
            {"symbol": "IBM", "period": "month"},
        ],
        ids=str,
    )
    def test_arguments_are_checked_against_their_types(self, args):
        with pytest.raises(CallError) as error:
            build_call(make_proxy(), args, self.SECRETS)
        assert error.value.code == "invalid_args"

    def test_an_enum_value_matches_with_its_type(self):
        proxy = make_proxy(
            url="https://api.example.org/flags", query={"on": "${arg:on}"}, args={"on": {"type": "enum", "values": [1]}}
        )
        assert build_call(proxy, {"on": 1}, self.SECRETS).url.endswith("on=1")
        with pytest.raises(CallError):
            build_call(proxy, {"on": True}, self.SECRETS)


class TestEgress:
    @pytest.mark.parametrize(
        "address",
        [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "100.64.0.1",
            "169.254.169.254",
            "0.0.0.0",  # noqa: S104
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "::",
            "fe80::1",
            "fd00:ec2::254",
            "fc00::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
            "2002:7f00:1::",
        ],
    )
    def test_addresses_that_are_not_public(self, address):
        assert blocked(address)

    @pytest.mark.parametrize("address", [PUBLIC_V4, PUBLIC_V6, f"::ffff:{PUBLIC_V4}"])
    def test_public_addresses(self, address):
        assert not blocked(address)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("url", "reason"),
        [
            ("http://api.example.org/", "only https"),
            ("https://user:pass@api.example.org/", "credentials"),
            ("https://127.0.0.1/", "not public"),
            ("https://[::1]/", "not public"),
        ],
    )
    async def test_refused_destinations(self, url, reason):
        with pytest.raises(EgressRefused, match=reason):
            await check_destination(url)

    @pytest.mark.asyncio
    async def test_every_address_a_name_resolves_to_is_checked(self, monkeypatch):
        async def resolve(_host, _port):
            return [PUBLIC_V4, "10.0.0.5"]

        monkeypatch.setattr(egress, "resolve", resolve)
        with pytest.raises(EgressRefused, match="not public"):
            await check_destination("https://api.example.org/")

    @pytest.mark.asyncio
    async def test_a_private_host_with_the_superusers_confirmation(self):
        destination = await check_destination("https://127.0.0.1:8443/x", allow_private=True)
        assert (destination.host, destination.port, destination.address) == ("127.0.0.1", 8443, "127.0.0.1")

    def test_the_connection_goes_to_the_checked_address_with_the_name_kept(self):
        destination = egress.Destination(host="api.example.org", port=443, address=PUBLIC_V6)
        request = pinned_request("GET", "https://api.example.org/q?a=1", destination, headers={"X-A": "1"})
        assert str(request.url) == f"https://[{PUBLIC_V6}]/q?a=1"
        assert request.headers["host"] == "api.example.org"
        assert request.extensions["sni_hostname"] == "api.example.org"


@pytest.fixture
def certificates(tmp_path):
    return make_certificates(tmp_path)


class TestCall:
    SECRETS = {"api_key": "s3cret"}  # noqa: S105

    def proxy(self, port: int, **changes) -> Proxy:
        return make_proxy(url=f"https://localhost:{port}/quotes/${{arg:symbol}}", **changes)

    async def run(self, upstream: Upstream, ca_file, **changes):
        return await proxy_rules.call(
            self.proxy(upstream.port, **changes),
            {"symbol": "IBM"},
            self.SECRETS,
            network=[f"https://localhost:{upstream.port}"],
            allow_private=True,
            max_bytes=1024,
            timeout_ms=2000,
            ca_file=str(ca_file),
        )

    @pytest.mark.asyncio
    async def test_the_call_reaches_the_upstream_with_the_secret_and_returns_its_json(self, certificates):
        ca_file, cert, key = certificates
        async with Upstream(cert, key, lambda _r: Answer(body=b'{"price": 101.5}')) as upstream:
            result = await self.run(upstream, ca_file)
        assert result.body == {"price": 101.5}
        assert result.content_type == "application/json"
        [received] = upstream.received
        assert received.target == "/quotes/IBM?format=json"
        assert received.headers["authorization"] == "Bearer s3cret"
        assert received.headers["host"] == f"localhost:{upstream.port}"
        assert received.headers["accept-encoding"] == "identity"

    @pytest.mark.asyncio
    async def test_the_certificate_is_verified(self, certificates, tmp_path):
        _ca, cert, key = certificates
        other = tmp_path / "other"
        other.mkdir()
        other_ca, _cert, _key = make_certificates(other)
        async with Upstream(cert, key) as upstream:
            with pytest.raises(CallError) as error:
                await self.run(upstream, other_ca)
        assert error.value.code == "upstream_unreachable"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("answer", "code"),
        [
            (Answer(status=500, body=b"secret stack trace"), "upstream_error"),
            (Answer(status=302, headers={"Location": "https://169.254.169.254/"}), "upstream_error"),
            (Answer(body=b"x" * 2048), "response_too_large"),
            (Answer(content_type="image/png", body=b"\x89PNG"), "unsupported_content_type"),
            (Answer(delay=3), "timeout"),
            (Answer(headers={"Content-Encoding": "gzip"}, body=b"\x1f\x8b"), "upstream_error"),
        ],
        ids=["5xx", "redirect", "too-large", "type", "slow", "compressed"],
    )
    async def test_failures_say_what_failed_and_no_more(self, certificates, answer, code):
        ca_file, cert, key = certificates
        async with Upstream(cert, key, lambda _r: answer) as upstream:
            with pytest.raises(CallError) as error:
                await self.run(upstream, ca_file)
        assert error.value.code == code
        assert "secret stack trace" not in error.value.message

    @pytest.mark.asyncio
    async def test_the_name_is_resolved_once_and_the_connection_goes_where_it_was_checked(self, tmp_path, monkeypatch):
        ca_file, cert, key = make_certificates(tmp_path, hostname="quotes.example.org")
        answers = [["127.0.0.1"], ["10.255.255.1"]]
        asked: list[str] = []

        async def resolve(host, _port):
            asked.append(host)
            return answers[len(asked) - 1]

        monkeypatch.setattr(egress, "resolve", resolve)
        async with Upstream(cert, key, lambda _r: Answer(body=b'{"price": 1}')) as upstream:
            result = await proxy_rules.call(
                make_proxy(url=f"https://quotes.example.org:{upstream.port}/quotes/${{arg:symbol}}"),
                {"symbol": "IBM"},
                self.SECRETS,
                network=[f"https://quotes.example.org:{upstream.port}"],
                allow_private=True,
                max_bytes=1024,
                timeout_ms=2000,
                ca_file=str(ca_file),
            )
        assert result.body == {"price": 1}
        assert asked == ["quotes.example.org"]
        assert upstream.received[0].headers["host"] == f"quotes.example.org:{upstream.port}"

    @pytest.mark.asyncio
    async def test_a_private_host_is_refused_without_the_confirmation(self, certificates):
        ca_file, cert, key = certificates
        async with Upstream(cert, key) as upstream:
            with pytest.raises(CallError) as error:
                await proxy_rules.call(
                    self.proxy(upstream.port),
                    {"symbol": "IBM"},
                    self.SECRETS,
                    network=[f"https://localhost:{upstream.port}"],
                    allow_private=False,
                    max_bytes=1024,
                    timeout_ms=2000,
                    ca_file=str(ca_file),
                )
        assert error.value.code == "egress_refused"
        assert upstream.received == []
