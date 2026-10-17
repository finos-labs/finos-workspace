"""The chat search's terms: in PostgreSQL the last word of a term becomes a prefix match
(`:*`), and no term, however it is made, takes more than linear time."""

import re
import time

import pytest

from api.crud import prefix_last_word


@pytest.mark.parametrize(
    ("term", "expected"),
    [
        ("hello world", "hello world:*"),
        ("revenue_2025", "revenue_2025:*"),
        ("naïve", "naïve:*"),
        ("hello world!", "hello world!"),
        ("trailing space ", "trailing space "),
        ("", ""),
    ],
)
def test_the_last_word_becomes_a_prefix(term, expected):
    assert prefix_last_word(term) == expected
    # As the regular expression it replaces had it
    assert prefix_last_word(term) == re.sub(r"(\w+)$", r"\1:*", term)


def test_a_long_term_takes_linear_time():
    start = time.perf_counter()
    prefix_last_word("a" * 200_000 + "!")
    assert time.perf_counter() - start < 0.1
