#!/usr/bin/env python3
"""Validate and normalize the canonical genealogy JSON file."""

from __future__ import annotations

import argparse
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

    for person in db["people"]:
        if person.get("sex", "") not in VALID_SEX:
            issues.append(f"people:{person.get('id', '?')}: invalid sex {person.get('sex', '')!r}")
        if person.get("confidence", "") not in VALID_CONFIDENCE:
            issues.append(f"people:{person.get('id', '?')}: invalid confidence {person.get('confidence', '')!r}")
        if person.get("review_status", "") not in VALID_REVIEW_STATUS:
            issues.append(f"people:{person.get('id', '?')}: invalid review_status {person.get('review_status', '')!r}")
        for parent_key in ["father", "mother"]:
            parent_id = person.get(parent_key, "")
            if parent_id and parent_id not in person_ids:
                issues.append(f"people:{person.get('id', '?')}: unknown {parent_key} {parent_id}")
        if person.get("father") and person.get("father") == person.get("mother"):
            issues.append(f"people:{person.get('id', '?')}: father and mother point to same person")

    for event in db["events"]:
        event_id = event.get("id", "?")
        if event.get("confidence", "") not in VALID_CONFIDENCE:
            issues.append(f"events:{event_id}: invalid confidence {event.get('confidence', '')!r}")
        for person_key in ["person_id", "groom_id", "bride_id"]:
            related_id = event.get(person_key, "")
            if related_id and related_id not in person_ids:
                issues.append(f"events:{event_id}: unknown {person_key} {related_id}")
        for source_id in event.get("source_ids", []):
            if source_id not in source_ids:
                issues.append(f"events:{event_id}: unknown source_id {source_id}")

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
