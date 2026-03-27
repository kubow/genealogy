from __future__ import annotations

from pathlib import Path
from typing import Any

import streamlit.components.v1 as components


_component = components.declare_component(
    "clickable_cytoscape",
    path=str(Path(__file__).resolve().parent),
)


def clickable_cytoscape(*, elements: list[dict[str, Any]], height: int, key: str, default: str = "") -> str:
    return _component(elements=elements, height=height, key=key, default=default)
