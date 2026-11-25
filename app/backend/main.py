"""The app as uvicorn runs it: ``uvicorn backend.main:app`` (see start.sh)."""

import logging

from .app import create_app
from .config import DATA_DIR, DATA_VERSION_FILE, DATA_VERSIONS_DIR, DOCS_HTML, MARKET_DIR, WEB_DIST

# the backend's own lines (a 500's traceback, how long a training took) beside uvicorn's
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app(
    DATA_DIR,
    WEB_DIST,
    DOCS_HTML,
    versions_dir=DATA_VERSIONS_DIR,
    version_file=DATA_VERSION_FILE,
    native_picker=True,
    market_dir=MARKET_DIR,
)
