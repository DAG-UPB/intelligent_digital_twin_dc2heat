"""The app on the examples only (app/data/sim_* and the other built-in examples; no data folder linked): the one to
look at, take screenshots of and run the end-to-end tests against, as no real data center is in it.

Run from app/ (port 7612 unless given):

  OMP_NUM_THREADS=1 bash scripts/guard.sh .venv/bin/python scripts/examples_app.py [port]
  E2E_BASE_URL=http://localhost:7612 npx playwright test --project=app      # from app/web/

It serves web/dist as the app on 7600 does: run `npm run build` (app/web/) after a frontend change. The version it
shows last is kept in a temporary file, never in the user's app/.data_version. It listens on 127.0.0.1; IDT_HOST
(the container: 0.0.0.0) changes that, the Host and Origin checks (IDT_ALLOWED_HOSTS) stay as they are.
"""

import os
import sys
import tempfile
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import create_app  # noqa: E402
from backend.config import DATA_DIR, DOCS_HTML, MARKET_DIR, WEB_DIST  # noqa: E402

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7612
    version_file = Path(tempfile.gettempdir()) / f"idt_examples_{port}_version"
    app = create_app(DATA_DIR, WEB_DIST, DOCS_HTML, versions_dir=None, version_file=version_file, market_dir=MARKET_DIR)
    uvicorn.run(app, host=os.environ.get("IDT_HOST", "127.0.0.1"), port=port)
