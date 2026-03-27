#!/usr/bin/env python3
"""Streamlit UI for browsing the genealogy database."""

from __future__ import annotations

from pathlib import Path
import sys

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.components.clickable_cytoscape import clickable_cytoscape
from app.flask_app import (
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

        clicked_person_id = clickable_cytoscape(
            elements=elements,
            height=760,
            key="family_tree",
            default=person_id,
        )
        if clicked_person_id and clicked_person_id in people_by_id and clicked_person_id != person_id:
            st.session_state["focus_person_id"] = clicked_person_id
            st.rerun()

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
