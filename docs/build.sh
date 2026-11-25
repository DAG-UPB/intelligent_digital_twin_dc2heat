#!/usr/bin/env bash
# Build the documentation into docs/_build/html (the backend serves it at /docs/ if it existed when the app started).
# Needs the packages of requirements.txt; without a venv: uvx --with-requirements requirements.txt --from sphinx sphinx-build ...
set -e
cd "$(dirname "$0")"
sphinx-build -W --keep-going -b html . _build/html "$@"
