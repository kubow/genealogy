#!/usr/bin/env python3
from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from scripts.genealogy_builder import find_person_candidates, load_db

DEFAULT_ANCESTOR_DEPTH = 4
DEFAULT_DESCENDANT_DEPTH = 4
REVIEW_PROVENANCES = {"myheritage"}
REVIEW_CONFIDENCES = {"possible", "open"}


def ordered_partner_ids(
    left_pid: str,
    right_pid: str,
    people_by_id: dict[str, dict[str, str]],
) -> tuple[str, str]:
    if not left_pid or not right_pid:
        return left_pid, right_pid
    left = people_by_id.get(left_pid, {})
    right = people_by_id.get(right_pid, {})
    left_sex = left.get("sex", "")
    right_sex = right.get("sex", "")
    if left_sex == "F" and right_sex == "M":
        return right_pid, left_pid
    if left_sex == right_sex and chronological_sort_key(left) > chronological_sort_key(right):
        return right_pid, left_pid
    return left_pid, right_pid


def validate_parent_links(
    people_by_id: dict[str, dict[str, str]],
    person_id: str,
    father_id: str,
    mother_id: str,
) -> str | None:
    if father_id and father_id not in people_by_id:
        return f"Unknown father ID: {father_id}"
    if mother_id and mother_id not in people_by_id:
        return f"Unknown mother ID: {mother_id}"
    if father_id and father_id == person_id:
        return "Father cannot point to the same person."
    if mother_id and mother_id == person_id:
        return "Mother cannot point to the same person."
    if father_id and father_id == mother_id:
        return "Father and mother cannot point to the same person."
    return None


def validate_event_links(
    people_by_id: dict[str, dict[str, str]],
    event_type: str,
    person_id: str,
    groom_id: str,
    bride_id: str,
) -> str | None:
    for label, related_id in (("person", person_id), ("groom", groom_id), ("bride", bride_id)):
        if related_id and related_id not in people_by_id:
            return f"Unknown {label} ID: {related_id}"
    if groom_id and groom_id == bride_id:
        return "Groom and bride cannot point to the same person."
    if event_type.strip().lower() == "marriage" and not groom_id and not bride_id:
        return "Marriage events must link at least one spouse."
    return None


def person_label(person: dict[str, str], people_by_id: dict[str, dict[str, str]] | None = None) -> str:
    name = display_name(person, people_by_id)
    birth = person.get("birth_date", "") or "?"
    death = person.get("death_date", "")
    years = f"{birth} - {death}" if death else f"b. {birth}"
    return f"{name} ({years})"


def surname_of(person: dict[str, str] | None) -> str:
    if not person:
        return ""
    for key in ("married_surname", "birth_surname"):
        value = (person.get(key) or "").strip()
        if value:
            return value
    parts = (person.get("name") or "").strip().split()
    return parts[-1] if len(parts) > 1 else ""


def display_name(person: dict[str, str] | None, people_by_id: dict[str, dict[str, str]] | None = None) -> str:
    if not person:
        return "Unnamed person"
    name = person.get("name") or "Unnamed person"
    birth_surname = (person.get("birth_surname") or "").strip()
    married_surname = (person.get("married_surname") or "").strip()
    parts = name.strip().split()

    if person.get("sex") == "M" and birth_surname:
        if len(parts) <= 1:
            return f"{name} {birth_surname}".strip() if birth_surname.lower() not in name.lower() else name
        given = " ".join(parts[:-1])
        current_surname = parts[-1]
        if current_surname.lower() != birth_surname.lower():
            return f"{given} {birth_surname}".strip()
        return name

    if married_surname and birth_surname and married_surname.lower() != birth_surname.lower():
        given = " ".join(parts[:-1]) if len(parts) > 1 else name.strip()
        return f"{given} {married_surname} ({birth_surname})".strip()
    if birth_surname and not married_surname:
        if len(parts) <= 1:
            return f"{name} ({birth_surname})" if birth_surname.lower() not in name.lower() else name
        given = " ".join(parts[:-1])
        current_surname = parts[-1]
        if current_surname.lower() != birth_surname.lower():
            return f"{given} {current_surname} ({birth_surname})"
        return name
    if married_surname and not birth_surname:
        given = " ".join(parts[:-1]) if len(parts) > 1 else name.strip()
        current_surname = parts[-1] if len(parts) > 1 else ""
        if current_surname.lower() != married_surname.lower():
            return f"{given} {married_surname}".strip()
        return name

    if person.get("sex") != "F" or not people_by_id:
        return name
    father = people_by_id.get(person.get("father", ""), {})
    father_surname = surname_of(father)
    if not father_surname:
        return name
    parts = name.strip().split()
    if len(parts) < 2:
        return name
    current_surname = parts[-1]
    if current_surname.lower() == father_surname.lower():
        return name
    given = " ".join(parts[:-1])
    return f"{given} {current_surname} ({father_surname})"


def graph_dates_line(person: dict[str, str] | None) -> str:
    if not person:
        return ""
    birth = person.get("birth_date", "").strip()
    death = person.get("death_date", "").strip()
    if birth and death:
        return f"{birth}          {death}"
    if birth:
        return birth
    if death:
        return death
    return ""


def life_span(person: dict[str, str] | None) -> str:
    if not person:
        return "Unknown dates"
    birth = person.get("birth_date", "") or "?"
    death = person.get("death_date", "")
    return f"{birth} - {death}" if death else f"b. {birth}"


def birth_sort_key(person: dict[str, str] | None) -> tuple[int, str, str]:
    if not person:
        return (0, "", "")
    birth_date = person.get("birth_date", "").strip()
    return (1 if birth_date else 0, birth_date, person.get("name", ""))


def chronological_sort_key(person: dict[str, str] | None) -> tuple[str, str]:
    if not person:
        return ("9999", "")
    return (person.get("birth_date", "").strip() or "9999", person.get("name", ""))


def person_needs_review(person: dict[str, str]) -> bool:
    return person.get("provenance", "") in REVIEW_PROVENANCES or person.get("confidence", "") in REVIEW_CONFIDENCES


def review_candidates(person_id: str, people: list[dict[str, str]], limit: int = 6) -> list[dict[str, Any]]:
    person = next((item for item in people if item.get("id") == person_id), None)
    if not person:
        return []
    candidates = find_person_candidates(person, [item for item in people if item.get("id") != person_id], limit=limit)
    return [
        {
            "id": candidate.get("id", ""),
            "label": f"{candidate.get('id', '')} {candidate.get('name', '')}".strip(),
            "score": candidate.get("score", 0),
            "birth_date": candidate.get("birth_date", ""),
            "death_date": candidate.get("death_date", ""),
            "provenance": candidate.get("provenance", ""),
            "reasons": candidate.get("reasons", []),
        }
        for candidate in candidates
    ]


def merge_person_records(db: dict[str, Any], source_id: str, target_id: str) -> None:
    if source_id == target_id:
        raise ValueError("Cannot merge a person into itself.")

    source = next((person for person in db["people"] if person.get("id") == source_id), None)
    target = next((person for person in db["people"] if person.get("id") == target_id), None)
    if source is None or target is None:
        raise ValueError("Missing merge source or target.")

    for key in ["name", "sex", "birth_date", "birth_place", "death_date", "death_place", "father", "mother"]:
        if not target.get(key) and source.get(key):
            target[key] = source[key]

    confidence_rank = {"": 0, "open": 1, "possible": 2, "probable": 3, "confirmed": 4}
    if confidence_rank.get(source.get("confidence", ""), 0) > confidence_rank.get(target.get("confidence", ""), 0):
        target["confidence"] = source.get("confidence", "")

    if target.get("provenance") in {"", "myheritage"} and source.get("provenance") not in {"", "myheritage"}:
        target["provenance"] = source.get("provenance", "")

    note_bits = [bit.strip() for bit in [target.get("notes", ""), source.get("notes", ""), f"Merged from {source_id}."] if bit.strip()]
    target["notes"] = "\n\n".join(dict.fromkeys(note_bits))

    for person in db["people"]:
        if person.get("id") == target_id:
            if person.get("father") == source_id:
                person["father"] = ""
            if person.get("mother") == source_id:
                person["mother"] = ""
            continue
        if person.get("father") == source_id:
            person["father"] = target_id
        if person.get("mother") == source_id:
            person["mother"] = target_id

    for event in db["events"]:
        for key in ["person_id", "groom_id", "bride_id"]:
            if event.get(key) == source_id:
                event[key] = target_id
        if event.get("groom_id") == event.get("bride_id") and event.get("groom_id"):
            event["bride_id"] = ""

    db["people"] = [person for person in db["people"] if person.get("id") != source_id]


def promote_person_record(person: dict[str, str], provenance: str, confidence: str, note: str) -> None:
    if provenance:
        person["provenance"] = provenance
    if confidence:
        person["confidence"] = confidence
    if note.strip():
        note_bits = [bit.strip() for bit in [person.get("notes", ""), note.strip()] if bit.strip()]
        person["notes"] = "\n\n".join(dict.fromkeys(note_bits))


def load_indexes() -> tuple[dict[str, Any], list[dict[str, str]], list[dict[str, Any]], list[dict[str, str]], dict[str, dict[str, str]], dict[str, list[str]], dict[tuple[str, str], dict[str, Any]], dict[str, dict[str, str]]]:
    db = load_db()
    people = list(db["people"])
    events = list(db["events"])
    sources = list(db["sources"])
    people_by_id = {person["id"]: person for person in people if person.get("id")}
    sources_by_id = {source["id"]: source for source in sources if source.get("id")}

    children_by_parent: dict[str, list[str]] = defaultdict(list)
    for person in people:
        child_id = person.get("id", "")
        for parent_key in ("father", "mother"):
            parent_id = person.get(parent_key, "")
            if parent_id and child_id:
                children_by_parent[parent_id].append(child_id)

    marriages: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        if event.get("event_type", "").lower() != "marriage":
            continue
        groom_id = event.get("groom_id", "")
        bride_id = event.get("bride_id", "")
        if groom_id and bride_id:
            marriages[(groom_id, bride_id)] = event
            marriages[(bride_id, groom_id)] = event

    for parent_id in list(children_by_parent.keys()):
        children_by_parent[parent_id] = sorted(
            children_by_parent[parent_id],
            key=lambda pid: (
                people_by_id.get(pid, {}).get("birth_date", "9999"),
                people_by_id.get(pid, {}).get("name", ""),
            ),
        )

    people.sort(key=lambda person: (person.get("name", "").lower(), person.get("birth_date", "")))
    return db, people, events, sources, people_by_id, dict(children_by_parent), marriages, sources_by_id


def children_of_pair(people_by_id: dict[str, dict[str, str]], father_id: str, mother_id: str) -> list[str]:
    children = [
        person_id
        for person_id, person in people_by_id.items()
        if person.get("father", "") == father_id and person.get("mother", "") == mother_id
    ]
    return sorted(children, key=lambda pid: (people_by_id[pid].get("birth_date", "9999"), people_by_id[pid].get("name", "")))


def partner_groups(
    person_id: str,
    people_by_id: dict[str, dict[str, str]],
    children_by_parent: dict[str, list[str]],
    marriages: dict[tuple[str, str], dict[str, Any]],
) -> list[tuple[str, list[str], dict[str, Any] | None]]:
    grouped_children: dict[str, list[str]] = defaultdict(list)
    for child_id in children_by_parent.get(person_id, []):
        child = people_by_id.get(child_id, {})
        if child.get("father") == person_id:
            grouped_children[child.get("mother", "")].append(child_id)
        else:
            grouped_children[child.get("father", "")].append(child_id)

    spouse_ids = set(grouped_children.keys())
    for left_id, right_id in marriages:
        if left_id == person_id and right_id:
            spouse_ids.add(right_id)

    groups: list[tuple[str, list[str], dict[str, Any] | None]] = []
    for spouse_id in spouse_ids:
        child_ids = sorted(
            grouped_children.get(spouse_id, []),
            key=lambda pid: (people_by_id.get(pid, {}).get("birth_date", "9999"), people_by_id.get(pid, {}).get("name", "")),
        )
        groups.append((spouse_id, child_ids, marriages.get((person_id, spouse_id))))
    return sorted(
        groups,
        key=lambda item: (
            item[2].get("date", "") if item[2] else "",
            people_by_id.get(item[1][0], {}).get("birth_date", "9999") if item[1] else "9999",
            chronological_sort_key(people_by_id.get(item[0])),
        ),
    )


def shortest_path(start: str, target: str, edges: list[tuple[str, str]]) -> list[str]:
    if not start or not target:
        return []
    if start == target:
        return [start]
    adjacency: dict[str, set[str]] = defaultdict(set)
    for left, right in edges:
        adjacency[left].add(right)
        adjacency[right].add(left)
    queue = deque([(start, [start])])
    seen = {start}
    while queue:
        node, path = queue.popleft()
        for neighbor in adjacency.get(node, set()):
            if neighbor in seen:
                continue
            next_path = path + [neighbor]
            if neighbor == target:
                return next_path
            seen.add(neighbor)
            queue.append((neighbor, next_path))
    return []


def collect_descendants(root_id: str, children_by_parent: dict[str, list[str]]) -> set[str]:
    descendants: set[str] = set()
    queue = deque(children_by_parent.get(root_id, []))
    while queue:
        current_id = queue.popleft()
        if current_id in descendants:
            continue
        descendants.add(current_id)
        queue.extend(children_by_parent.get(current_id, []))
    return descendants


def branch_choices(person_id: str, people_by_id: dict[str, dict[str, str]], children_by_parent: dict[str, list[str]]) -> list[dict[str, str]]:
    choices: list[dict[str, str]] = []
    for child_id in children_by_parent.get(person_id, []):
        branch_member_ids = {child_id} | collect_descendants(child_id, children_by_parent)
        youngest_id = max(branch_member_ids, key=lambda pid: birth_sort_key(people_by_id.get(pid)))
        root = people_by_id.get(child_id)
        youngest = people_by_id.get(youngest_id)
        if not root or not youngest:
            continue
        choices.append(
            {
                "root_id": child_id,
                "target_id": youngest_id,
                "label": f"{root.get('name', 'Unnamed branch')} -> youngest: {person_label(youngest)}",
            }
        )
    return sorted(choices, key=lambda item: item["label"].lower())


def build_family_graph_elements(
    person_id: str,
    people_by_id: dict[str, dict[str, str]],
    children_by_parent: dict[str, list[str]],
    marriages: dict[tuple[str, str], dict[str, Any]],
    ancestor_depth: int,
    descendant_depth: int,
    branch_target_id: str = "",
    branch_only: bool = False,
) -> tuple[list[dict[str, Any]], bool]:
    node_defs: dict[str, dict[str, Any]] = {}
    family_defs: set[str] = set()
    edge_defs: set[tuple[str, str]] = set()
    order_edges: set[tuple[str, str]] = set()
    layout_order = 0

    def next_layout_order() -> int:
        nonlocal layout_order
        layout_order += 1
        return layout_order

    def add_person(pid: str) -> None:
        person = people_by_id.get(pid)
        if not person:
            return
        key = f"person:{pid}"
        if key in node_defs:
            return
        node_defs[f"person:{pid}"] = {
            "data": {
                "id": f"person:{pid}",
                "kind": "person",
                "person_id": pid,
                "label": display_name(person, people_by_id),
                "dates": graph_dates_line(person),
                "meta": "",
                "selected": "true" if pid == person_id else "false",
                "layout_order": next_layout_order(),
            }
        }

    def add_family_node(family_id: str, label: str = "", event_id: str = "") -> None:
        key = f"family:{family_id}"
        if key in family_defs:
            return
        family_defs.add(key)
        node_defs[key] = {"data": {"id": key, "kind": "family", "label": label, "event_id": event_id, "layout_order": next_layout_order()}}

    def add_edge(left_id: str, right_id: str) -> None:
        edge_defs.add((left_id, right_id))

    def add_partner_order(left_pid: str, right_pid: str) -> None:
        if not left_pid or not right_pid:
            return
        left_pid, right_pid = ordered_partner_ids(left_pid, right_pid, people_by_id)
        order_edges.add((f"person:{left_pid}", f"person:{right_pid}"))

    def walk_ancestors(target_id: str, depth: int, include_siblings: bool) -> None:
        person = people_by_id.get(target_id)
        if not person:
            return
        add_person(target_id)
        if depth <= 0:
            return
        father_id = person.get("father", "")
        mother_id = person.get("mother", "")
        if not father_id and not mother_id:
            return
        family_id = f"anc_{target_id}"
        add_family_node(family_id)
        family_key = f"family:{family_id}"
        if father_id:
            add_person(father_id)
            add_edge(f"person:{father_id}", family_key)
        if mother_id:
            add_person(mother_id)
            add_edge(f"person:{mother_id}", family_key)
        if father_id and mother_id:
            add_partner_order(father_id, mother_id)
        child_ids = [target_id]
        if include_siblings and father_id and mother_id:
            child_ids = children_of_pair(people_by_id, father_id, mother_id) or [target_id]
        for child_id in child_ids:
            add_person(child_id)
            add_edge(family_key, f"person:{child_id}")
        if father_id:
            walk_ancestors(father_id, depth - 1, False)
        if mother_id:
            walk_ancestors(mother_id, depth - 1, False)

    def walk_descendants(target_id: str, depth: int) -> None:
        if depth <= 0 or target_id not in people_by_id:
            return
        add_person(target_id)
        for spouse_id, child_ids, marriage in partner_groups(target_id, people_by_id, children_by_parent, marriages):
            family_id = f"desc_{target_id}_{spouse_id or 'unknown'}"
            add_family_node(family_id, (marriage or {}).get("date", ""), (marriage or {}).get("id", ""))
            family_key = f"family:{family_id}"
            add_edge(f"person:{target_id}", family_key)
            if spouse_id:
                add_person(spouse_id)
                add_edge(f"person:{spouse_id}", family_key)
                add_partner_order(target_id, spouse_id)
            for child_id in child_ids:
                add_person(child_id)
                add_edge(family_key, f"person:{child_id}")
                walk_descendants(child_id, depth - 1)

    walk_ancestors(person_id, ancestor_depth, True)
    walk_descendants(person_id, descendant_depth)

    path_nodes: set[str] = set()
    path_edges: set[tuple[str, str]] = set()
    branch_found = False
    target_key = f"person:{branch_target_id}" if branch_target_id else ""
    if target_key and target_key in node_defs:
        path = shortest_path(f"person:{person_id}", target_key, list(edge_defs))
        if path:
            branch_found = True
            path_nodes = set(path)
            path_edges = {(path[idx], path[idx + 1]) for idx in range(len(path) - 1)}
            path_edges |= {(right, left) for left, right in path_edges}

    for raw_id, node in node_defs.items():
        node["data"]["path"] = "true" if raw_id in path_nodes else "false"

    visible_node_defs = node_defs
    visible_edges = edge_defs
    visible_order_edges = order_edges
    if branch_only and path_nodes:
        visible_node_defs = {raw_id: node for raw_id, node in node_defs.items() if raw_id in path_nodes}
        visible_edges = {(left_id, right_id) for left_id, right_id in edge_defs if left_id in path_nodes and right_id in path_nodes}
        visible_order_edges = {(left_id, right_id) for left_id, right_id in order_edges if left_id in path_nodes and right_id in path_nodes}

    elements = list(visible_node_defs.values())
    for left_id, right_id in sorted(visible_edges):
        elements.append(
            {
                "data": {
                    "id": f"edge:{left_id}->{right_id}",
                    "source": left_id,
                    "target": right_id,
                    "path": "true" if (left_id, right_id) in path_edges else "false",
                }
            }
        )
    for left_id, right_id in sorted(visible_order_edges):
        elements.append(
            {
                "data": {
                    "id": f"order:{left_id}->{right_id}",
                    "source": left_id,
                    "target": right_id,
                    "path": "false",
                    "kind": "order",
                }
            }
        )
    return elements, branch_found


def build_all_graph_elements(
    focus_id: str,
    people_by_id: dict[str, dict[str, str]],
    children_by_parent: dict[str, list[str]],
    marriages: dict[tuple[str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    node_defs: dict[str, dict[str, Any]] = {}
    edge_defs: set[tuple[str, str]] = set()
    family_nodes: set[str] = set()
    order_edges: set[tuple[str, str]] = set()
    layout_order = 0

    def next_layout_order() -> int:
        nonlocal layout_order
        layout_order += 1
        return layout_order

    def add_person(pid: str) -> None:
        person = people_by_id.get(pid)
        if not person:
            return
        key = f"person:{pid}"
        if key in node_defs:
            return
        node_defs[f"person:{pid}"] = {
            "data": {
                "id": f"person:{pid}",
                "kind": "person",
                "person_id": pid,
                "label": display_name(person, people_by_id),
                "dates": graph_dates_line(person),
                "meta": "",
                "selected": "true" if pid == focus_id else "false",
                "path": "false",
                "layout_order": next_layout_order(),
            }
        }

    def add_family(family_id: str, label: str = "", event_id: str = "") -> str:
        key = f"family:{family_id}"
        if key not in family_nodes:
            family_nodes.add(key)
            node_defs[key] = {"data": {"id": key, "kind": "family", "label": label, "event_id": event_id, "path": "false", "layout_order": next_layout_order()}}
        return key

    def add_partner_order(left_pid: str, right_pid: str) -> None:
        if not left_pid or not right_pid:
            return
        left_pid, right_pid = ordered_partner_ids(left_pid, right_pid, people_by_id)
        order_edges.add((f"person:{left_pid}", f"person:{right_pid}"))

    pair_children: dict[tuple[str, str], list[str]] = defaultdict(list)
    for child_id, person in people_by_id.items():
        father_id = person.get("father", "")
        mother_id = person.get("mother", "")
        if father_id and mother_id:
            pair_children[(father_id, mother_id)].append(child_id)

    processed_pairs: set[tuple[str, str]] = set()
    for (left_id, right_id), marriage in marriages.items():
        pair = tuple(sorted((left_id, right_id)))
        if pair in processed_pairs:
            continue
        processed_pairs.add(pair)
        add_person(pair[0])
        add_person(pair[1])
        family_key = add_family(f"all_{pair[0]}_{pair[1]}", marriage.get("date", ""), marriage.get("id", ""))
        edge_defs.add((f"person:{pair[0]}", family_key))
        edge_defs.add((f"person:{pair[1]}", family_key))
        add_partner_order(pair[0], pair[1])
        for child_id in pair_children.get((pair[0], pair[1]), []) + pair_children.get((pair[1], pair[0]), []):
            add_person(child_id)
            edge_defs.add((family_key, f"person:{child_id}"))

    for (father_id, mother_id), child_ids in pair_children.items():
        pair = tuple(sorted((father_id, mother_id)))
        if pair in processed_pairs:
            continue
        processed_pairs.add(pair)
        add_person(father_id)
        add_person(mother_id)
        family_key = add_family(f"all_{pair[0]}_{pair[1]}")
        edge_defs.add((f"person:{father_id}", family_key))
        edge_defs.add((f"person:{mother_id}", family_key))
        add_partner_order(father_id, mother_id)
        for child_id in child_ids:
            add_person(child_id)
            edge_defs.add((family_key, f"person:{child_id}"))

    if focus_id and f"person:{focus_id}" not in node_defs:
        add_person(focus_id)

    elements = list(node_defs.values())
    for left_id, right_id in sorted(edge_defs):
        elements.append({"data": {"id": f"edge:{left_id}->{right_id}", "source": left_id, "target": right_id, "path": "false"}})
    for left_id, right_id in sorted(order_edges):
        elements.append({"data": {"id": f"order:{left_id}->{right_id}", "source": left_id, "target": right_id, "path": "false", "kind": "order"}})
    return elements


def person_sources(person_id: str, events: list[dict[str, Any]], sources_by_id: dict[str, dict[str, str]]) -> list[dict[str, Any]]:
    direct_source_ids = []
    person_events = []
    for event in events:
        involved = person_id in {event.get("person_id", ""), event.get("groom_id", ""), event.get("bride_id", "")}
        if not involved:
            continue
        person_events.append(event)
        for source_id in event.get("source_ids", []) or []:
            if source_id and source_id not in direct_source_ids:
                direct_source_ids.append(source_id)

    rows = []
    for source_id in direct_source_ids:
        source = sources_by_id.get(source_id, {})
        linked_events = [
            {
                "id": event.get("id", ""),
                "type": event.get("event_type", ""),
                "date": event.get("date", ""),
                "place": event.get("place", ""),
            }
            for event in person_events
            if source_id in (event.get("source_ids", []) or [])
        ]
        rows.append(
            {
                "id": source_id,
                "title": source.get("title", ""),
                "type": source.get("type", ""),
                "date": source.get("date", ""),
                "archive_url": source.get("archive_url", ""),
                "local_image": source.get("local_image", ""),
                "priority": source.get("priority", ""),
                "linked_events": linked_events,
            }
        )
    return rows


def person_relations(
    person_id: str,
    people_by_id: dict[str, dict[str, str]],
    children_by_parent: dict[str, list[str]],
    marriages: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    person = people_by_id.get(person_id, {})
    father_id = person.get("father", "")
    mother_id = person.get("mother", "")
    children = [people_by_id[child_id] for child_id in children_by_parent.get(person_id, []) if child_id in people_by_id]
    partners = []
    seen_partner_ids = set()
    for spouse_id, child_ids, marriage in partner_groups(person_id, people_by_id, children_by_parent, marriages):
        if not spouse_id or spouse_id in seen_partner_ids or spouse_id not in people_by_id:
            continue
        seen_partner_ids.add(spouse_id)
        spouse = people_by_id[spouse_id]
        partners.append(
            {
                "id": spouse_id,
                "label": person_label(spouse),
                "children_count": len(child_ids),
                "marriage_date": (marriage or {}).get("date", ""),
                "marriage_event_id": (marriage or {}).get("id", ""),
            }
        )
    return {
        "father": {"id": father_id, "label": person_label(people_by_id[father_id])} if father_id in people_by_id else None,
        "mother": {"id": mother_id, "label": person_label(people_by_id[mother_id])} if mother_id in people_by_id else None,
        "children": [{"id": child["id"], "label": person_label(child)} for child in children],
        "partners": partners,
    }


def person_events(
    person_id: str,
    events: list[dict[str, Any]],
    people_by_id: dict[str, dict[str, str]],
    sources_by_id: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    rows = []
    for event in events:
        involved = person_id in {event.get("person_id", ""), event.get("groom_id", ""), event.get("bride_id", "")}
        if not involved:
            continue
        related_people = []
        for key in ("person_id", "groom_id", "bride_id"):
            related_id = event.get(key, "")
            if not related_id or related_id == person_id or related_id not in people_by_id:
                continue
            related_people.append({"id": related_id, "label": person_label(people_by_id[related_id])})
        linked_sources = []
        for source_id in event.get("source_ids", []) or []:
            source = sources_by_id.get(source_id, {})
            linked_sources.append(
                {
                    "id": source_id,
                    "title": source.get("title", source_id),
                    "type": source.get("type", ""),
                    "date": source.get("date", ""),
                    "archive_url": source.get("archive_url", ""),
                    "local_image": source.get("local_image", ""),
                    "priority": source.get("priority", ""),
                }
            )
        rows.append(
            {
                "id": event.get("id", ""),
                "type": event.get("event_type", ""),
                "date": event.get("date", ""),
                "place": event.get("place", ""),
                "confidence": event.get("confidence", ""),
                "provenance": event.get("provenance", ""),
                "notes": event.get("notes", ""),
                "related_people": related_people,
                "sources": linked_sources,
            }
        )
    rows.sort(key=lambda row: (row.get("date", "") or "9999", row.get("type", "")))
    return rows


def linked_event_summaries(
    events: list[dict[str, Any]],
    people_by_id: dict[str, dict[str, str]],
    sources_by_id: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    rows = []
    for event in events:
        source_ids = [source_id for source_id in (event.get("source_ids", []) or []) if source_id]
        if not source_ids:
            continue
        linked_people = []
        for key in ("person_id", "groom_id", "bride_id"):
            related_id = event.get(key, "")
            if not related_id:
                continue
            label = person_label(people_by_id[related_id]) if related_id in people_by_id else related_id
            if label not in linked_people:
                linked_people.append(label)
        source_titles = []
        for source_id in source_ids:
            source = sources_by_id.get(source_id, {})
            source_titles.append(source.get("title", source_id) or source_id)
        rows.append(
            {
                "id": event.get("id", ""),
                "label": " | ".join(bit for bit in [event.get("event_type", ""), event.get("date", ""), event.get("place", "")] if bit)
                or event.get("id", ""),
                "event_type": event.get("event_type", ""),
                "date": event.get("date", ""),
                "place": event.get("place", ""),
                "confidence": event.get("confidence", ""),
                "provenance": event.get("provenance", ""),
                "linked_people": linked_people,
                "source_ids": source_ids,
                "source_titles": source_titles,
                "source_count": len(source_ids),
            }
        )
    rows.sort(key=lambda row: (row.get("date", "") or "9999", row.get("event_type", ""), row.get("id", "")))
    return rows


def event_detail_payload(
    event_id: str,
    events: list[dict[str, Any]],
    all_people: list[dict[str, str]],
    all_sources: list[dict[str, str]],
    people_by_id: dict[str, dict[str, str]],
    sources_by_id: dict[str, dict[str, str]],
) -> dict[str, Any]:
    event = next((item for item in events if item.get("id") == event_id), None)
    if not event:
        return {}
    people = []
    for key, role in (("person_id", "Person"), ("groom_id", "Groom"), ("bride_id", "Bride")):
        related_id = event.get(key, "")
        if not related_id:
            continue
        people.append(
            {
                "role": role,
                "id": related_id,
                "label": person_label(people_by_id[related_id]) if related_id in people_by_id else related_id,
            }
        )
    sources = []
    for source_id in event.get("source_ids", []) or []:
        source = sources_by_id.get(source_id, {})
        sources.append(
            {
                "id": source_id,
                "title": source.get("title", source_id),
                "type": source.get("type", ""),
                "date": source.get("date", ""),
                "archive_url": source.get("archive_url", ""),
                "local_image": source.get("local_image", ""),
                "priority": source.get("priority", ""),
            }
        )
    return {
        "event": event,
        "people": people,
        "sources": sources,
        "person_options": [{"id": "", "label": "None"}] + [{"id": person.get("id", ""), "label": person_label(person)} for person in all_people],
        "source_options": [{"id": source.get("id", ""), "label": source.get("title", source.get("id", ""))} for source in all_sources],
        "raw_json": event,
    }


def person_event_options(person_id: str, events: list[dict[str, Any]]) -> list[dict[str, str]]:
    options = []
    for event in events:
        involved = person_id in {event.get("person_id", ""), event.get("groom_id", ""), event.get("bride_id", "")}
        if not involved:
            continue
        label = " | ".join(bit for bit in [event.get("event_type", ""), event.get("date", ""), event.get("place", "")] if bit)
        options.append({"id": event.get("id", ""), "label": label or event.get("id", "")})
    options.extend(
        [
            {"id": "__new_birth__", "label": "Create Birth/Baptism event"},
            {"id": "__new_death__", "label": "Create Death event"},
            {"id": "__new_research__", "label": "Create Research task"},
        ]
    )
    return options


def person_detail_payload(
    person_id: str,
    people_by_id: dict[str, dict[str, str]],
    people: list[dict[str, str]],
    events: list[dict[str, Any]],
    sources_by_id: dict[str, dict[str, str]],
    children_by_parent: dict[str, list[str]],
    marriages: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    person = people_by_id.get(person_id, {})
    parent_options = [{"id": "", "label": "Unknown"}] + [{"id": p["id"], "label": person_label(p)} for p in people]
    suggested_matches = review_candidates(person_id, people) if person and person_needs_review(person) else []
    return {
        "person": person,
        "parent_options": parent_options,
        "relations": person_relations(person_id, people_by_id, children_by_parent, marriages),
        "events": person_events(person_id, events, people_by_id, sources_by_id),
        "event_options": person_event_options(person_id, events),
        "sources": person_sources(person_id, events, sources_by_id),
        "review": {
            "needs_review": bool(person) and person_needs_review(person),
            "suggested_matches": suggested_matches,
        },
    }
