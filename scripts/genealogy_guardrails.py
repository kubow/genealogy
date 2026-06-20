#!/usr/bin/env python3
"""Validate and normalize the canonical genealogy JSON file."""

from __future__ import annotations

import argparse
from collections import defaultdict
import datetime as dt
import json
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.genealogy_builder import DATA_PATH

PERSON_FIELDS = {
    "id": "",
    "name": "",
    "sex": "",
    "birth_date": "",
    "birth_place": "",
    "death_date": "",
    "death_place": "",
    "father": "",
    "mother": "",
    "confidence": "",
    "provenance": "",
    "notes": "",
    "birth_surname": "",
    "married_surname": "",
    "display_name": "",
    "review_status": "",
    "aliases": [],
}

EVENT_FIELDS = {
    "id": "",
    "event_type": "",
    "date": "",
    "place": "",
    "confidence": "",
    "provenance": "",
    "person_id": "",
    "groom_id": "",
    "bride_id": "",
    "source_ids": [],
    "notes": "",
}

SOURCE_FIELDS = {
    "id": "",
    "title": "",
    "type": "",
    "parish": "",
    "date": "",
    "archive_url": "",
    "image_url": "",
    "local_image": "",
    "reliability": "",
    "priority": "",
    "notes": "",
}

VALID_CONFIDENCE = {"", "open", "possible", "probable", "confirmed"}
VALID_REVIEW_STATUS = {"", "imported", "reviewed", "trusted"}
VALID_SEX = {"", "M", "F", "U"}
MARRIAGE_EVENT_TYPES = {"marriage"}


def event_identity_key(event: dict[str, Any]) -> tuple[str, str, str, str, str, str]:
    return (
        event.get("event_type", "").strip().lower(),
        event.get("date", ""),
        event.get("place", ""),
        event.get("person_id", ""),
        event.get("groom_id", ""),
        event.get("bride_id", ""),
    )


def load_json(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {
        "people": list(raw.get("people", [])),
        "events": list(raw.get("events", [])),
        "sources": list(raw.get("sources", [])),
    }


def normalize_scalar(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split()) if "\n" not in value else "\n\n".join(part.strip() for part in value.split("\n\n"))
    return str(value).strip()


def normalize_notes(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    parts = [" ".join(line.split()) for line in text.split("\n\n")]
    return "\n\n".join(part.strip() for part in parts if part.strip())


def normalize_aliases(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        values = value
    else:
        values = [value]
    out: list[str] = []
    for item in values:
        text = normalize_scalar(item)
        if text and text not in out:
            out.append(text)
    return out


def normalize_record(record: dict[str, Any], template: dict[str, Any], *, notes_key: str = "notes") -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, default in template.items():
        if key == notes_key:
            normalized[key] = normalize_notes(record.get(key, default))
        elif isinstance(default, list):
            if key == "aliases":
                normalized[key] = normalize_aliases(record.get(key, default))
            else:
                values = record.get(key, default)
                if not isinstance(values, list):
                    values = [values] if values else []
                normalized[key] = [normalize_scalar(item) for item in values if normalize_scalar(item)]
        else:
            normalized[key] = normalize_scalar(record.get(key, default))
    for key, value in record.items():
        if key in normalized:
            continue
        normalized[key] = value
    return normalized


def normalize_db(db: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    changes: list[str] = []
    out = {
        "people": [normalize_record(person, PERSON_FIELDS) for person in db["people"]],
        "events": [normalize_record(event, EVENT_FIELDS) for event in db["events"]],
        "sources": [normalize_record(source, SOURCE_FIELDS) for source in db["sources"]],
    }

    for person in out["people"]:
        if person["review_status"] == "":
            if person["provenance"] == "myheritage":
                person["review_status"] = "imported"
                changes.append(f"{person['id']}: set review_status=imported")
            elif person["confidence"] in {"confirmed", "probable"}:
                person["review_status"] = "reviewed"
                changes.append(f"{person['id']}: set review_status=reviewed")

    return out, changes


def validate_db(db: dict[str, Any]) -> list[str]:
    issues: list[str] = []

    def check_ids(items: list[dict[str, Any]], label: str) -> set[str]:
        seen: set[str] = set()
        duplicates: set[str] = set()
        for item in items:
            item_id = item.get("id", "")
            if not item_id:
                issues.append(f"{label}: missing id")
                continue
            if item_id in seen:
                duplicates.add(item_id)
            seen.add(item_id)
        for item_id in sorted(duplicates):
            issues.append(f"{label}: duplicate id {item_id}")
        return seen

    person_ids = check_ids(db["people"], "people")
    source_ids = check_ids(db["sources"], "sources")
    check_ids(db["events"], "events")
    people_by_id = {person.get("id", ""): person for person in db["people"] if person.get("id")}
    children_by_parent: dict[str, list[str]] = defaultdict(list)
    marriages_by_pair: dict[tuple[str, str], list[str]] = defaultdict(list)
    events_by_identity: dict[tuple[str, str, str, str, str, str], list[str]] = defaultdict(list)
    undirected_links: dict[str, set[str]] = defaultdict(set)
    event_links_by_person: dict[str, set[str]] = defaultdict(set)

    for person in db["people"]:
        person_id = person.get("id", "?")
        if person.get("sex", "") not in VALID_SEX:
            issues.append(f"people:{person_id}: invalid sex {person.get('sex', '')!r}")
        if person.get("confidence", "") not in VALID_CONFIDENCE:
            issues.append(f"people:{person_id}: invalid confidence {person.get('confidence', '')!r}")
        if person.get("review_status", "") not in VALID_REVIEW_STATUS:
            issues.append(f"people:{person_id}: invalid review_status {person.get('review_status', '')!r}")
        for parent_key in ["father", "mother"]:
            parent_id = person.get(parent_key, "")
            if parent_id and parent_id not in person_ids:
                issues.append(f"people:{person_id}: unknown {parent_key} {parent_id}")
            if parent_id and parent_id == person_id:
                issues.append(f"people:{person_id}: {parent_key} points to self")
            if parent_id:
                children_by_parent[parent_id].append(person_id)
                if parent_id in person_ids:
                    undirected_links[person_id].add(parent_id)
                    undirected_links[parent_id].add(person_id)
        if person.get("father") and person.get("father") == person.get("mother"):
            issues.append(f"people:{person_id}: father and mother point to same person")

    for parent_id, child_ids in children_by_parent.items():
        parent = people_by_id.get(parent_id, {})
        sex = parent.get("sex", "")
        father_count = sum(1 for child_id in child_ids if people_by_id.get(child_id, {}).get("father") == parent_id)
        mother_count = sum(1 for child_id in child_ids if people_by_id.get(child_id, {}).get("mother") == parent_id)
        if father_count and sex == "F":
            issues.append(f"people:{parent_id}: recorded as father for {father_count} child(ren) despite sex='F'")
        if mother_count and sex == "M":
            issues.append(f"people:{parent_id}: recorded as mother for {mother_count} child(ren) despite sex='M'")
        if father_count and mother_count:
            issues.append(f"people:{parent_id}: used as both father and mother across linked children")

    for event in db["events"]:
        event_id = event.get("id", "?")
        events_by_identity[event_identity_key(event)].append(event_id)
        if event.get("confidence", "") not in VALID_CONFIDENCE:
            issues.append(f"events:{event_id}: invalid confidence {event.get('confidence', '')!r}")
        for person_key in ["person_id", "groom_id", "bride_id"]:
            related_id = event.get(person_key, "")
            if related_id and related_id not in person_ids:
                issues.append(f"events:{event_id}: unknown {person_key} {related_id}")
        for source_id in event.get("source_ids", []):
            if source_id not in source_ids:
                issues.append(f"events:{event_id}: unknown source_id {source_id}")
        for person_key in ("person_id", "groom_id", "bride_id"):
            related_id = event.get(person_key, "")
            if related_id in person_ids:
                event_links_by_person[related_id].add(event_id)
        if event.get("event_type", "").strip().lower() in MARRIAGE_EVENT_TYPES:
            groom_id = event.get("groom_id", "")
            bride_id = event.get("bride_id", "")
            if groom_id and bride_id:
                if groom_id == bride_id:
                    issues.append(f"events:{event_id}: marriage event points both spouses at {groom_id}")
                else:
                    pair = tuple(sorted((groom_id, bride_id)))
                    marriages_by_pair[pair].append(event_id)
                    undirected_links[groom_id].add(bride_id)
                    undirected_links[bride_id].add(groom_id)

    for pair, event_ids in sorted(marriages_by_pair.items()):
        if len(event_ids) > 1:
            issues.append(f"events:{'/'.join(event_ids)}: duplicate marriage pair {pair[0]} + {pair[1]}")

    for identity_key, event_ids in sorted(events_by_identity.items()):
        if not identity_key[0] or len(event_ids) <= 1:
            continue
        issues.append(
            f"events:{'/'.join(event_ids)}: duplicate event identity "
            f"type={identity_key[0]!r} date={identity_key[1]!r} place={identity_key[2]!r}"
        )

    isolated_people = sorted(
        person_id
        for person_id in person_ids
        if not undirected_links.get(person_id) and not event_links_by_person.get(person_id)
    )
    for person_id in isolated_people:
        issues.append(f"people:{person_id}: disconnected from all parents, children, and spouse links")

    visited: set[str] = set()
    visiting: set[str] = set()
    stack: list[str] = []
    cycles: set[tuple[str, ...]] = set()

    def visit(person_id: str) -> None:
        if person_id in visited:
            return
        if person_id in visiting:
            cycle_start = stack.index(person_id)
            cycle = tuple(stack[cycle_start:] + [person_id])
            cycles.add(cycle)
            return

        visiting.add(person_id)
        stack.append(person_id)
        person = people_by_id.get(person_id, {})
        for parent_key in ("father", "mother"):
            parent_id = person.get(parent_key, "")
            if parent_id in people_by_id:
                visit(parent_id)
        stack.pop()
        visiting.remove(person_id)
        visited.add(person_id)

    for person_id in sorted(person_ids):
        visit(person_id)

    for cycle in sorted(cycles):
        issues.append(f"people:{' -> '.join(cycle)}: ancestry cycle detected")

    return issues


def backup_path_for(path: Path) -> Path:
    stamp = dt.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    return path.parent / "backups" / f"{path.stem}.guardrails_backup_{stamp}{path.suffix}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and normalize genealogy JSON structure")
    parser.add_argument("mode", choices=["check", "fix"], help="check = validate only, fix = normalize and write")
    parser.add_argument("--file", default=str(DATA_PATH), help="Path to genealogy JSON file")
    parser.add_argument("--no-backup", action="store_true", help="Do not create a backup before writing in fix mode")
    args = parser.parse_args()

    path = Path(args.file)
    db = load_json(path)
    normalized, changes = normalize_db(db)
    issues = validate_db(normalized)

    print(f"File: {path}")
    print(f"People: {len(normalized['people'])} | Events: {len(normalized['events'])} | Sources: {len(normalized['sources'])}")

    if changes:
        print(f"Normalization changes: {len(changes)}")
    else:
        print("Normalization changes: 0")

    if issues:
        print("Validation issues:")
        for issue in issues:
            print(f"- {issue}")
    else:
        print("Validation issues: 0")

    if args.mode == "fix":
        if not args.no_backup:
            backup_path = backup_path_for(path)
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            backup_path.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
            print(f"Backup: {backup_path}")
        path.write_text(json.dumps(normalized, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        print("Wrote normalized JSON.")
        return

    if issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
