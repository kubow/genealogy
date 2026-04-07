#!/usr/bin/env python3
"""Programmatic genealogy builder.

Canonical data store: data/genealogy.json
Outputs: CSV, dashboard markdown, HTML overview, GEDCOM, static site.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import json
import re
import shutil
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA_PATH = DATA_DIR / "genealogy.json"
OUTPUTS_DIR = ROOT / "outputs"
EXPORTS_DIR = OUTPUTS_DIR
SITE_DIR = ROOT / "docs"
SOURCES_DIR = ROOT / "sources"

# Legacy markdown paths, used only by migrate-markdown.
PEOPLE_DIR = ROOT / "legacy" / "people"
EVENTS_DIR = ROOT / "legacy" / "events"
LEGACY_SOURCES_DIR = ROOT / "legacy" / "sources"
KEYVAL_RE = re.compile(r"^-\s+([^:]+):\s*(.*)$")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def resolve_data_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    data_relative = DATA_DIR / value
    if data_relative.exists():
        return data_relative
    return ROOT / value


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "item"


NAME_ALIASES = {
    "frantisek": "frantisek",
    "franz": "frantisek",
    "franta": "frantisek",
    "josef": "josef",
    "joseph": "josef",
    "jos": "josef",
    "jan": "jan",
    "johann": "jan",
    "joannes": "jan",
    "anna": "anna",
    "marianna": "mariana",
    "mariana": "mariana",
    "marie": "marie",
    "stanislav": "stanislav",
    "vera": "veronika",
    "veronika": "veronika",
    "walasik": "walasik",
    "valasik": "walasik",
    "wajda": "vajda",
    "waida": "vajda",
}


def empty_db() -> Dict[str, List[Dict[str, str]]]:
    return {"people": [], "events": [], "sources": []}


def load_db() -> Dict[str, List[Dict[str, str]]]:
    if not DATA_PATH.exists():
        db = empty_db()
        save_db(db)
        return db
    raw = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    db = empty_db()
    db["people"] = list(raw.get("people", []))
    db["events"] = list(raw.get("events", []))
    db["sources"] = list(raw.get("sources", []))
    return db


def save_db(db: Dict[str, List[Dict[str, str]]]) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(json.dumps(db, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def next_id(items: List[Dict[str, str]], prefix: str, width: int = 4) -> str:
    max_n = 0
    for item in items:
        value = item.get("id", "")
        if value.startswith(prefix):
            tail = value[len(prefix) :]
            if tail.isdigit():
                max_n = max(max_n, int(tail))
    return f"{prefix}{max_n + 1:0{width}d}"


def parse_bullets(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    text = path.read_text(encoding="utf-8")
    for line in text.splitlines():
        m = KEYVAL_RE.match(line.strip())
        if m:
            out[m.group(1).strip()] = m.group(2).strip()
    return out


def extract_title(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem


def migrate_markdown() -> Tuple[int, int, int]:
    db = empty_db()

    for p in sorted(PEOPLE_DIR.glob("P*.md")):
        kv = parse_bullets(p)
        db["people"].append(
            {
                "id": p.stem.split("-")[0],
                "title": extract_title(p),
                "name": kv.get("Name", ""),
                "birth_date": kv.get("Birth date", kv.get("Birth year", "")),
                "birth_place": kv.get("Birth place", ""),
                "father": kv.get("Father", ""),
                "mother": kv.get("Mother", ""),
                "confidence": kv.get("Confidence", ""),
                "notes": "",
            }
        )

    for p in sorted(EVENTS_DIR.glob("E*.md")):
        kv = parse_bullets(p)
        db["events"].append(
            {
                "id": p.stem,
                "title": extract_title(p),
                "event_type": kv.get("Event type", ""),
                "date": kv.get("Date", ""),
                "place": kv.get("Place", ""),
                "confidence": kv.get("Confidence", ""),
            }
        )

    for p in sorted(LEGACY_SOURCES_DIR.glob("S*.md")):
        kv = parse_bullets(p)
        db["sources"].append(
            {
                "id": p.stem.split("-")[0],
                "title": extract_title(p),
                "type": kv.get("Type", ""),
                "parish": kv.get("Parish", ""),
                "date": kv.get("Date in record", kv.get("Year", "")),
                "archive_url": kv.get("Archive URL", ""),
                "image_url": kv.get("Image URL", ""),
                "local_image": kv.get("Local image", ""),
                "reliability": kv.get("Reliability", ""),
            }
        )

    save_db(db)
    return len(db["people"]), len(db["events"]), len(db["sources"])


def write_csv(path: Path, rows: List[Dict[str, str]]) -> None:
    if not rows:
        write_text(path, "")
        return
    keys: List[str] = []
    for row in rows:
        for key in row.keys():
            if key not in keys:
                keys.append(key)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=keys)
        writer.writeheader()
        writer.writerows(rows)


def build_event_review_rows(
    people: List[Dict[str, str]],
    events: List[Dict[str, str]],
    sources: List[Dict[str, str]],
) -> List[Dict[str, str]]:
    people_by_id = {person.get("id", ""): person for person in people}
    sources_by_id = {source.get("id", ""): source for source in sources}
    rows: List[Dict[str, str]] = []

    for event in events:
        person_id = event.get("person_id", "")
        groom_id = event.get("groom_id", "")
        bride_id = event.get("bride_id", "")
        source_ids = event.get("source_ids", []) or []

        linked_people = []
        for related_id in [person_id, groom_id, bride_id]:
            if not related_id:
                continue
            person = people_by_id.get(related_id, {})
            linked_people.append(person.get("name", related_id) or related_id)

        linked_source_titles = []
        for source_id in source_ids:
            source = sources_by_id.get(source_id, {})
            linked_source_titles.append(source.get("title", source_id) or source_id)

        rows.append(
            {
                "id": event.get("id", ""),
                "event_type": event.get("event_type", ""),
                "date": event.get("date", ""),
                "place": event.get("place", ""),
                "confidence": event.get("confidence", ""),
                "provenance": event.get("provenance", ""),
                "person_id": person_id,
                "person_name": people_by_id.get(person_id, {}).get("name", "") if person_id else "",
                "groom_id": groom_id,
                "groom_name": people_by_id.get(groom_id, {}).get("name", "") if groom_id else "",
                "bride_id": bride_id,
                "bride_name": people_by_id.get(bride_id, {}).get("name", "") if bride_id else "",
                "linked_people": " | ".join(linked_people),
                "source_ids": " | ".join(source_ids),
                "source_titles": " | ".join(linked_source_titles),
                "source_count": str(len(source_ids)),
            }
        )

    rows.sort(key=lambda row: (row.get("date", "") or "9999", row.get("event_type", ""), row.get("id", "")))
    return rows


def build_dashboard(people: List[Dict[str, str]], events: List[Dict[str, str]], sources: List[Dict[str, str]]) -> str:
    today = dt.date.today().isoformat()
    primary_people = [p for p in people if p.get("provenance", "primary") != "myheritage"]
    secondary_people = [p for p in people if p.get("provenance", "") == "myheritage"]
    primary_sources = [s for s in sources if s.get("priority", "primary") == "primary"]
    secondary_sources = [s for s in sources if s.get("priority", "") == "secondary"]
    lines = [
        "# Vajda Genealogy Dashboard",
        "",
        f"Generated: {today}",
        "",
        "## Counts",
        "",
        f"- People: {len(people)}",
        f"- Events: {len(events)}",
        f"- Sources: {len(sources)}",
        f"- Primary people (parish/local): {len(primary_people)}",
        f"- Secondary people (MyHeritage import): {len(secondary_people)}",
        f"- Primary sources: {len(primary_sources)}",
        f"- Secondary sources: {len(secondary_sources)}",
        "",
        "## People",
        "",
        "| ID | Name | Birth | Confidence | Provenance |",
        "|---|---|---|---|---|",
    ]
    for p in people:
        lines.append(
            f"| {p.get('id','')} | {p.get('name','')} | {p.get('birth_date','')} | {p.get('confidence','')} | {p.get('provenance','')} |"
        )

    lines.extend(["", "## Events", "", "| ID | Type | Date | Place | Provenance |", "|---|---|---|---|---|"])
    for e in events:
        lines.append(
            f"| {e.get('id','')} | {e.get('event_type','')} | {e.get('date','')} | {e.get('place','')} | {e.get('provenance','')} |"
        )

    lines.extend(["", "## Sources", "", "| ID | Type | Date | Priority | Archive URL |", "|---|---|---|---|---|"])
    for s in sources:
        lines.append(
            f"| {s.get('id','')} | {s.get('type','')} | {s.get('date','')} | {s.get('priority','')} | {s.get('archive_url','')} |"
        )

    return "\n".join(lines) + "\n"


def _html_table(headers: List[str], rows: List[List[str]]) -> str:
    head = "".join(f"<th>{html.escape(h)}</th>" for h in headers)
    body = []
    for row in rows:
        body.append("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in row) + "</tr>")
    return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def build_html(people: List[Dict[str, str]], events: List[Dict[str, str]], sources: List[Dict[str, str]]) -> str:
    p_rows = [
        [p.get("id", ""), p.get("name", ""), p.get("birth_date", ""), p.get("confidence", ""), p.get("provenance", "")]
        for p in people
    ]
    e_rows = [
        [e.get("id", ""), e.get("event_type", ""), e.get("date", ""), e.get("place", ""), e.get("provenance", "")]
        for e in events
    ]
    s_rows = [
        [s.get("id", ""), s.get("type", ""), s.get("date", ""), s.get("priority", ""), s.get("archive_url", "")]
        for s in sources
    ]

    return f"""<!doctype html>
<html lang=\"en\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
<title>Genealogy Overview</title>
<style>
body{{font-family:Georgia,serif;background:#f7f4ee;color:#1f2a30;padding:1.2rem}}
.card{{background:#fffaf1;border:1px solid #d8c9ad;border-radius:8px;padding:1rem;margin:0 0 1rem 0;overflow:auto}}
table{{border-collapse:collapse;width:100%}}th,td{{border-bottom:1px solid #d8c9ad;padding:.4rem;text-align:left}}
</style></head><body>
<h1>Genealogy Overview</h1><p>Generated {html.escape(dt.date.today().isoformat())}</p>
<div class=\"card\"><h2>People ({len(people)})</h2>{_html_table(["ID","Name","Birth","Confidence","Provenance"], p_rows)}</div>
<div class=\"card\"><h2>Events ({len(events)})</h2>{_html_table(["ID","Type","Date","Place","Provenance"], e_rows)}</div>
<div class=\"card\"><h2>Sources ({len(sources)})</h2>{_html_table(["ID","Type","Date","Priority","Archive URL"], s_rows)}</div>
</body></html>
"""


def _gedcom_date(date_str: str) -> str:
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        y, m, d = date_str.split("-")
        months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        return f"{int(d)} {months[int(m)-1]} {y}"
    if re.match(r"^\d{4}$", date_str):
        return date_str
    return ""


def _split_name(name: str) -> Tuple[str, str]:
    name = name.strip()
    if not name:
        return "", ""
    parts = name.split()
    if len(parts) == 1:
        return parts[0], ""
    return " ".join(parts[:-1]), parts[-1]


def _parse_gedcom_line(line: str) -> Tuple[int, str, str, str]:
    parts = line.rstrip("\n\r").split(" ", 2)
    if not parts or not parts[0].isdigit():
        return -1, "", "", ""
    level = int(parts[0])
    if len(parts) == 1:
        return level, "", "", ""
    if len(parts) == 2:
        return level, "", parts[1], ""

    second = parts[1]
    third = parts[2]
    if second.startswith("@") and second.endswith("@"):
        tag_parts = third.split(" ", 1)
        tag = tag_parts[0]
        value = tag_parts[1] if len(tag_parts) > 1 else ""
        return level, second, tag, value
    return level, "", second, third


def _normalize_gedcom_date(value: str) -> str:
    value = value.strip().upper()
    if re.match(r"^\d{4}$", value):
        return value
    m = re.match(r"^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$", value)
    if not m:
        return ""
    day = int(m.group(1))
    mon = m.group(2)
    year = m.group(3)
    months = {
        "JAN": "01",
        "FEB": "02",
        "MAR": "03",
        "APR": "04",
        "MAY": "05",
        "JUN": "06",
        "JUL": "07",
        "AUG": "08",
        "SEP": "09",
        "OCT": "10",
        "NOV": "11",
        "DEC": "12",
    }
    if mon not in months:
        return ""
    return f"{year}-{months[mon]}-{day:02d}"


def _clean_gedcom_name(value: str) -> str:
    value = value.strip()
    value = value.replace("/", "").strip()
    value = re.sub(r"\s+", " ", value)
    return value


def _gedcom_name_parts(value: str) -> Tuple[str, str]:
    value = value.strip()
    match = re.match(r"^(.*?)\s*/([^/]+)/(.*)$", value)
    if match:
        given = re.sub(r"\s+", " ", f"{match.group(1)} {match.group(3)}").strip()
        surname = re.sub(r"\s+", " ", match.group(2)).strip()
        return given, surname
    return _split_name(_clean_gedcom_name(value))


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def _normalize_token(value: str) -> str:
    value = _strip_accents(value).lower().strip()
    value = re.sub(r"[^a-z0-9]+", "", value)
    return NAME_ALIASES.get(value, value)


def _name_tokens(value: str) -> List[str]:
    parts = re.split(r"\s+", _clean_gedcom_name(value))
    return [token for token in (_normalize_token(part) for part in parts) if token]


def _match_name_parts(person: Dict[str, str]) -> Tuple[List[str], str]:
    given_tokens = _name_tokens(person.get("name", ""))
    birth_surname = _normalize_token(person.get("birth_surname", ""))
    married_surname = _normalize_token(person.get("married_surname", ""))
    surname = birth_surname or married_surname or _surname_token(person.get("name", ""))
    if not given_tokens and person.get("name", ""):
        given, _ = _split_name(_clean_gedcom_name(person.get("name", "")))
        given_tokens = _name_tokens(given)
    return given_tokens, surname


def _surname_token(value: str) -> str:
    tokens = _name_tokens(value)
    return tokens[-1] if tokens else ""


def _given_tokens(value: str) -> List[str]:
    tokens = _name_tokens(value)
    return tokens[:-1] if len(tokens) > 1 else tokens[:1]


def _year_from_date(value: str) -> str:
    match = re.match(r"^(\d{4})", value.strip())
    return match.group(1) if match else ""


def _normalize_place(value: str) -> str:
    value = _strip_accents(value).lower().strip()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _score_person_match(imported: Dict[str, str], existing: Dict[str, str]) -> Tuple[int, List[str]]:
    score = 0
    reasons: List[str] = []

    imported_given_tokens, imported_surname = _match_name_parts(imported)
    existing_given_tokens, existing_surname = _match_name_parts(existing)
    imported_tokens = imported_given_tokens + ([imported_surname] if imported_surname else [])
    existing_tokens = existing_given_tokens + ([existing_surname] if existing_surname else [])
    imported_given = set(imported_given_tokens)
    existing_given = set(existing_given_tokens)

    if imported_tokens and imported_tokens == existing_tokens:
        score += 45
        reasons.append("same normalized full name")
    elif imported_surname and imported_surname == existing_surname:
        score += 24
        reasons.append("same normalized surname")
        overlap = imported_given & existing_given
        if overlap:
            score += 18
            reasons.append(f"matching given name: {sorted(overlap)[0]}")
    elif imported_given & existing_given:
        score += 8
        reasons.append("matching given name only")

    imported_birth = imported.get("birth_date", "").strip()
    existing_birth = existing.get("birth_date", "").strip()
    if imported_birth and existing_birth:
        if imported_birth == existing_birth:
            score += 35
            reasons.append("same birth date")
        elif _year_from_date(imported_birth) and _year_from_date(imported_birth) == _year_from_date(existing_birth):
            score += 18
            reasons.append("same birth year")

    imported_death = imported.get("death_date", "").strip()
    existing_death = existing.get("death_date", "").strip()
    if imported_death and existing_death:
        if imported_death == existing_death:
            score += 18
            reasons.append("same death date")
        elif _year_from_date(imported_death) and _year_from_date(imported_death) == _year_from_date(existing_death):
            score += 10
            reasons.append("same death year")

    imported_place = _normalize_place(imported.get("birth_place", ""))
    existing_place = _normalize_place(existing.get("birth_place", ""))
    if imported_place and existing_place:
        if imported_place == existing_place:
            score += 10
            reasons.append("same birth place")
        elif imported_place in existing_place or existing_place in imported_place:
            score += 5
            reasons.append("similar birth place")

    if imported.get("sex") and imported.get("sex") == existing.get("sex"):
        score += 4
        reasons.append("same sex")

    return score, reasons


def find_person_candidates(imported: Dict[str, str], existing_people: List[Dict[str, str]], limit: int = 5) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    for existing in existing_people:
        score, reasons = _score_person_match(imported, existing)
        if score <= 0:
            continue
        candidates.append(
            {
                "id": existing.get("id", ""),
                "name": existing.get("name", ""),
                "birth_date": existing.get("birth_date", ""),
                "death_date": existing.get("death_date", ""),
                "provenance": existing.get("provenance", ""),
                "score": score,
                "reasons": reasons,
            }
        )
    candidates.sort(key=lambda item: (-item["score"], item["birth_date"], item["name"]))
    return candidates[:limit]


def person_display_for_report(person: Dict[str, str]) -> str:
    given = (person.get("name", "") or "").strip()
    birth_surname = (person.get("birth_surname", "") or "").strip()
    married_surname = (person.get("married_surname", "") or "").strip()
    sex = (person.get("sex", "") or "").strip()

    if sex == "M" and birth_surname:
        return f"{given} {birth_surname}".strip()
    if married_surname and birth_surname and married_surname.lower() != birth_surname.lower():
        return f"{given} {married_surname} ({birth_surname})".strip()
    if birth_surname:
        return f"{given} {birth_surname}".strip()
    if married_surname:
        return f"{given} {married_surname}".strip()
    return given or person.get("id", "")


def classify_sync_match(candidates: List[Dict[str, Any]]) -> Tuple[str, Dict[str, Any] | None]:
    if not candidates:
        return "new", None
    best = candidates[0]
    second_score = candidates[1]["score"] if len(candidates) > 1 else -1
    if best["score"] >= 49 and best["score"] - second_score >= 12:
        return "auto_match", best
    if best["score"] >= 45:
        return "review", best
    return "new", None


def build_duplicate_report(min_score: int = 45) -> Dict[str, Any]:
    db = load_db()
    people = list(db["people"])
    pairs: List[Dict[str, Any]] = []

    for index, left in enumerate(people):
        for right in people[index + 1 :]:
            score, reasons = _score_person_match(left, right)
            if score < min_score:
                continue
            pair_key = tuple(sorted((left.get("id", ""), right.get("id", ""))))
            pairs.append(
                {
                    "pair_key": "|".join(pair_key),
                    "score": score,
                    "reasons": reasons,
                    "left_id": left.get("id", ""),
                    "left_name": person_display_for_report(left),
                    "left_birth_date": left.get("birth_date", ""),
                    "left_death_date": left.get("death_date", ""),
                    "left_birth_place": left.get("birth_place", ""),
                    "left_provenance": left.get("provenance", ""),
                    "right_id": right.get("id", ""),
                    "right_name": person_display_for_report(right),
                    "right_birth_date": right.get("birth_date", ""),
                    "right_death_date": right.get("death_date", ""),
                    "right_birth_place": right.get("birth_place", ""),
                    "right_provenance": right.get("provenance", ""),
                }
            )

    pairs.sort(
        key=lambda item: (
            -item["score"],
            item["left_birth_date"] or "9999",
            item["left_name"],
            item["right_name"],
        )
    )
    return {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "people": len(people),
        "candidate_pairs": len(pairs),
        "min_score": min_score,
        "pairs": pairs,
    }


def write_duplicate_report(min_score: int = 45) -> Dict[str, Any]:
    report = build_duplicate_report(min_score=min_score)
    pairs = report["pairs"]

    write_text(EXPORTS_DIR / "duplicate-report.json", json.dumps(report, indent=2, ensure_ascii=True) + "\n")
    write_csv(EXPORTS_DIR / "duplicate-report.csv", pairs)

    lines = [
        "# Duplicate Candidate Report",
        "",
        f"Generated: {report['generated_at']}",
        f"People scanned: {report['people']}",
        f"Candidate pairs: {report['candidate_pairs']}",
        f"Minimum score: {report['min_score']}",
        "",
        "| Score | Left | Right | Reasons |",
        "|---|---|---|---|",
    ]
    for pair in pairs:
        left = " | ".join(
            bit
            for bit in [
                pair["left_id"],
                pair["left_name"],
                pair["left_birth_date"],
                pair["left_provenance"],
            ]
            if bit
        )
        right = " | ".join(
            bit
            for bit in [
                pair["right_id"],
                pair["right_name"],
                pair["right_birth_date"],
                pair["right_provenance"],
            ]
            if bit
        )
        lines.append(f"| {pair['score']} | {left} | {right} | {'; '.join(pair['reasons'])} |")

    write_text(EXPORTS_DIR / "duplicate-report.md", "\n".join(lines) + "\n")
    return report


def parse_gedcom(path: Path) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    people_by_xref: Dict[str, Dict[str, str]] = {}
    families: List[Dict[str, str]] = []

    current_type = ""
    current_xref = ""
    current_subtag = ""

    for raw_line in text.splitlines():
        level, xref, tag, value = _parse_gedcom_line(raw_line)
        if level < 0:
            continue
        if level == 0:
            current_subtag = ""
            if tag == "INDI":
                current_type = "INDI"
                current_xref = xref
                people_by_xref.setdefault(
                    current_xref,
                    {
                        "xref": current_xref,
                        "name": "",
                        "sex": "",
                        "birth_date": "",
                        "birth_place": "",
                        "death_date": "",
                        "death_place": "",
                        "famc": [],
                        "fams": [],
                    },
                )
            elif tag == "FAM":
                current_type = "FAM"
                current_xref = xref
                families.append(
                    {
                        "xref": current_xref,
                        "husb": "",
                        "wife": "",
                        "chil": [],
                        "marr_date": "",
                        "marr_place": "",
                    }
                )
            else:
                current_type = ""
                current_xref = ""
            continue

        if current_type == "INDI" and current_xref in people_by_xref:
            person = people_by_xref[current_xref]
            if level == 1:
                current_subtag = ""
                if tag == "NAME":
                    person["name"] = _clean_gedcom_name(value)
                    _, surname = _gedcom_name_parts(value)
                    person["birth_surname"] = surname
                elif tag == "SEX":
                    person["sex"] = value.strip().upper()[:1]
                elif tag in {"BIRT", "DEAT"}:
                    current_subtag = tag
                elif tag == "FAMC":
                    famc = value.strip()
                    if famc and famc not in person["famc"]:
                        person["famc"].append(famc)
                elif tag == "FAMS":
                    fams = value.strip()
                    if fams and fams not in person["fams"]:
                        person["fams"].append(fams)
            elif level == 2 and current_subtag:
                if tag == "DATE":
                    norm = _normalize_gedcom_date(value)
                    if current_subtag == "BIRT":
                        person["birth_date"] = norm
                    elif current_subtag == "DEAT":
                        person["death_date"] = norm
                elif tag == "PLAC":
                    if current_subtag == "BIRT":
                        person["birth_place"] = value.strip()
                    elif current_subtag == "DEAT":
                        person["death_place"] = value.strip()

        if current_type == "FAM" and families:
            fam = families[-1]
            if level == 1:
                current_subtag = ""
                if tag == "HUSB":
                    fam["husb"] = value.strip()
                elif tag == "WIFE":
                    fam["wife"] = value.strip()
                elif tag == "CHIL":
                    child = value.strip()
                    if child and child not in fam["chil"]:
                        fam["chil"].append(child)
                elif tag == "MARR":
                    current_subtag = "MARR"
            elif level == 2 and current_subtag == "MARR":
                if tag == "DATE":
                    fam["marr_date"] = _normalize_gedcom_date(value)
                elif tag == "PLAC":
                    fam["marr_place"] = value.strip()

    people = [p for p in people_by_xref.values() if p.get("name")]
    events: List[Dict[str, Any]] = []
    for fam in families:
        if not fam.get("husb") and not fam.get("wife"):
            continue
        events.append(
            {
                "xref": fam.get("xref", ""),
                "id": "",
                "event_type": "Marriage",
                "date": fam.get("marr_date", ""),
                "place": fam.get("marr_place", ""),
                "confidence": "possible",
                "groom_xref": fam.get("husb", ""),
                "bride_xref": fam.get("wife", ""),
            }
        )
    return people, events


def build_sync_report(path: Path) -> Dict[str, Any]:
    imported_people, imported_events = parse_gedcom(path)
    db = load_db()
    existing_people = list(db["people"])

    matches: List[Dict[str, Any]] = []
    auto_match_count = 0
    review_count = 0
    new_count = 0
    for person in imported_people:
        candidates = find_person_candidates(person, existing_people)
        decision, best = classify_sync_match(candidates)
        if decision == "auto_match":
            auto_match_count += 1
        elif decision == "review":
            review_count += 1
        else:
            new_count += 1
        matches.append(
            {
                "xref": person.get("xref", ""),
                "imported": {
                    "name": person.get("name", ""),
                    "birth_date": person.get("birth_date", ""),
                    "death_date": person.get("death_date", ""),
                    "birth_place": person.get("birth_place", ""),
                    "death_place": person.get("death_place", ""),
                    "sex": person.get("sex", ""),
                },
                "decision": decision,
                "best_match": best,
                "candidates": candidates,
            }
        )

    return {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source_file": str(path),
        "imported_people": len(imported_people),
        "imported_family_events": len(imported_events),
        "database_people": len(existing_people),
        "summary": {
            "auto_match": auto_match_count,
            "review": review_count,
            "new": new_count,
        },
        "matches": matches,
    }


def write_sync_report(path: Path) -> Dict[str, Any]:
    report = build_sync_report(path)
    write_text(EXPORTS_DIR / "sync-report.json", json.dumps(report, indent=2, ensure_ascii=True) + "\n")

    lines = [
        "# GEDCOM Sync Report",
        "",
        f"Generated: {report['generated_at']}",
        f"Source file: `{report['source_file']}`",
        "",
        "## Summary",
        "",
        f"- Imported people: {report['imported_people']}",
        f"- Imported family events: {report['imported_family_events']}",
        f"- Auto-match candidates: {report['summary']['auto_match']}",
        f"- Needs review: {report['summary']['review']}",
        f"- New people: {report['summary']['new']}",
        "",
        "## Match Decisions",
        "",
        "| Imported | Birth | Decision | Best candidate | Score |",
        "|---|---|---|---|---|",
    ]
    for item in report["matches"]:
        imported = item["imported"]
        best = item.get("best_match") or {}
        best_label = ""
        if best:
            best_label = f"{best.get('id','')} {best.get('name','')}".strip()
        lines.append(
            f"| {imported.get('name','')} | {imported.get('birth_date','')} | {item.get('decision','')} | {best_label} | {best.get('score','')} |"
        )
    write_text(EXPORTS_DIR / "sync-report.md", "\n".join(lines) + "\n")
    return report


def import_gedcom(path: Path, mode: str) -> Tuple[int, int, int]:
    imported_people, imported_events = parse_gedcom(path)
    db = empty_db() if mode == "replace" else load_db()
    existing_people = list(db["people"])
    sync_report = build_sync_report(path) if mode == "merge" else None

    source_id = next_id(db["sources"], "S")
    db["sources"].append(
        {
            "id": source_id,
            "title": f"Imported GEDCOM from {path.name}",
            "type": "GEDCOM import",
            "parish": "",
            "date": dt.date.today().isoformat(),
            "archive_url": "",
            "image_url": "",
            "local_image": str(path),
            "reliability": "medium",
            "priority": "secondary",
        }
    )

    xref_to_pid: Dict[str, str] = {}
    report_by_xref = {item["xref"]: item for item in (sync_report or {}).get("matches", [])}

    for person in imported_people:
        match_row = report_by_xref.get(person.get("xref", ""), {})
        best_match = match_row.get("best_match") or {}
        if mode == "merge" and match_row.get("decision") == "auto_match" and best_match.get("id"):
            existing = next((row for row in db["people"] if row.get("id") == best_match["id"]), None)
            if existing is None:
                continue
            if not existing.get("sex") and person.get("sex"):
                existing["sex"] = person.get("sex", "")
            if not existing.get("birth_place") and person.get("birth_place"):
                existing["birth_place"] = person.get("birth_place", "")
            if not existing.get("birth_surname") and person.get("birth_surname"):
                existing["birth_surname"] = person.get("birth_surname", "")
            if not existing.get("death_date") and person.get("death_date"):
                existing["death_date"] = person.get("death_date", "")
            if not existing.get("death_place") and person.get("death_place"):
                existing["death_place"] = person.get("death_place", "")
            xref_to_pid[person["xref"]] = existing["id"]
            continue

        pid = next_id(db["people"], "P")
        row = {
            "id": pid,
            "name": person.get("name", ""),
            "birth_date": person.get("birth_date", ""),
            "death_date": person.get("death_date", ""),
            "birth_place": person.get("birth_place", ""),
            "death_place": person.get("death_place", ""),
            "birth_surname": person.get("birth_surname", ""),
            "married_surname": "",
            "father": "",
            "mother": "",
            "sex": person.get("sex", ""),
            "confidence": "possible",
            "provenance": "myheritage",
            "notes": f"Imported from GEDCOM ({path.name}).",
        }
        db["people"].append(row)
        existing_people.append(row)
        xref_to_pid[person["xref"]] = pid

    people_by_pid = {p["id"]: p for p in db["people"]}
    families_by_xref = {f.get("xref", ""): f for f in imported_events}
    for person in imported_people:
        child_pid = xref_to_pid.get(person.get("xref", ""), "")
        if not child_pid:
            continue
        child = people_by_pid.get(child_pid)
        if child is None:
            continue
        for fam_xref in person.get("famc", []):
            fam = families_by_xref.get(fam_xref, {})
            father_pid = xref_to_pid.get(fam.get("groom_xref", ""), "")
            mother_pid = xref_to_pid.get(fam.get("bride_xref", ""), "")
            if father_pid and not child.get("father"):
                child["father"] = father_pid
            if mother_pid and not child.get("mother"):
                child["mother"] = mother_pid

    existing_event_keys = {
        (
            e.get("event_type", "").lower(),
            e.get("date", ""),
            e.get("place", ""),
            e.get("groom_id", ""),
            e.get("bride_id", ""),
        )
        for e in db["events"]
    }

    for event in imported_events:
        groom_id = xref_to_pid.get(event.get("groom_xref", ""), "")
        bride_id = xref_to_pid.get(event.get("bride_xref", ""), "")
        event_key = ("marriage", event.get("date", ""), event.get("place", ""), groom_id, bride_id)
        if event_key in existing_event_keys:
            continue
        eid = f"E{slugify(event.get('date', '') or 'undated')}-marriage-{len(db['events']) + 1:03d}"
        db["events"].append(
            {
                "id": eid,
                "event_type": "Marriage",
                "date": event.get("date", ""),
                "place": event.get("place", ""),
                "confidence": "possible",
                "groom_id": groom_id,
                "bride_id": bride_id,
                "provenance": "myheritage",
                "source_ids": [source_id],
            }
        )
        existing_event_keys.add(event_key)

    save_db(db)
    return len(imported_people), len(imported_events), len(db["people"])


def build_gedcom(people: List[Dict[str, str]], events: List[Dict[str, str]]) -> str:
    lines: List[str] = [
        "0 HEAD",
        "1 SOUR genealogy_builder",
        "1 CHAR UTF-8",
        "1 GEDC",
        "2 VERS 5.5.1",
        "2 FORM LINEAGE-LINKED",
    ]

    person_index: Dict[str, str] = {}
    for idx, person in enumerate(people, start=1):
        pid = person.get("id", f"P{idx:04d}")
        person_index[pid] = f"@I{idx}@"

    fam_records: List[Dict[str, Any]] = []
    fam_by_pair: Dict[Tuple[str, str], Dict[str, Any]] = {}
    spouse_to_fams: Dict[str, List[str]] = {}
    child_to_famc: Dict[str, List[str]] = {}
    fam_seq = 1
    for event in events:
        if event.get("event_type", "").lower() != "marriage":
            continue
        groom = event.get("groom_id", "")
        bride = event.get("bride_id", "")
        if not groom or not bride:
            continue
        if groom not in person_index or bride not in person_index:
            continue

        fam_xref = f"@F{fam_seq}@"
        fam_seq += 1
        fam_record = {
            "xref": fam_xref,
            "husb": person_index[groom],
            "wife": person_index[bride],
            "date": _gedcom_date(event.get("date", "")),
            "place": event.get("place", ""),
            "chil": [],
        }
        fam_records.append(fam_record)
        fam_by_pair[(groom, bride)] = fam_record
        spouse_to_fams.setdefault(groom, []).append(fam_xref)
        spouse_to_fams.setdefault(bride, []).append(fam_xref)

    # Build parent-child families from father/mother links.
    for child in people:
        child_pid = child.get("id", "")
        father = child.get("father", "")
        mother = child.get("mother", "")
        if not child_pid or not father or not mother:
            continue
        if father not in person_index or mother not in person_index or child_pid not in person_index:
            continue

        fam_record = fam_by_pair.get((father, mother))
        if fam_record is None:
            fam_xref = f"@F{fam_seq}@"
            fam_seq += 1
            fam_record = {
                "xref": fam_xref,
                "husb": person_index[father],
                "wife": person_index[mother],
                "date": "",
                "place": "",
                "chil": [],
            }
            fam_records.append(fam_record)
            fam_by_pair[(father, mother)] = fam_record
            spouse_to_fams.setdefault(father, []).append(fam_xref)
            spouse_to_fams.setdefault(mother, []).append(fam_xref)

        child_xref = person_index[child_pid]
        if child_xref not in fam_record["chil"]:
            fam_record["chil"].append(child_xref)
        child_to_famc.setdefault(child_pid, []).append(fam_record["xref"])

    for idx, person in enumerate(people, start=1):
        pid = person.get("id", f"P{idx:04d}")
        xref = person_index[pid]
        given, surname = _split_name(person.get("name", ""))
        lines.append(f"0 {xref} INDI")
        if given or surname:
            lines.append(f"1 NAME {given} /{surname}/")
        if person.get("sex"):
            lines.append(f"1 SEX {person['sex']}")
        bdate = _gedcom_date(person.get("birth_date", ""))
        if bdate:
            lines.append("1 BIRT")
            lines.append(f"2 DATE {bdate}")
            place = person.get("birth_place", "")
            if place:
                lines.append(f"2 PLAC {place}")
        ddate = _gedcom_date(person.get("death_date", ""))
        if ddate:
            lines.append("1 DEAT")
            lines.append(f"2 DATE {ddate}")
            dplace = person.get("death_place", "")
            if dplace:
                lines.append(f"2 PLAC {dplace}")
        for fam_xref in spouse_to_fams.get(pid, []):
            lines.append(f"1 FAMS {fam_xref}")
        for fam_xref in child_to_famc.get(pid, []):
            lines.append(f"1 FAMC {fam_xref}")

    for fam in fam_records:
        lines.append(f"0 {fam['xref']} FAM")
        lines.append(f"1 HUSB {fam['husb']}")
        lines.append(f"1 WIFE {fam['wife']}")
        for child_xref in fam.get("chil", []):
            lines.append(f"1 CHIL {child_xref}")
        lines.append("1 MARR")
        if fam["date"]:
            lines.append(f"2 DATE {fam['date']}")
        if fam["place"]:
            lines.append(f"2 PLAC {fam['place']}")

    lines.append("0 TRLR")
    return "\n".join(lines) + "\n"


def build_static_index_html() -> str:
    return """<!doctype html>
<html lang=\"en\">
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Genealogy Tree</title>
    <link rel=\"stylesheet\" href=\"./styles.css\" />
  </head>
  <body>
    <div class=\"workspace\">
      <aside class=\"sidebar left-sidebar\">
        <h1>Navigate</h1>
        <label class=\"field\">
          <span>Search</span>
          <input id=\"searchInput\" type=\"text\" placeholder=\"Name or ID\" />
        </label>
        <label class=\"toggle\">
          <input id=\"displayAllToggle\" type=\"checkbox\" />
          <span>Display all</span>
        </label>
        <label class=\"field\">
          <span>Focus person</span>
          <select id=\"focusSelect\"></select>
        </label>
        <label class=\"field\">
          <span>Branch to youngest</span>
          <select id=\"branchSelect\"></select>
        </label>
        <label class=\"toggle\">
          <input id=\"branchOnlyToggle\" type=\"checkbox\" />
          <span>Show only selected branch</span>
        </label>
        <p id=\"branchHint\" class=\"hint\"></p>
      </aside>

      <main class=\"canvas-area\">
        <div class=\"canvas-toolbar\">
          <h2 id=\"treeTitle\">Family tree</h2>
        </div>
        <div id=\"cy\"></div>
      </main>

      <aside class=\"sidebar right-sidebar\">
        <section class=\"panel\">
          <h3>Person</h3>
          <dl id=\"personSummary\" class=\"summary-grid\"></dl>
        </section>
        <section class=\"panel\">
          <h3>Sources</h3>
          <div id=\"sourcesList\" class=\"sources-list\"></div>
        </section>
      </aside>
    </div>
    <script src=\"https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js\"></script>
    <script src=\"https://unpkg.com/dagre@0.8.5/dist/dagre.min.js\"></script>
    <script src=\"https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js\"></script>
    <script src=\"./app.js\"></script>
  </body>
</html>
"""


def build_static_styles_css() -> str:
    return """:root {
  --bg: #efe7d9;
  --panel: rgba(255, 251, 243, 0.96);
  --panel-strong: #f7f0e4;
  --line: #d2c1a6;
  --text: #332613;
  --muted: #6d5b42;
}
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; }
body {
  font-family: Georgia, serif;
  color: var(--text);
  background:
    radial-gradient(circle at top left, #fff9ef 0, transparent 30%),
    radial-gradient(circle at bottom right, #f9f0e0 0, transparent 25%),
    linear-gradient(180deg, #f3eadc 0%, var(--bg) 100%);
}
input, select, button { font: inherit; }
.workspace {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 360px;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
.sidebar {
  overflow: auto;
  background: var(--panel);
  backdrop-filter: blur(12px);
  padding: 1rem;
}
.left-sidebar { border-right: 1px solid var(--line); }
.right-sidebar { border-left: 1px solid var(--line); }
.field, .toggle, .panel { display: block; margin-bottom: 1rem; }
.field span, .toggle span {
  display: block;
  margin-bottom: 0.32rem;
  font-size: 0.9rem;
  color: var(--muted);
}
input, select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  background: white;
  color: var(--text);
}
.canvas-area {
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 0;
  min-height: 0;
}
.canvas-toolbar { padding: 0.9rem 1rem 0.6rem; }
.canvas-toolbar h2, h1, h3 { margin: 0; }
#cy {
  width: calc(100% - 1rem);
  height: calc(100% - 1rem);
  margin: 0 0.5rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: linear-gradient(180deg, #fffdf7 0%, #f4ecdf 100%);
}
.panel {
  background: var(--panel-strong);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 0.95rem;
}
.summary-grid {
  display: grid;
  grid-template-columns: minmax(90px, 120px) 1fr;
  gap: 0.4rem 0.7rem;
  margin: 0;
}
.summary-grid dt { color: var(--muted); }
.summary-grid dd { margin: 0; }
.sources-list { display: grid; gap: 0.75rem; }
.source-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.8rem;
  background: white;
}
.source-card h4 { margin: 0 0 0.25rem; }
.source-meta {
  color: var(--muted);
  font-size: 0.88rem;
  margin-bottom: 0.45rem;
}
.source-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.45rem;
}
.link-chip {
  display: inline-block;
  padding: 0.24rem 0.55rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fffdf7;
  color: var(--text);
  text-decoration: none;
  font-size: 0.82rem;
}
.image-thumb {
  display: block;
  width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #fff;
  margin-top: 0.55rem;
}
.hint { color: var(--muted); font-size: 0.88rem; }
@media (max-width: 1100px) {
  .workspace { grid-template-columns: 260px minmax(0, 1fr) 300px; }
}
@media (max-width: 900px) {
  .workspace { grid-template-columns: 1fr; grid-template-rows: auto minmax(45vh, 1fr) auto; }
  .left-sidebar, .right-sidebar { border: 0; border-top: 1px solid var(--line); }
}
"""


def build_static_app_js() -> str:
    return """const state = { data: null, people: [], peopleById: {}, childrenByParent: {}, marriages: {}, focusId: '', branchTargetId: '', branchOnly: false, displayAll: false, cy: null };
const searchInput = document.getElementById('searchInput');
const focusSelect = document.getElementById('focusSelect');
const branchSelect = document.getElementById('branchSelect');
const branchOnlyToggle = document.getElementById('branchOnlyToggle');
const displayAllToggle = document.getElementById('displayAllToggle');
const branchHint = document.getElementById('branchHint');
const treeTitle = document.getElementById('treeTitle');
const personSummary = document.getElementById('personSummary');
const sourcesList = document.getElementById('sourcesList');

function normalizeDate(value) { return (value || '').trim(); }
function surnameOf(person) {
  const parts = (person?.name || '').trim().split(/\\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}
function displayName(person) {
  if (!person) return 'Unnamed person';
  const name = person.name || 'Unnamed person';
  if ((person.sex || '') !== 'F') return name;
  const father = state.peopleById[person.father || ''] || null;
  const fatherSurname = surnameOf(father);
  if (!fatherSurname) return name;
  const parts = name.trim().split(/\\s+/).filter(Boolean);
  if (parts.length < 2) return name;
  const currentSurname = parts[parts.length - 1];
  if (currentSurname.toLowerCase() === fatherSurname.toLowerCase()) return name;
  return `${parts.slice(0, -1).join(' ')} ${currentSurname} (${fatherSurname})`;
}
function graphDatesLine(person) {
  const birth = normalizeDate(person?.birth_date || '');
  const death = normalizeDate(person?.death_date || '');
  if (birth && death) return `${birth}          ${death}`;
  return birth || death || '';
}
function personLabel(person) {
  const birth = normalizeDate(person.birth_date) || '?';
  const death = normalizeDate(person.death_date);
  return death ? `${displayName(person)} (${birth} - ${death})` : `${displayName(person)} (b. ${birth})`;
}
function setOptions(select, options, value, includeNone = false) {
  select.innerHTML = '';
  if (includeNone) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'None';
    select.appendChild(option);
  }
  for (const item of options) {
    const option = document.createElement('option');
    option.value = item.id || item.target_id;
    option.textContent = item.label;
    select.appendChild(option);
  }
  select.value = value || '';
}
function personMatches(person, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return person.label.toLowerCase().includes(q) || person.id.toLowerCase().includes(q) || (person.name || '').toLowerCase().includes(q);
}
function birthSortKey(person) {
  const birth = normalizeDate(person?.birth_date || '');
  return [birth ? 1 : 0, birth, person?.name || ''];
}
function compareBirthKey(a, b) {
  for (let idx = 0; idx < 3; idx += 1) {
    if (a[idx] < b[idx]) return -1;
    if (a[idx] > b[idx]) return 1;
  }
  return 0;
}
function childrenOfPair(fatherId, motherId) {
  return state.people
    .filter((person) => person.father === fatherId && person.mother === motherId)
    .sort((left, right) => {
      const l = birthSortKey(left);
      const r = birthSortKey(right);
      return compareBirthKey(l, r) || (left.name || '').localeCompare(right.name || '');
    })
    .map((person) => person.id);
}
function collectDescendants(rootId) {
  const descendants = new Set();
  const queue = [...(state.childrenByParent[rootId] || [])];
  while (queue.length) {
    const currentId = queue.shift();
    if (descendants.has(currentId)) continue;
    descendants.add(currentId);
    queue.push(...(state.childrenByParent[currentId] || []));
  }
  return descendants;
}
function branchChoices(personId) {
  const choices = [];
  for (const childId of state.childrenByParent[personId] || []) {
    const branchMembers = new Set([childId, ...collectDescendants(childId)]);
    let youngestId = childId;
    for (const memberId of branchMembers) {
      if (compareBirthKey(birthSortKey(state.peopleById[youngestId]), birthSortKey(state.peopleById[memberId])) < 0) {
        youngestId = memberId;
      }
    }
    const root = state.peopleById[childId];
    const youngest = state.peopleById[youngestId];
    if (!root || !youngest) continue;
    choices.push({ root_id: childId, target_id: youngestId, label: `${root.name} -> youngest: ${personLabel(youngest)}` });
  }
  return choices.sort((left, right) => left.label.localeCompare(right.label));
}
function partnerGroups(personId) {
  const groupedChildren = new Map();
  for (const childId of state.childrenByParent[personId] || []) {
    const child = state.peopleById[childId];
    const spouseId = child.father === personId ? (child.mother || '') : (child.father || '');
    if (!groupedChildren.has(spouseId)) groupedChildren.set(spouseId, []);
    groupedChildren.get(spouseId).push(childId);
  }
  const spouseIds = new Set(groupedChildren.keys());
  for (const key of Object.keys(state.marriages)) {
    const [leftId, rightId] = key.split('|');
    if (leftId === personId && rightId) spouseIds.add(rightId);
  }
  return [...spouseIds]
    .map((spouseId) => {
      const childIds = (groupedChildren.get(spouseId) || []).sort((leftId, rightId) => {
        const left = state.peopleById[leftId];
        const right = state.peopleById[rightId];
        return compareBirthKey(birthSortKey(left), birthSortKey(right)) || (left?.name || '').localeCompare(right?.name || '');
      });
      return [spouseId, childIds, state.marriages[`${personId}|${spouseId}`] || null];
    })
    .sort((left, right) => ((state.peopleById[left[0]]?.name || '').localeCompare(state.peopleById[right[0]]?.name || '')));
}
function shortestPath(start, target, edges) {
  if (!start || !target) return [];
  if (start === target) return [start];
  const adjacency = new Map();
  for (const [left, right] of edges) {
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    if (!adjacency.has(right)) adjacency.set(right, new Set());
    adjacency.get(left).add(right);
    adjacency.get(right).add(left);
  }
  const queue = [[start, [start]]];
  const seen = new Set([start]);
  while (queue.length) {
    const [node, path] = queue.shift();
    for (const neighbor of adjacency.get(node) || []) {
      if (seen.has(neighbor)) continue;
      const nextPath = [...path, neighbor];
      if (neighbor === target) return nextPath;
      seen.add(neighbor);
      queue.push([neighbor, nextPath]);
    }
  }
  return [];
}
function buildFamilyGraph(focusId, branchTargetId, branchOnly) {
  const nodeDefs = new Map();
  const edgeDefs = new Set();
  const orderEdges = new Set();
  function addPerson(personId) {
    const person = state.peopleById[personId];
    if (!person) return;
    nodeDefs.set(`person:${personId}`, { data: { id: `person:${personId}`, kind: 'person', person_id: personId, label: displayName(person), dates: graphDatesLine(person), meta: '', selected: personId === focusId ? 'true' : 'false' } });
  }
  function addFamily(familyId, label = '') {
    const key = `family:${familyId}`;
    if (!nodeDefs.has(key)) nodeDefs.set(key, { data: { id: key, kind: 'family', label } });
  }
  function addEdge(left, right) { edgeDefs.add(`${left}->${right}`); }
  function addPartnerOrder(leftId, rightId) {
    if (!leftId || !rightId) return;
    const left = state.peopleById[leftId] || {};
    const right = state.peopleById[rightId] || {};
    let orderedLeft = leftId;
    let orderedRight = rightId;
    if ((left.sex || '') === 'F' && (right.sex || '') === 'M') {
      orderedLeft = rightId;
      orderedRight = leftId;
    } else if ((left.sex || '') === (right.sex || '') && (left.name || '') > (right.name || '')) {
      orderedLeft = rightId;
      orderedRight = leftId;
    }
    orderEdges.add(`person:${orderedLeft}->person:${orderedRight}`);
  }
  function walkAncestors(targetId, depth, includeSiblings) {
    const person = state.peopleById[targetId];
    if (!person) return;
    addPerson(targetId);
    if (depth <= 0) return;
    const fatherId = person.father || '';
    const motherId = person.mother || '';
    if (!fatherId && !motherId) return;
    const familyId = `anc_${targetId}`;
    addFamily(familyId);
    const familyKey = `family:${familyId}`;
    if (fatherId) { addPerson(fatherId); addEdge(`person:${fatherId}`, familyKey); }
    if (motherId) { addPerson(motherId); addEdge(`person:${motherId}`, familyKey); }
    if (fatherId && motherId) addPartnerOrder(fatherId, motherId);
    let childIds = [targetId];
    if (includeSiblings && fatherId && motherId) childIds = childrenOfPair(fatherId, motherId);
    for (const childId of childIds) { addPerson(childId); addEdge(familyKey, `person:${childId}`); }
    if (fatherId) walkAncestors(fatherId, depth - 1, false);
    if (motherId) walkAncestors(motherId, depth - 1, false);
  }
  function walkDescendants(targetId, depth) {
    if (depth <= 0 || !state.peopleById[targetId]) return;
    addPerson(targetId);
    for (const [spouseId, childIds, marriage] of partnerGroups(targetId)) {
      const familyId = `desc_${targetId}_${spouseId || 'unknown'}`;
      addFamily(familyId, marriage?.date || '');
      const familyKey = `family:${familyId}`;
      addEdge(`person:${targetId}`, familyKey);
      if (spouseId) { addPerson(spouseId); addEdge(`person:${spouseId}`, familyKey); addPartnerOrder(targetId, spouseId); }
      for (const childId of childIds) {
        addPerson(childId);
        addEdge(familyKey, `person:${childId}`);
        walkDescendants(childId, depth - 1);
      }
    }
  }
  walkAncestors(focusId, 4, true);
  walkDescendants(focusId, branchTargetId ? 99 : 4);
  const edgePairs = [...edgeDefs].map((value) => value.split('->'));
  let pathNodes = new Set();
  let pathEdges = new Set();
  let branchFound = false;
  const targetKey = branchTargetId ? `person:${branchTargetId}` : '';
  if (targetKey && nodeDefs.has(targetKey)) {
    const path = shortestPath(`person:${focusId}`, targetKey, edgePairs);
    if (path.length) {
      branchFound = true;
      pathNodes = new Set(path);
      for (let idx = 0; idx < path.length - 1; idx += 1) {
        pathEdges.add(`${path[idx]}->${path[idx + 1]}`);
        pathEdges.add(`${path[idx + 1]}->${path[idx]}`);
      }
    }
  }
  const nodes = [...nodeDefs.values()].map((node) => ({ ...node, data: { ...node.data, path: pathNodes.has(node.data.id) ? 'true' : 'false', display_label: [node.data.label, node.data.dates, node.data.meta].filter(Boolean).join('\\n') } }));
  let filteredNodes = nodes;
  let filteredEdges = edgePairs;
  let filteredOrderEdges = [...orderEdges].map((value) => value.split('->'));
  if (branchOnly && pathNodes.size) {
    filteredNodes = nodes.filter((node) => pathNodes.has(node.data.id));
    filteredEdges = edgePairs.filter(([left, right]) => pathNodes.has(left) && pathNodes.has(right));
    filteredOrderEdges = filteredOrderEdges.filter(([left, right]) => pathNodes.has(left) && pathNodes.has(right));
  }
  const elements = [...filteredNodes];
  for (const [left, right] of filteredEdges) {
    elements.push({ data: { id: `edge:${left}->${right}`, source: left, target: right, path: pathEdges.has(`${left}->${right}`) ? 'true' : 'false' } });
  }
  for (const [left, right] of filteredOrderEdges) {
    elements.push({ data: { id: `order:${left}->${right}`, source: left, target: right, path: 'false', kind: 'order' } });
  }
  return { elements, branchFound };
}
function buildAllGraph(focusId) {
  const nodeDefs = new Map();
  const edgeDefs = new Set();
  const orderEdges = new Set();
  const familyNodes = new Set();
  function addPerson(personId) {
    const person = state.peopleById[personId];
    if (!person) return;
    nodeDefs.set(`person:${personId}`, { data: { id: `person:${personId}`, kind: 'person', person_id: personId, label: displayName(person), dates: graphDatesLine(person), meta: '', selected: personId === focusId ? 'true' : 'false', path: 'false', display_label: [displayName(person), graphDatesLine(person)].filter(Boolean).join('\\n') } });
  }
  function addFamily(id, label = '') {
    const key = `family:${id}`;
    if (!familyNodes.has(key)) {
      familyNodes.add(key);
      nodeDefs.set(key, { data: { id: key, kind: 'family', label, path: 'false' } });
    }
    return key;
  }
  function addPartnerOrder(leftId, rightId) {
    if (!leftId || !rightId) return;
    const left = state.peopleById[leftId] || {};
    const right = state.peopleById[rightId] || {};
    let orderedLeft = leftId;
    let orderedRight = rightId;
    if ((left.sex || '') === 'F' && (right.sex || '') === 'M') {
      orderedLeft = rightId;
      orderedRight = leftId;
    } else if ((left.sex || '') === (right.sex || '') && (left.name || '') > (right.name || '')) {
      orderedLeft = rightId;
      orderedRight = leftId;
    }
    orderEdges.add(`person:${orderedLeft}->person:${orderedRight}`);
  }
  const pairChildren = new Map();
  for (const person of state.people) {
    if (person.father && person.mother) {
      const key = `${person.father}|${person.mother}`;
      if (!pairChildren.has(key)) pairChildren.set(key, []);
      pairChildren.get(key).push(person.id);
    }
  }
  const processedPairs = new Set();
  for (const [key, marriage] of Object.entries(state.marriages)) {
    const [leftId, rightId] = key.split('|');
    const pairKey = [leftId, rightId].sort().join('|');
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);
    addPerson(leftId);
    addPerson(rightId);
    const familyKey = addFamily(`all_${pairKey.replace('|', '_')}`, marriage?.date || '');
    edgeDefs.add(`person:${leftId}->${familyKey}`);
    edgeDefs.add(`person:${rightId}->${familyKey}`);
    addPartnerOrder(leftId, rightId);
    for (const childId of [...(pairChildren.get(`${leftId}|${rightId}`) || []), ...(pairChildren.get(`${rightId}|${leftId}`) || [])]) {
      addPerson(childId);
      edgeDefs.add(`${familyKey}->person:${childId}`);
    }
  }
  for (const [key, childIds] of pairChildren.entries()) {
    const [fatherId, motherId] = key.split('|');
    const pairKey = [fatherId, motherId].sort().join('|');
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);
    addPerson(fatherId);
    addPerson(motherId);
    const familyKey = addFamily(`all_${pairKey.replace('|', '_')}`);
    edgeDefs.add(`person:${fatherId}->${familyKey}`);
    edgeDefs.add(`person:${motherId}->${familyKey}`);
    addPartnerOrder(fatherId, motherId);
    for (const childId of childIds) {
      addPerson(childId);
      edgeDefs.add(`${familyKey}->person:${childId}`);
    }
  }
  if (focusId && !nodeDefs.has(`person:${focusId}`)) addPerson(focusId);
  return [...nodeDefs.values(), ...[...edgeDefs].map((value) => {
    const [source, target] = value.split('->');
    return { data: { id: `edge:${value}`, source, target, path: 'false' } };
  }), ...[...orderEdges].map((value) => {
    const [source, target] = value.split('->');
    return { data: { id: `order:${value}`, source, target, path: 'false', kind: 'order' } };
  })];
}
function personSources(personId) {
  const results = [];
  const sourceIds = new Set();
  const personEvents = state.data.events.filter((event) => [event.person_id, event.groom_id, event.bride_id].includes(personId));
  for (const event of personEvents) {
    for (const sourceId of event.source_ids || []) sourceIds.add(sourceId);
  }
  for (const sourceId of sourceIds) {
    const source = (state.data.sources || []).find((item) => item.id === sourceId) || {};
    const linkedEvents = personEvents.filter((event) => (event.source_ids || []).includes(sourceId));
    results.push({ ...source, linked_events: linkedEvents });
  }
  return results;
}
function renderPerson(personId) {
  const person = state.peopleById[personId] || {};
  treeTitle.textContent = displayName(person) || 'Family tree';
  const fields = [
    ['Name', `${displayName(person) || ''}${person.id ? ` (${person.id})` : ''}`],
    ['Birth', [person.birth_date, person.birth_place].filter(Boolean).join(' | ')],
    ['Death', [person.death_date, person.death_place].filter(Boolean).join(' | ')],
    ['Sex', person.sex || ''],
    ['Confidence', person.confidence || ''],
    ['Provenance', person.provenance || ''],
    ['Notes', person.notes || ''],
  ];
  personSummary.innerHTML = fields.map(([label, value]) => `<dt>${label}</dt><dd>${value || ''}</dd>`).join('');
  const sources = personSources(personId);
  if (!sources.length) {
    sourcesList.innerHTML = '<p class=\"hint\">No source links for this person.</p>';
    return;
  }
  sourcesList.innerHTML = sources.map((source) => {
    const imageUrl = source.local_image || '';
    const isImage = /\\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(source.local_image || '');
    const eventLabels = (source.linked_events || []).map((event) => `<span class=\"link-chip\">${event.event_type}${event.date ? `, ${event.date}` : ''}</span>`).join('');
    return `<article class=\"source-card\"><h4>${source.title || source.id}</h4><div class=\"source-meta\">${[source.id, source.type, source.date, source.priority].filter(Boolean).join(' | ')}</div>${eventLabels ? `<div>${eventLabels}</div>` : ''}<div class=\"source-actions\">${source.archive_url ? `<a class=\"link-chip\" href=\"${source.archive_url}\" target=\"_blank\" rel=\"noreferrer\">Open website</a>` : ''}${imageUrl ? `<a class=\"link-chip\" href=\"${imageUrl}\" target=\"_blank\" rel=\"noreferrer\">${isImage ? 'Open image' : 'Open local file'}</a>` : ''}</div>${imageUrl && isImage ? `<img class=\"image-thumb\" src=\"${imageUrl}\" alt=\"${source.title || source.id}\" />` : ''}</article>`;
  }).join('');
}
function fitGraph() {
  if (!state.cy) return;
  const pathElements = state.cy.elements('[path = \"true\"]');
  if (state.branchTargetId && pathElements.length) {
    state.cy.animate({ fit: { eles: pathElements, padding: 90 }, duration: 220 });
    return;
  }
  state.cy.fit(state.cy.elements(), 40);
}
function dagreLayoutOptions() {
  return {
    name: 'dagre',
    rankDir: 'TB',
    ranker: 'network-simplex',
    nodeSep: 30,
    rankSep: 78,
    edgeSep: 10,
    fit: true,
    padding: 32,
    animate: false,
    spacingFactor: 0.95,
    minLen: (edge) => (edge.data('kind') === 'order' ? 0 : 1),
    edgeWeight: (edge) => {
      if (edge.data('kind') === 'order') return 20;
      if (edge.data('path') === 'true') return 8;
      return 4;
    },
  };
}
function buildCy(elements) {
  if (!state.cy) {
    cytoscape.use(cytoscapeDagre);
    state.cy = cytoscape({
      container: document.getElementById('cy'),
      elements,
      wheelSensitivity: 0.18,
      minZoom: 0.1,
      maxZoom: 3,
      style: [
        { selector: 'node[kind = \"person\"]', style: { shape: 'round-rectangle', width: 175, height: 80, 'background-color': '#fffdf7', 'border-width': 2, 'border-color': '#ccb999', label: 'data(display_label)', 'text-wrap': 'wrap', 'text-max-width': 155, 'text-valign': 'center', 'text-halign': 'center', 'font-size': 13, 'font-weight': 700, color: '#3b2c18' } },
        { selector: 'node[kind = \"person\"][selected = \"true\"]', style: { 'background-color': '#fff2cc', 'border-color': '#b7791f', 'border-width': 3 } },
        { selector: 'node[path = \"true\"]', style: { 'border-color': '#c05621', 'border-width': 4, 'background-color': '#fff0df' } },
        { selector: 'node[kind = \"family\"]', style: { shape: 'diamond', width: 18, height: 18, 'background-color': '#c9b392', 'border-width': 1, 'border-color': '#987f5e', label: 'data(label)', 'font-size': 9, 'text-valign': 'bottom', 'text-margin-y': 11, color: '#6b5a43' } },
        { selector: 'node[kind = \"family\"][path = \"true\"]', style: { 'background-color': '#dd6b20', 'border-color': '#9c4221', width: 22, height: 22 } },
        { selector: 'edge[kind = \"order\"]', style: { width: 0, opacity: 0, 'events': 'no' } },
        { selector: 'edge', style: { width: 2, 'line-color': '#a08f73', 'curve-style': 'taxi', 'taxi-direction': 'vertical', 'taxi-turn': 22 } },
        { selector: 'edge[path = \"true\"]', style: { width: 4, 'line-color': '#dd6b20' } }
      ],
      layout: dagreLayoutOptions()
    });
    state.cy.on('tap', 'node[kind = \"person\"]', (event) => {
      const personId = event.target.data('person_id');
      if (!personId || personId === state.focusId) return;
      state.focusId = personId;
      if (!state.displayAll) {
        state.branchTargetId = '';
        state.branchOnly = false;
        branchOnlyToggle.checked = false;
      }
      refresh();
    });
    fitGraph();
  } else {
    state.cy.json({ elements });
    const layout = state.cy.layout(dagreLayoutOptions());
    layout.one('layoutstop', fitGraph);
    layout.run();
  }
}
function refresh() {
  const branchOptions = state.displayAll ? [] : branchChoices(state.focusId);
  setOptions(branchSelect, branchOptions, state.branchTargetId, true);
  branchSelect.disabled = state.displayAll;
  branchOnlyToggle.disabled = state.displayAll || !state.branchTargetId;
  let payload;
  if (state.displayAll) {
    payload = { elements: buildAllGraph(state.focusId), branchFound: false };
    branchHint.textContent = 'Display all shows the full connected structure.';
  } else {
    payload = buildFamilyGraph(state.focusId, state.branchTargetId, state.branchOnly);
    branchHint.textContent = payload.branchFound ? '' : (state.branchTargetId ? 'Selected branch target is outside the current branch window.' : '');
  }
  buildCy(payload.elements);
  renderPerson(state.focusId);
  focusSelect.value = state.focusId;
}
searchInput.addEventListener('input', () => {
  const filtered = state.people.filter((person) => personMatches(person, searchInput.value));
  setOptions(focusSelect, filtered, filtered.some((person) => person.id === state.focusId) ? state.focusId : (filtered[0]?.id || ''));
  if (!filtered.some((person) => person.id === state.focusId) && filtered[0]) {
    state.focusId = filtered[0].id;
    refresh();
  }
});
focusSelect.addEventListener('change', () => {
  state.focusId = focusSelect.value;
  state.branchTargetId = '';
  state.branchOnly = false;
  branchOnlyToggle.checked = false;
  refresh();
});
displayAllToggle.addEventListener('change', () => {
  state.displayAll = displayAllToggle.checked;
  state.branchTargetId = '';
  state.branchOnly = false;
  branchOnlyToggle.checked = false;
  refresh();
});
branchSelect.addEventListener('change', () => {
  state.branchTargetId = branchSelect.value;
  state.branchOnly = Boolean(state.branchTargetId);
  branchOnlyToggle.checked = state.branchOnly;
  refresh();
});
branchOnlyToggle.addEventListener('change', () => {
  state.branchOnly = branchOnlyToggle.checked;
  refresh();
});
async function bootstrap() {
  const response = await fetch('./data/genealogy.json');
  state.data = await response.json();
  state.people = [...state.data.people].sort((left, right) => `${left.name || ''}${left.birth_date || ''}`.localeCompare(`${right.name || ''}${right.birth_date || ''}`));
  state.peopleById = Object.fromEntries(state.people.map((person) => [person.id, person]));
  state.childrenByParent = {};
  for (const person of state.people) {
    for (const key of ['father', 'mother']) {
      const parentId = person[key];
      if (!parentId) continue;
      if (!state.childrenByParent[parentId]) state.childrenByParent[parentId] = [];
      state.childrenByParent[parentId].push(person.id);
    }
  }
  for (const key of Object.keys(state.childrenByParent)) {
    state.childrenByParent[key].sort((leftId, rightId) => {
      const left = state.peopleById[leftId];
      const right = state.peopleById[rightId];
      return compareBirthKey(birthSortKey(left), birthSortKey(right)) || (left?.name || '').localeCompare(right?.name || '');
    });
  }
  state.marriages = {};
  for (const event of state.data.events) {
    if ((event.event_type || '').toLowerCase() !== 'marriage') continue;
    const groomId = event.groom_id || '';
    const brideId = event.bride_id || '';
    if (!groomId || !brideId) continue;
    state.marriages[`${groomId}|${brideId}`] = event;
    state.marriages[`${brideId}|${groomId}`] = event;
  }
  state.focusId = state.people[0]?.id || '';
  setOptions(focusSelect, state.people.map((person) => ({ id: person.id, label: personLabel(person), name: person.name || '' })), state.focusId);
  refresh();
}
bootstrap();
"""


def build_static_site(db: Dict[str, List[Dict[str, str]]]) -> None:
    static_db = json.loads(json.dumps(db))
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    write_text(SITE_DIR / "index.html", build_static_index_html())
    write_text(SITE_DIR / "styles.css", build_static_styles_css())
    write_text(SITE_DIR / "app.js", build_static_app_js())
    write_text(SITE_DIR / ".nojekyll", "")
    assets_dir = SITE_DIR / "assets"
    if assets_dir.exists():
        shutil.rmtree(assets_dir)
    for source in static_db.get("sources", []):
        local_image = source.get("local_image", "")
        if not local_image:
            continue
        src_path = resolve_data_path(local_image)
        if not src_path.exists() or not src_path.is_file():
            source["local_image"] = ""
            continue
        rel_dir = assets_dir / "media"
        rel_dir.mkdir(parents=True, exist_ok=True)
        safe_name = f"{source.get('id','source')}-{src_path.name}"
        target_path = rel_dir / safe_name
        shutil.copy2(src_path, target_path)
        source["local_image"] = f"./assets/media/{safe_name}"
    write_text(SITE_DIR / "data" / "genealogy.json", json.dumps(static_db, indent=2, ensure_ascii=True) + "\n")


def build_exports() -> Tuple[int, int, int]:
    db = load_db()
    people = db["people"]
    events = db["events"]
    sources = db["sources"]

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    write_csv(EXPORTS_DIR / "people.csv", people)
    write_csv(EXPORTS_DIR / "events.csv", events)
    write_csv(EXPORTS_DIR / "events_review.csv", build_event_review_rows(people, events, sources))
    write_csv(EXPORTS_DIR / "sources.csv", sources)
    write_text(EXPORTS_DIR / "dashboard.md", build_dashboard(people, events, sources))
    write_text(EXPORTS_DIR / "overview.html", build_html(people, events, sources))
    write_text(EXPORTS_DIR / "vajda.ged", build_gedcom(people, events))
    build_static_site(db)
    return len(people), len(events), len(sources)


def add_person_interactive(db: Dict[str, List[Dict[str, str]]]) -> None:
    person_id = next_id(db["people"], "P")
    name = input("Full name: ").strip()
    birth_date = input("Birth date/year (optional): ").strip()
    birth_place = input("Birth place (optional): ").strip()
    father = input("Father person ID (optional): ").strip()
    mother = input("Mother person ID (optional): ").strip()
    sex = input("Sex [M/F/U] (optional): ").strip().upper()
    confidence = input("Confidence [confirmed/probable/possible]: ").strip() or "possible"

    db["people"].append(
        {
            "id": person_id,
            "name": name,
            "birth_date": birth_date,
            "birth_place": birth_place,
            "father": father,
            "mother": mother,
            "sex": sex,
            "confidence": confidence,
            "notes": "",
        }
    )
    save_db(db)
    print(f"Created person {person_id}")


def add_source_interactive(db: Dict[str, List[Dict[str, str]]]) -> None:
    source_id = next_id(db["sources"], "S")
    title = input("Short source title: ").strip()
    source_type = input("Type: ").strip()
    parish = input("Parish: ").strip()
    date = input("Date/year in record: ").strip()
    archive_url = input("Archive URL: ").strip()
    image_url = input("Image URL: ").strip()
    local_image = input("Local image path (optional): ").strip()
    reliability = input("Reliability [high/medium/low]: ").strip()

    db["sources"].append(
        {
            "id": source_id,
            "title": title,
            "type": source_type,
            "parish": parish,
            "date": date,
            "archive_url": archive_url,
            "image_url": image_url,
            "local_image": local_image,
            "reliability": reliability,
        }
    )
    save_db(db)
    print(f"Created source {source_id}")


def add_event_interactive(db: Dict[str, List[Dict[str, str]]]) -> None:
    event_date = input("Event date (YYYY-MM-DD or year): ").strip()
    event_type = input("Event type: ").strip()
    place = input("Place: ").strip()
    confidence = input("Confidence [confirmed/probable/possible]: ").strip() or "possible"
    groom_id = ""
    bride_id = ""
    if event_type.lower() == "marriage":
        groom_id = input("Groom person ID (optional): ").strip()
        bride_id = input("Bride person ID (optional): ").strip()

    eid = f"E{slugify(event_date or 'undated')}-{slugify(event_type or 'event')}-{len(db['events']) + 1:03d}"
    db["events"].append(
        {
            "id": eid,
            "event_type": event_type,
            "date": event_date,
            "place": place,
            "confidence": confidence,
            "groom_id": groom_id,
            "bride_id": bride_id,
        }
    )
    save_db(db)
    print(f"Created event {eid}")


def wizard() -> None:
    db = load_db()
    actions = {
        "1": ("Add person", add_person_interactive),
        "2": ("Add source", add_source_interactive),
        "3": ("Add event", add_event_interactive),
        "4": ("Build exports", None),
        "5": ("Quit", None),
    }

    while True:
        print("\nGenealogy Builder (JSON)")
        for key, (label, _) in actions.items():
            print(f"{key}) {label}")
        choice = input("Select: ").strip()

        if choice == "5":
            print("Bye")
            return
        if choice == "4":
            p, e, s = build_exports()
            print(f"Built exports for {p} people, {e} events, {s} sources.")
            db = load_db()
            continue
        fn = actions.get(choice, ("", None))[1]
        if fn is None:
            print("Invalid choice")
            continue
        fn(db)
        db = load_db()


def main() -> None:
    parser = argparse.ArgumentParser(description="Programmatic genealogy builder")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("wizard", help="Run interactive wizard")
    sub.add_parser("build", help="Build exports from JSON database")
    duplicate_parser = sub.add_parser("duplicate-report", help="Write likely duplicate person pairs for review")
    duplicate_parser.add_argument("--min-score", type=int, default=45, help="Minimum match score to include")
    sub.add_parser("migrate-markdown", help="One-time migration from markdown structure to JSON")
    sync_parser = sub.add_parser("sync-report", help="Analyze a GEDCOM file and write a match review report")
    sync_parser.add_argument("--file", required=True, help="Path to GEDCOM file")
    import_parser = sub.add_parser("import-gedcom", help="Import GEDCOM (e.g. export from MyHeritage)")
    import_parser.add_argument("--file", required=True, help="Path to GEDCOM file")
    import_parser.add_argument(
        "--mode",
        choices=["merge", "replace"],
        default="merge",
        help="merge: keep existing JSON and add data; replace: overwrite people/events with GEDCOM import",
    )

    args = parser.parse_args()
    if args.cmd == "wizard":
        wizard()
        return
    if args.cmd == "build":
        p, e, s = build_exports()
        print(f"Built exports for {p} people, {e} events, {s} sources.")
        return
    if args.cmd == "duplicate-report":
        report = write_duplicate_report(min_score=args.min_score)
        print(
            "Duplicate report written to outputs/duplicate-report.{json,csv,md}: "
            f"{report['candidate_pairs']} candidate pairs at min score {report['min_score']}."
        )
        return
    if args.cmd == "migrate-markdown":
        p, e, s = migrate_markdown()
        print(f"Migrated markdown into data/genealogy.json: {p} people, {e} events, {s} sources.")
        return
    if args.cmd == "sync-report":
        path = Path(args.file)
        if not path.exists():
            raise SystemExit(f"GEDCOM file not found: {path}")
        report = write_sync_report(path)
        print(
            "Sync report written to outputs/sync-report.{json,md}: "
            f"{report['summary']['auto_match']} auto-match, "
            f"{report['summary']['review']} review, "
            f"{report['summary']['new']} new."
        )
        return
    if args.cmd == "import-gedcom":
        path = Path(args.file)
        if not path.exists():
            raise SystemExit(f"GEDCOM file not found: {path}")
        if args.mode == "merge":
            write_sync_report(path)
        imported_people, imported_events, total_people = import_gedcom(path, args.mode)
        print(
            f"Imported GEDCOM ({args.mode}): {imported_people} people, {imported_events} family events. "
            f"Total people in database: {total_people}."
        )
        return
    parser.print_help()


if __name__ == "__main__":
    main()
