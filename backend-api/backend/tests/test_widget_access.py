from urllib.parse import quote

import pytest
from fastapi import HTTPException

from api.widget_access import check, fits, pattern_of, routes_of, segments_of

BASE = "http://backend:9000/v1"
HOST = "http://backend:9000"

WIDGETS = {
    "$schema": "https://example.org/schema.json",
    "sales": {
        "name": "Sales",
        "endpoint": "/sales",
        "params": [
            {"paramName": "region", "type": "endpoint", "optionsEndpoint": "/regions"},
            [{"paramName": "year", "type": "endpoint", "optionsEndpoint": "years", "optionsMethod": "post"}],
            {"paramName": "note", "type": "text"},
        ],
    },
    "orders": {"name": "Orders", "endpoint": "orders/{id}", "method": "post"},
    "files": {"name": "Files", "endpoint": "/files/{name}.csv"},
    "absolute": {"name": "Absolute", "endpoint": f"{BASE}/absolute"},
    "elsewhere": {"name": "Elsewhere", "endpoint": "https://other.example.org/v1/elsewhere"},
    "form": {
        "name": "Form",
        "endpoint": "/form-data",
        "params": [
            {
                "type": "form",
                "endpoint": "/forms/save/{key}",
                "inputParams": [
                    {"paramName": "a", "type": "text"},
                    {"paramName": "b", "type": "endpoint", "optionsEndpoint": "/forms/choices"},
                ],
            },
            {"type": "form", "endpoint": "/forms/update", "method": "PUT", "inputParams": []},
        ],
    },
    "live": {"name": "Live", "endpoint": "/live", "data": {"streamEndpoint": "/ws/ticks"}},
    "twin_a": {"name": "Twin A", "endpoint": "/shared"},
    "twin_b": {"name": "Twin B", "endpoint": "/shared"},
    "literal": {"name": "Literal", "endpoint": "/items/special"},
    "pattern": {"name": "Pattern", "endpoint": "/items/{id}"},
    "broken": "not a widget",
    "empty": {"name": "Empty"},
}

APPS = [
    {"name": "App", "img": "/static/app.png", "img_dark": f"{BASE}/static/dark.png", "img_light": "/static/light.png"},
    {"name": "Elsewhere", "img": "https://cdn.example.org/app.png"},
    "not an app",
]


@pytest.fixture(scope="module")
def routes():
    return routes_of(WIDGETS, APPS, BASE)


def allowed(routes, granted, method, path):
    check(routes, frozenset(granted), method, f"{HOST}{path}")


def refused(routes, granted, method, path):
    with pytest.raises(HTTPException) as error:
        allowed(routes, granted, method, path)
    assert error.value.status_code == 403
    assert error.value.headers["X-Workspace-Proxy-Error"] == "1"
    return error.value.detail


class TestSegments:
    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            ("/v1/a/b", ["v1", "a", "b"]),
            ("/v1/a/b/", ["v1", "a", "b"]),
            ("/", []),
            ("", []),
            ("/a%2Fb", ["a/b"]),
            ("/a/b%2Fc/", ["a", "b/c"]),
            ("/x%2F%2Fy", ["x//y"]),
            ("/caf%C3%A9", ["café"]),
            ("/CORP%5Calice", ["CORP\\alice"]),
            ("/100%25", ["100%"]),
            ("/50%252F", ["50%2F"]),
        ],
    )
    def test_the_segments_of_the_path_after_decoding_each_once(self, path, expected):
        assert segments_of(path) == expected

    @pytest.mark.parametrize(
        "path",
        [
            "/a/../b",
            "/a/./b",
            "/a/%2e%2e/b",
            "/a//b",
            "/a\\b",
            "/a%00b",
            "/a/%2e/b",
            "/a/x%2F..%2Fb",
            "/a/..%2Fb",
            "/a/.%2Fb",
        ],
    )
    def test_a_path_that_climbs_or_doubles_is_not_forwarded(self, path):
        assert segments_of(path) is None


class TestPatterns:
    def test_a_path_with_placeholders(self):
        assert pattern_of("/v1/orders/{id}") == (("v1",), ("orders",), ("", ""))
        assert pattern_of("/files/{name}.csv") == (("files",), ("", ".csv"))
        assert pattern_of("/{a}-{b}/x/") == (("", "-", ""), ("x",))

    @pytest.mark.parametrize("path", ["/a/../b", "/a//b", "/a/%2e%2e"])
    def test_a_path_that_cannot_be_matched_is_dropped(self, path):
        assert pattern_of(path) is None

    @pytest.mark.parametrize(
        ("literals", "segment", "expected"),
        [
            (("a",), "a", True),
            (("a",), "b", False),
            (("", ""), "x", True),
            (("", ""), "", False),
            (("", ".csv"), "q.csv", True),
            (("", ".csv"), ".csv", False),
            (("", ".csv"), "q.txt", False),
            (("pre-", ""), "pre-x", True),
            (("pre-", ""), "pre-", False),
            (("", "-", ""), "a-b", True),
            (("", "-", ""), "a-", False),
            (("", "-", ""), "-b", False),
            (("", "-", ""), "a-b-c", True),
            (("", "", ""), "ab", True),
            (("", "", ""), "a", False),
            (("a", "-", "b"), "a-b", False),
            (("a", "-", "b"), "ax-yb", True),
            (("a", "-", "b"), "ab", False),
            (("", "x", "y", ""), "1x2y3", True),
            (("", "x", "y", ""), "1y2x3", False),
        ],
    )
    def test_a_segment_against_its_literals(self, literals, segment, expected):
        assert fits(literals, segment) is expected


class TestWhatAWidgetMayCall:
    @pytest.mark.parametrize(
        ("granted", "method", "path"),
        [
            (["sales"], "GET", "/v1/sales"),
            (["sales"], "GET", "/v1/sales/"),
            (["sales"], "get", "/v1/sales"),
            (["sales"], "GET", "/v1/regions"),
            (["sales"], "POST", "/v1/years"),
            (["orders"], "POST", "/v1/orders/7"),
            (["orders"], "POST", "/v1/orders/a%20b-c"),
            (["files"], "GET", "/v1/files/q.csv"),
            (["absolute"], "GET", "/v1/absolute"),
            (["form"], "GET", "/v1/form-data"),
            (["form"], "POST", "/v1/forms/save/k"),
            (["form"], "PUT", "/v1/forms/update"),
            (["form"], "GET", "/v1/forms/choices"),
            (["live"], "GET", "/v1/ws/ticks"),
            (["twin_b"], "GET", "/v1/shared"),
            (["pattern"], "GET", "/v1/items/42"),
            (["literal", "pattern"], "GET", "/v1/items/special"),
            (["files"], "GET", "/v1/files/a%2Fb.csv"),
            (["pattern"], "GET", "/v1/items/BRK%2FB"),
            (["orders"], "POST", "/v1/orders/1%2Fsecret"),
        ],
    )
    def test_the_routes_of_the_widgets_a_role_grants(self, routes, granted, method, path):
        allowed(routes, granted, method, path)

    @pytest.mark.parametrize(
        ("granted", "method", "path"),
        [
            (["orders"], "GET", "/v1/sales"),
            (["sales"], "GET", "/v1/orders/7"),
            (["sales"], "GET", "/v1/regions-of-others"),
            ([], "GET", "/v1/sales"),
            (["sales"], "GET", "/v1/files/q.csv"),
            (["sales", "files"], "POST", "/v1/sales"),
            (["orders"], "GET", "/v1/orders/7"),
            (["sales"], "POST", "/v1/regions"),
            (["form"], "GET", "/v1/forms/update"),
            (["sales"], "GET", "/v1/ws/ticks"),
            (["pattern"], "GET", "/v1/items/special"),
            (["sales"], "GET", "/v1%2Fsales"),
            (["files"], "GET", "/v1%2Ffiles%2Fq.csv"),
        ],
    )
    def test_the_routes_of_the_others_are_refused(self, routes, granted, method, path):
        refused(routes, granted, method, path)

    def test_a_route_that_two_widgets_declare_is_open_to_either_role(self, routes):
        allowed(routes, ["twin_a"], "GET", "/v1/shared")
        allowed(routes, ["twin_b"], "GET", "/v1/shared")
        refused(routes, ["sales"], "GET", "/v1/shared")

    def test_a_path_that_two_routes_share_needs_a_grant_for_each(self, routes):
        allowed(routes, ["literal", "pattern"], "GET", "/v1/items/special")
        refused(routes, ["literal"], "GET", "/v1/items/special")
        refused(routes, ["pattern"], "GET", "/v1/items/special")
        allowed(routes, ["pattern"], "GET", "/v1/items/other")

    @pytest.mark.parametrize(
        "path", ["/v1/undeclared", "/other/sales", "/v1/elsewhere", "/v1/forms", "/v1", "/", "/v1/orders"]
    )
    def test_a_route_that_no_widget_declares_is_refused(self, routes, path):
        assert "declares no route" in refused(routes, ["sales", "orders", "files"], "GET", path)

    def test_a_widget_of_another_origin_declares_nothing_here(self, routes):
        refused(routes, ["elsewhere"], "GET", "/v1/elsewhere")

    @pytest.mark.parametrize(
        "path",
        [
            "/v1/sales/../orders/1",
            "/v1/./sales",
            "/v1/%2e%2e/v1/sales",
            "/v1/sales//",
            "/v1//sales",
            "/v1/sales%5C..%5Corders",
        ],
    )
    def test_a_path_that_climbs_is_refused_whatever_it_resolves_to(self, routes, path):
        refused(routes, ["sales", "orders"], "GET", path)

    def test_an_encoded_slash_in_a_value_stays_inside_its_segment(self, routes):
        allowed(routes, ["files"], "GET", "/v1/files/a%2Fb.csv")
        allowed(routes, ["pattern"], "GET", "/v1/items/BRK%2FB")

    def test_an_encoded_slash_cannot_stand_for_a_slash_of_the_route(self, routes):
        for path in ("/v1%2Fsales", "/v1%2Ffiles%2Fq.csv", "%2Fv1%2Fsales"):
            assert "declares no route" in refused(routes, ["sales", "files"], "GET", path)

    @pytest.mark.parametrize(
        "value",
        [
            "platform",
            "data/science",
            "BRK/B",
            "EUR/USD",
            "CORP\\alice",
            "a b",
            "café",
            "日本",
            "😀",
            "100%",
            "50%2F",
            "%2e%2e",
            "x+y",
            "a;b",
            "[1]",
            "'q'",
            '"q"',
            "...",
            "a..b",
            "1.0..2.0",
            ".hidden",
            "~tilde",
            "?x=1",
            "#frag",
            "a&b=c",
            ":@$,!*()",
            "x" * 2000,
        ],
    )
    def test_every_value_the_app_can_send_is_allowed(self, routes, value):
        segment = quote(value, safe="-_.!~*'()")
        allowed(routes, ["pattern"], "GET", f"/v1/items/{segment}")
        allowed(routes, ["files"], "GET", f"/v1/files/{segment}.csv")
        allowed(routes, ["orders"], "POST", f"/v1/orders/{segment}")

    @pytest.mark.parametrize(
        "path",
        ["/v1/files/x%2F..%2Fsales.csv", "/v1/files/..%2Fa.csv", "/v1/files/.%2Fa.csv"],
    )
    def test_a_value_may_not_climb_through_encoded_slashes(self, routes, path):
        assert "declares no route" in refused(routes, ["files", "sales"], "GET", path)

    def test_the_query_does_not_count(self, routes):
        check(routes, frozenset({"sales"}), "GET", f"{HOST}/v1/sales?region=emea&x=/v1/orders/1")

    def test_a_route_of_the_catalog_needs_no_widget(self, routes):
        for name in ("widgets.json", "apps.json", "templates.json", "agents.json"):
            allowed(routes, [], "GET", f"/v1/{name}")
        refused(routes, [], "POST", "/v1/widgets.json")

    def test_the_images_an_app_names_need_no_widget(self, routes):
        for path in ("/v1/static/app.png", "/v1/static/dark.png", "/v1/static/light.png"):
            allowed(routes, [], "GET", path)
        refused(routes, [], "GET", "/v1/app.png")
        refused(routes, [], "POST", "/v1/static/app.png")

    def test_a_connection_without_widgets_has_only_its_catalog(self):
        bare = routes_of(None, None, BASE)
        allowed(bare, [], "GET", "/v1/widgets.json")
        refused(bare, ["sales"], "GET", "/v1/sales")

    @pytest.mark.parametrize("widgets", [[], "text", 7, {"a": []}, {"a": {"endpoint": 5}}, {"a": {"params": "x"}}])
    def test_a_malformed_catalog_declares_nothing(self, widgets):
        refused(routes_of(widgets, "apps", BASE), ["a"], "GET", "/v1/a")

    def test_a_base_without_a_path(self):
        plain = routes_of({"w": {"name": "W", "endpoint": "/data"}}, [{"img": "logo.png"}], HOST)
        allowed(plain, ["w"], "GET", "/data")
        allowed(plain, [], "GET", "/widgets.json")
        allowed(plain, [], "GET", "/logo.png")
        refused(plain, ["w"], "GET", "/v1/data")

    def test_a_base_with_a_trailing_slash(self):
        slashed = routes_of({"w": {"name": "W", "endpoint": "data"}}, None, f"{BASE}/")
        allowed(slashed, ["w"], "GET", "/v1/data")
