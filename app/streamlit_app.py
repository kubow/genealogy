#!/usr/bin/env python3
"""Streamlit UI for browsing the genealogy database."""

from __future__ import annotations

import html
from pathlib import Path
import sys

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.genealogy_core import (
    DEFAULT_ANCESTOR_DEPTH,
    DEFAULT_DESCENDANT_DEPTH,
    branch_choices,
    build_family_graph_elements,
    display_name,
    load_indexes,
    person_detail_payload,
    person_label,
)
from scripts.genealogy_builder import DATA_PATH


def render_streamlit_tree(elements: list[dict], *, height: int = 760) -> None:
    node_map = {}
    edges: list[tuple[str, str]] = []
    for element in elements:
        data = element.get("data", {})
        element_id = data.get("id", "")
        if not element_id:
            continue
        if "source" in data and "target" in data:
            if data.get("kind") == "order":
                continue
            edges.append((data["source"], data["target"]))
        else:
            node_map[element_id] = data

    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_map}
    indegree: dict[str, int] = {node_id: 0 for node_id in node_map}
    for source, target in edges:
        if source not in node_map or target not in node_map:
            continue
        adjacency[source].append(target)
        indegree[target] += 1

    queue = [node_id for node_id, degree in indegree.items() if degree == 0]
    queue.sort(key=lambda node_id: int(node_map[node_id].get("layout_order", 0)))
    levels = {node_id: 0 for node_id in queue}
    visited = 0
    while queue:
        current = queue.pop(0)
        visited += 1
        current_level = levels.get(current, 0)
        for neighbor in adjacency.get(current, []):
            levels[neighbor] = max(levels.get(neighbor, 0), current_level + 1)
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)
                queue.sort(key=lambda node_id: (levels.get(node_id, 0), int(node_map[node_id].get("layout_order", 0))))

    if visited < len(node_map):
        for node_id in node_map:
            levels.setdefault(node_id, 0)

    columns: dict[int, list[str]] = {}
    for node_id, level in levels.items():
        columns.setdefault(level, []).append(node_id)
    for level_nodes in columns.values():
        level_nodes.sort(key=lambda node_id: int(node_map[node_id].get("layout_order", 0)))

    max_nodes = max((len(level_nodes) for level_nodes in columns.values()), default=1)
    person_width = 180
    family_size = 18
    node_gap_x = 44
    node_gap_y = 118
    margin_x = 28
    margin_y = 24
    width = max(760, margin_x * 2 + max_nodes * (person_width + node_gap_x))
    svg_height = max(height, margin_y * 2 + len(columns) * (86 + node_gap_y))

    positions: dict[str, tuple[float, float]] = {}
    for level, level_nodes in sorted(columns.items()):
        row_width = len(level_nodes) * person_width + max(0, len(level_nodes) - 1) * node_gap_x
        start_x = (width - row_width) / 2
        y = margin_y + level * (86 + node_gap_y)
        for index, node_id in enumerate(level_nodes):
            positions[node_id] = (start_x + index * (person_width + node_gap_x), y)

    parts = [
        "<!doctype html><html><body style='margin:0;background:transparent;'>",
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{width}' height='{svg_height}' viewBox='0 0 {width} {svg_height}' style='max-width:100%;height:auto;display:block;'>",
    ]

    for source, target in edges:
        if source not in positions or target not in positions:
            continue
        sx, sy = positions[source]
        tx, ty = positions[target]
        source_kind = node_map[source].get("kind", "")
        target_kind = node_map[target].get("kind", "")
        source_y = sy + (40 if source_kind == "person" else 9)
        target_y = ty + (40 if target_kind == "person" else 9)
        source_x = sx + (person_width / 2 if source_kind == "person" else 9)
        target_x = tx + (person_width / 2 if target_kind == "person" else 9)
        mid_y = source_y + (target_y - source_y) / 2
        path = f"M {source_x:.1f} {source_y:.1f} L {source_x:.1f} {mid_y:.1f} L {target_x:.1f} {mid_y:.1f} L {target_x:.1f} {target_y:.1f}"
        parts.append(f"<path d='{path}' fill='none' stroke='#a08f73' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' />")

    for node_id, data in node_map.items():
        x, y = positions.get(node_id, (margin_x, margin_y))
        kind = data.get("kind", "")
        is_selected = data.get("selected") == "true"
        is_path = data.get("path") == "true"
        if kind == "family":
            fill = "#dd6b20" if is_path else "#c9b392"
            stroke = "#9c4221" if is_path else "#987f5e"
            diamond = [
                (x + family_size / 2, y),
                (x + family_size, y + family_size / 2),
                (x + family_size / 2, y + family_size),
                (x, y + family_size / 2),
            ]
            points = " ".join(f"{px:.1f},{py:.1f}" for px, py in diamond)
            parts.append(f"<polygon points='{points}' fill='{fill}' stroke='{stroke}' stroke-width='1.5' />")
            continue

        fill = "#fffdf7"
        stroke = "#ccb999"
        stroke_width = 2
        if is_selected:
            fill = "#fff2cc"
            stroke = "#b7791f"
            stroke_width = 3
        if is_path:
            fill = "#fff0df"
            stroke = "#c05621"
            stroke_width = 4

        label = data.get("label", "")
        dates = data.get("dates", "")
        lines = [line for line in [label, dates] if line]
        parts.append(
            f"<rect x='{x:.1f}' y='{y:.1f}' rx='14' ry='14' width='{person_width}' height='80' fill='{fill}' stroke='{stroke}' stroke-width='{stroke_width}' />"
        )
        text_x = x + person_width / 2
        text_y = y + 28
        parts.append(f"<text x='{text_x:.1f}' y='{text_y:.1f}' text-anchor='middle' font-family='Georgia, serif' font-size='13' font-weight='700' fill='#3b2c18'>")
        for idx, line in enumerate(lines[:3]):
            dy = "0" if idx == 0 else "18"
            safe_line = html.escape(line)
            parts.append(f"<tspan x='{text_x:.1f}' dy='{dy}'>{safe_line}</tspan>")
        parts.append("</text>")

    parts.append("</svg></body></html>")
    components.html("".join(parts), height=height + 24, scrolling=False)


def main() -> None:
    st.set_page_config(page_title="Genealogy Tree", layout="wide")

    _, people, events, _, people_by_id, children_by_parent, marriages, sources_by_id = load_indexes()
    if not people:
        st.error(f"No people found in {DATA_PATH}.")
        return

    st.title("Genealogy Tree")
    st.caption("Branch selector on the left, tree in the center, details on the right.")

    with st.sidebar:
        st.header("Focus")
        query = st.text_input("Search people", placeholder="Name, ID, place")
        matches = [
            person
            for person in people
            if not query
            or query.lower() in person.get("name", "").lower()
            or query.lower() in person.get("id", "").lower()
            or query.lower() in person.get("birth_place", "").lower()
            or query.lower() in person.get("death_place", "").lower()
        ]
        if not matches:
            st.warning("No people match the current search.")
            return

        default_focus_id = st.session_state.get("focus_person_id", matches[0]["id"])
        selected_person = st.selectbox(
            "Person",
            matches,
            index=next((idx for idx, candidate in enumerate(matches) if candidate["id"] == default_focus_id), 0),
            format_func=person_label,
        )
        st.session_state["focus_person_id"] = selected_person["id"]

        branch_options = branch_choices(selected_person["id"], people_by_id, children_by_parent)
        branch_target = st.selectbox(
            "Branch",
            [None] + branch_options,
            index=0,
            format_func=lambda option: "None" if option is None else option["label"],
            disabled=not branch_options,
        )
        branch_only = st.toggle("Show only selected branch", value=False, disabled=branch_target is None)

    person_id = selected_person["id"]
    branch_target_id = branch_target["target_id"] if branch_target else ""
    elements, branch_found = build_family_graph_elements(
        person_id,
        people_by_id,
        children_by_parent,
        marriages,
        DEFAULT_ANCESTOR_DEPTH,
        DEFAULT_DESCENDANT_DEPTH,
        branch_target_id=branch_target_id,
        branch_only=branch_only,
    )

    left, right = st.columns([2, 1])

    with left:
        st.subheader(selected_person.get("name", "Unnamed person"))
        if branch_target and not branch_found:
            st.caption("Selected branch target is outside the current branch window.")
        elif branch_target:
            st.caption(f"Branch routes to youngest member: {person_label(people_by_id.get(branch_target_id, {}))}")

        render_streamlit_tree(elements, height=760)

    with right:
        payload = person_detail_payload(
            person_id,
            people_by_id,
            people,
            events,
            sources_by_id,
            children_by_parent,
            marriages,
        )
        person = payload.get("person", {})
        st.subheader("Details")
        st.write(f"{display_name(person, people_by_id)} ({person.get('id', '')})")
        st.write(f"Birth: {person.get('birth_date', '')} {person.get('birth_place', '')}".strip())
        st.write(f"Death: {person.get('death_date', '')} {person.get('death_place', '')}".strip())
        st.write(f"Confidence: {person.get('confidence', '')}")
        st.write(f"Provenance: {person.get('provenance', '')}")

        relations = payload.get("relations", {})
        if relations.get("father"):
            st.write(f"Father: {relations['father']['label']}")
        if relations.get("mother"):
            st.write(f"Mother: {relations['mother']['label']}")
        if relations.get("partners"):
            st.write("Partners:")
            for partner in relations["partners"]:
                st.write(f"- {partner['label']}")
        if relations.get("children"):
            st.write("Children:")
            for child in relations["children"]:
                st.write(f"- {child['label']}")

        if payload.get("events"):
            st.write("Events:")
            for event in payload["events"]:
                bits = [event.get("type", ""), event.get("date", ""), event.get("place", "")]
                st.write(f"- {' | '.join(bit for bit in bits if bit)}")

        if payload.get("sources"):
            st.write("Sources:")
            for source in payload["sources"]:
                bits = [source.get("id", ""), source.get("title", ""), source.get("date", "")]
                st.write(f"- {' | '.join(bit for bit in bits if bit)}")


if __name__ == "__main__":
    main()
