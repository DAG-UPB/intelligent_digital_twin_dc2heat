"""Where the app finds its data, the built web page and the technical documentation; which hosts may call it."""

import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = APP_DIR / "data"
# Shared data versions: a per-machine symlink to the user's data folder (scripts/link-data.sh), git-ignored.
DATA_VERSIONS_DIR = APP_DIR / "data_versions"
# The version chosen last on this machine (git-ignored, never in the shared folder)
DATA_VERSION_FILE = APP_DIR / ".data_version"
# SMARD's electricity market downloads (day-ahead prices, actual generation: core/market.py): app/data/_market/
# (elec_price/, elec_generation/), git-ignored like every folder of app/data but sim_*; IDT_MARKET_DATA points elsewhere
MARKET_DIR = Path(os.environ.get("IDT_MARKET_DATA") or DATA_DIR / "_market")
WEB_DIST = APP_DIR / "web" / "dist"
DOCS_HTML = APP_DIR.parent / "docs" / "_build" / "html"
# Host names the app answers to (Host header) and accepts writes from (Origin header): the local machine only,
# which stops DNS rebinding and cross-site POSTs. "testserver" is FastAPI's TestClient. Comma-separated override.
ALLOWED_HOSTS = [
    h.strip() for h in os.environ.get("IDT_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1],testserver").split(",") if h.strip()
]
