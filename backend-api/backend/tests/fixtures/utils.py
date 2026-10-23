from typing import NoReturn, cast
from collections.abc import Callable

import pytest

skip: Callable[[str], NoReturn] = cast(Callable[[str], NoReturn], pytest.skip)
