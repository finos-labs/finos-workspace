import os
from pathlib import Path

import server
import ssrm
from identity import identity

PACKAGE = Path(os.environ.get("AG_GRID_PACKAGE") or Path(__file__).resolve().parent.parent)

ROUTES = {
    **server.ROUTES,
    "ssrm_columns": (ssrm.columns, True),
    "ssrm_rows": (ssrm.rows, True),
}

app = server.create_app(identity(PACKAGE), ROUTES)
