r"""Unit tests for the search term of the chat search (api.crud).

The term is the user's, so the prefix match of its last word is made without a
regular expression: re.sub(r"(\w+)$", ...) takes time quadratic in its length.
"""

import re
import time

import pytest

from api.crud import prefix_match_last_word


@pytest.mark.parametrize(
    "term",
    [
        "",
        "abc",
        "abc def",
        "abc!",
        "abc ",
        "abc\n",
        "abc\n\n",
        "abc_",
        "été",
        "abc 123",
        "!!!",
        "a",
    ],
)
def test_matches_the_pattern_it_replaces(term):
    assert prefix_match_last_word(term) == re.sub(r"(\w+)$", r"\1:*", term)


def test_takes_linear_time_on_a_long_term():
    term = "a" * 200_000 + "!"
    started = time.perf_counter()
    assert prefix_match_last_word(term) == term
    assert time.perf_counter() - started < 0.1
