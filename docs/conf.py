"""Sphinx configuration of the technical documentation (build: ./build.sh)."""

# -- Project information -------------------------------------------------------
project = "Intelligent Digital Twin"
copyright = "2026, Intelligent Digital Twin contributors"
author = "Intelligent Digital Twin contributors"

# -- General configuration -----------------------------------------------------
extensions = [
    "myst_parser",
    "sphinx_togglebutton",
    "sphinx_copybutton",
    "sphinxcontrib.mermaid",
]

myst_enable_extensions = [
    "dollarmath",  # inline $...$ and display $$...$$ LaTeX
    "colon_fence",  # ::: directives
    "deflist",  # definition lists
]
myst_fence_as_directive = ["mermaid"]
myst_heading_anchors = 3

# The site is served on the API's origin (/docs/), so CDN scripts run with access to the API:
# exact versions only (Sphinx's default is a floating mathjax@4), MathJax also checked by hash.
# To upgrade: change the version and recompute the hash of the new file
# (curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A).
mathjax_path = "https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-mml-chtml.js"
mathjax_options = {
    "integrity": "sha384-OrHfGTnIbkl0do3N76qW/uWr38o91N05sbSPuYBPLH+hG8X/dNSrjZf3AGjzrCwC",
    "crossorigin": "anonymous",
}
mermaid_version = "11.12.1"

source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}

# -- HTML output ---------------------------------------------------------------
html_theme = "sphinx_book_theme"
html_title = "Intelligent Digital Twin — Technical documentation"
html_theme_options = {
    "repository_url": "https://github.com/drzg15/intelligent_digital_twin_dc2heat",
    "use_repository_button": True,
    "show_toc_level": 2,
    "navigation_with_keys": True,
}
html_static_path = ["_static"]
html_css_files = ["custom.css"]

# Toggle buttons: source code collapsed by default
togglebutton_hint = "Show implementation"
togglebutton_hint_hide = "Hide implementation"

# Copy button: skip prompt characters
copybutton_prompt_text = r">>> |\.\.\. |\$ "
copybutton_prompt_is_regexp = True

exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]
