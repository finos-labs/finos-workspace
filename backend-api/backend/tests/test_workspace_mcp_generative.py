from workspace_mcp.server._helpers import validate_add_generative_widget_request


def test_note_with_string_data_is_valid():
    assert (
        validate_add_generative_widget_request(widget_type="note", data="Greeting")
        is None
    )


def test_html_with_string_data_is_valid():
    assert (
        validate_add_generative_widget_request(widget_type="html", data="<p>hi</p>")
        is None
    )


def test_note_with_non_string_data_is_rejected():
    assert (
        validate_add_generative_widget_request(widget_type="note", data=[{"x": 1}])
        is not None
    )


def test_html_without_data_is_rejected():
    assert (
        validate_add_generative_widget_request(widget_type="html", data=None)
        is not None
    )
