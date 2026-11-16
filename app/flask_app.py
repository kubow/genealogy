#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

from app.genealogy_core import (
    DEFAULT_ANCESTOR_DEPTH,
    DEFAULT_DESCENDANT_DEPTH,
    branch_choices,
    build_all_graph_elements,
    build_family_graph_elements,
    build_trace_graph_elements,
    build_couple_ancestor_elements,
    display_name,
    event_detail_payload,
    linked_event_summaries,
    load_indexes,
    merge_person_records,
    person_detail_payload,
    person_label,
    person_needs_review,
    promote_person_record,
    validate_event_links,
    validate_parent_links,
)
from scripts.genealogy_builder import DATA_DIR, ROOT, load_db, next_id, save_db

APP_DIR = Path(__file__).resolve().parent
app = Flask(__name__, template_folder=str(APP_DIR / "templates"), static_folder=str(APP_DIR / "static"))
MEDIA_UPLOADS_DIR = DATA_DIR / "media" / "uploads"


def available_data_files() -> list[Path]:
    """Return only JSON databases stored directly in the project's data directory."""
    return sorted(DATA_DIR.glob("*.json"), key=lambda path: (path.name != "genealogy.json", path.name.lower()))


def selected_data_path() -> Path:
    """Resolve the requested database without allowing paths outside data/."""
    requested = request.args.get("data", "genealogy.json")
    for path in available_data_files():
        if path.name == requested:
            return path
    return DATA_DIR / "genealogy.json"


def preferred_focus_id(db: dict[str, Any], people: list[dict[str, str]]) -> str:
    """Choose a useful landing person without letting blank names sort first."""
    configured = str(db.get("settings", {}).get("home_person_id", "")).strip()
    valid_ids = {person.get("id", "") for person in people}
    if configured in valid_ids:
        return configured
    source_order_people = db.get("people", [])
    preferred = next(
        (
            person
            for person in source_order_people
            if person.get("name")
            and person.get("confidence") == "confirmed"
            and person.get("provenance") in {"primary", "manual"}
        ),
        None,
    )
    if preferred:
        return preferred.get("id", "")
    named = next((person for person in people if person.get("name")), None)
    return named.get("id", "") if named else (people[0].get("id", "") if people else "")


@app.get("/")
def index() -> str:
    return render_template("index.html")


@app.get("/media/<path:filename>")
def media(filename: str):
    # Older records may use either a data-relative path (media/uploads/...) or
    # a project-relative source path (sources/...); both are safe to serve.
    if (DATA_DIR / filename).is_file():
        return send_from_directory(DATA_DIR, filename)
    return send_from_directory(ROOT, filename)


@app.get("/api/bootstrap")
def api_bootstrap():
    data_path = selected_data_path()
    db, people, events, _, people_by_id, _, _, sources_by_id = load_indexes(data_path)
    review_total = sum(1 for person in people if person_needs_review(person))
    linked_events = linked_event_summaries(events, people_by_id, sources_by_id)
    return jsonify(
        {
            "people": [
                {
                    "id": person["id"],
                    "label": person_label(person, people_by_id),
                    "name": person.get("name", ""),
                    "search_name": " ".join(
                        bit
                        for bit in [
                            person.get("name", ""),
                            person.get("birth_surname", ""),
                            person.get("married_surname", ""),
                            display_name(person, people_by_id),
                            person.get("birth_place", ""),
                            person.get("death_place", ""),
                        ]
                        if bit
                    ),
                    "needs_review": person_needs_review(person),
                    "provenance": person.get("provenance", ""),
                    "confidence": person.get("confidence", ""),
                }
                for person in people
            ],
            "default_focus_id": preferred_focus_id(db, people),
            "review_total": review_total,
            "linked_events": linked_events,
            "default_event_id": linked_events[0]["id"] if linked_events else "",
            "data_files": [path.name for path in available_data_files()],
            "active_data_file": data_path.name,
        }
    )


@app.get("/api/graph")
def api_graph():
    db, people, events, _, people_by_id, children_by_parent, marriages, sources_by_id = load_indexes(selected_data_path())
    focus_id = request.args.get("focus_id", preferred_focus_id(db, people))
    branch_target_id = request.args.get("branch_target_id", "")
    trace_target_id = request.args.get("trace_target_id", "")
    view_mode = request.args.get("view_mode", "tree")
    branch_only = request.args.get("branch_only", "false").lower() == "true"
    display_all = request.args.get("display_all", "false").lower() == "true"
    branch_options = [] if display_all else (branch_choices(focus_id, people_by_id, children_by_parent) if focus_id else [])
    partner_id = ""
    if view_mode in {"couple-star", "two-way-fan"}:
        elements, partner_id = build_couple_ancestor_elements(focus_id, people_by_id, children_by_parent, marriages)
        branch_found = True
    elif trace_target_id:
        elements, branch_found = build_trace_graph_elements(
            focus_id, trace_target_id, people_by_id, children_by_parent, marriages, trace_only=branch_only
        )
    elif display_all:
        elements = build_all_graph_elements(focus_id, people_by_id, children_by_parent, marriages)
        branch_found = False
    else:
        descendant_depth = 99 if branch_target_id else DEFAULT_DESCENDANT_DEPTH
        elements, branch_found = build_family_graph_elements(
            focus_id,
            people_by_id,
            children_by_parent,
            marriages,
            DEFAULT_ANCESTOR_DEPTH,
            descendant_depth,
            branch_target_id=branch_target_id,
            branch_only=branch_only,
        )
    return jsonify(
        {
            "elements": elements,
            "branch_options": branch_options,
            "branch_found": branch_found,
            "display_all": display_all,
            "focus_person": person_detail_payload(focus_id, people_by_id, people, events, sources_by_id, children_by_parent, marriages),
            "view_partner_id": partner_id,
        }
    )


@app.get("/api/person/<person_id>")
def api_person(person_id: str):
    _, people, events, _, people_by_id, children_by_parent, marriages, sources_by_id = load_indexes(selected_data_path())
    return jsonify(person_detail_payload(person_id, people_by_id, people, events, sources_by_id, children_by_parent, marriages))


@app.get("/api/event/<event_id>")
def api_event(event_id: str):
    _, people, events, sources, people_by_id, _, _, sources_by_id = load_indexes(selected_data_path())
    payload = event_detail_payload(event_id, events, people, sources, people_by_id, sources_by_id)
    if not payload:
        return jsonify({"error": "Event not found"}), 404
    return jsonify(payload)


@app.get("/api/couple/<event_id>")
def api_couple(event_id: str):
    _, people, events, _, people_by_id, children_by_parent, marriages, sources_by_id = load_indexes(selected_data_path())
    event = next((e for e in events if e.get("id") == event_id), None)
    if not event:
        return jsonify({"error": "Event not found"}), 404
    groom_id = event.get("groom_id", "")
    bride_id = event.get("bride_id", "")
    groom = person_detail_payload(groom_id, people_by_id, people, events, sources_by_id, children_by_parent, marriages) if groom_id else None
    bride = person_detail_payload(bride_id, people_by_id, people, events, sources_by_id, children_by_parent, marriages) if bride_id else None
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
                "local_image_available": (DATA_DIR / source.get("local_image", "")).is_file() or (ROOT / source.get("local_image", "")).is_file(),
                "priority": source.get("priority", ""),
            }
        )
    return jsonify({"event": event, "groom": groom, "bride": bride, "sources": sources})


@app.post("/api/event/<event_id>")
def api_event_update(event_id: str):
    payload = request.get_json(force=True)
    data_path = selected_data_path()
    db = load_db(data_path)
    event = next((item for item in db["events"] if item.get("id") == event_id), None)
    if event is None:
        return jsonify({"error": "Event not found"}), 404

    people_by_id = {person.get("id", ""): person for person in db["people"] if person.get("id")}
    event_type = str(payload.get("event_type", event.get("event_type", ""))).strip()
    person_id = str(payload.get("person_id", "")).strip()
    groom_id = str(payload.get("groom_id", "")).strip()
    bride_id = str(payload.get("bride_id", "")).strip()
    validation_error = validate_event_links(people_by_id, event_type, person_id, groom_id, bride_id)
    if validation_error:
        return jsonify({"error": validation_error}), 400

    for key in ["event_type", "date", "place", "confidence", "provenance", "notes", "person_id", "groom_id", "bride_id"]:
        event[key] = str(payload.get(key, "")).strip()

    save_db(db, data_path)
    return jsonify({"ok": True, "event_id": event_id})


@app.post("/api/event/<event_id>/link-source")
def api_event_link_source(event_id: str):
    payload = request.get_json(force=True)
    source_id = str(payload.get("source_id", "")).strip()
    if not source_id:
        return jsonify({"error": "Source is required"}), 400

    data_path = selected_data_path()
    db = load_db(data_path)
    event = next((item for item in db["events"] if item.get("id") == event_id), None)
    if event is None:
        return jsonify({"error": "Event not found"}), 404
    source = next((item for item in db["sources"] if item.get("id") == source_id), None)
    if source is None:
        return jsonify({"error": "Source not found"}), 404

    source_ids = list(event.get("source_ids", []) or [])
    if source_id not in source_ids:
        source_ids.append(source_id)
    event["source_ids"] = source_ids
    save_db(db, data_path)
    return jsonify({"ok": True, "event_id": event_id, "source_id": source_id})


@app.post("/api/event/<event_id>/sources")
def api_event_add_source(event_id: str):
    payload = request.form if request.form else request.get_json(force=True)
    title = str(payload.get("title", "")).strip()
    archive_url = str(payload.get("archive_url", "")).strip()
    source_type = str(payload.get("type", "")).strip()
    source_date = str(payload.get("date", "")).strip()
    priority = str(payload.get("priority", "")).strip()
    upload = request.files.get("image")
    local_image = ""

    if not title and not archive_url:
        return jsonify({"error": "Provide at least a title or archive URL"}), 400

    data_path = selected_data_path()
    db = load_db(data_path)
    event = next((item for item in db["events"] if item.get("id") == event_id), None)
    if event is None:
        return jsonify({"error": "Event not found"}), 404

    source_id = next_id(db["sources"], "S")
    if upload and upload.filename:
        MEDIA_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        filename = secure_filename(upload.filename)
        filename = f"{source_id}_{filename}" if filename else f"{source_id}.bin"
        target = MEDIA_UPLOADS_DIR / filename
        upload.save(target)
        local_image = f"media/uploads/{filename}"

    db["sources"].append(
        {
            "id": source_id,
            "title": title or f"Source for {event.get('event_type', 'event')}",
            "type": source_type,
            "date": source_date,
            "archive_url": archive_url,
            "image_url": "",
            "local_image": local_image,
            "priority": priority or "primary",
        }
    )

    source_ids = list(event.get("source_ids", []) or [])
    if source_id not in source_ids:
        source_ids.append(source_id)
    event["source_ids"] = source_ids

    save_db(db, data_path)
    return jsonify({"ok": True, "event_id": event_id, "source_id": source_id})


@app.post("/api/source/<source_id>")
def api_source_update(source_id: str):
    payload = request.get_json(force=True)
    data_path = selected_data_path()
    db = load_db(data_path)
    source = next((item for item in db["sources"] if item.get("id") == source_id), None)
    if source is None:
        return jsonify({"error": "Source not found"}), 404

    for key in ["title", "type", "date", "archive_url", "priority"]:
        source[key] = str(payload.get(key, "")).strip()

    save_db(db, data_path)
    return jsonify({"ok": True, "source_id": source_id})


@app.post("/api/person/<person_id>")
def api_person_update(person_id: str):
    payload = request.get_json(force=True)
    data_path = selected_data_path()
    db = load_db(data_path)
    people_by_id = {person.get("id", ""): person for person in db["people"] if person.get("id")}
    father_id = str(payload.get("father", "")).strip()
    mother_id = str(payload.get("mother", "")).strip()
    validation_error = validate_parent_links(people_by_id, person_id, father_id, mother_id)
    if validation_error:
        return jsonify({"error": validation_error}), 400

    updated = None
    for person in db["people"]:
        if person.get("id") != person_id:
            continue
        updated = person
        for key in [
            "name",
            "sex",
            "confidence",
            "birth_date",
            "birth_place",
            "birth_surname",
            "married_surname",
            "death_date",
            "death_place",
            "father",
            "mother",
            "provenance",
            "notes",
        ]:
            person[key] = str(payload.get(key, "")).strip()
        break
    if updated is None:
        return jsonify({"error": "Person not found"}), 404
    save_db(db, data_path)
    return jsonify({"ok": True})


@app.post("/api/person/<person_id>/sources")
def api_person_add_source(person_id: str):
    payload = request.form if request.form else request.get_json(force=True)
    event_id = str(payload.get("event_id", "")).strip()
    title = str(payload.get("title", "")).strip()
    archive_url = str(payload.get("archive_url", "")).strip()
    source_type = str(payload.get("type", "")).strip()
    source_date = str(payload.get("date", "")).strip()
    priority = str(payload.get("priority", "")).strip()
    event_date = str(payload.get("event_date", "")).strip()
    event_place = str(payload.get("event_place", "")).strip()
    event_confidence = str(payload.get("event_confidence", "")).strip() or "possible"
    upload = request.files.get("image")
    local_image = ""

    if not event_id:
        return jsonify({"error": "Event is required"}), 400
    if not title and not archive_url:
        return jsonify({"error": "Provide at least a title or archive URL"}), 400

    data_path = selected_data_path()
    db = load_db(data_path)
    if event_id in {"__new_birth__", "__new_death__", "__new_research__"}:
        event_type = {
            "__new_birth__": "Birth/Baptism",
            "__new_death__": "Death",
            "__new_research__": "ResearchTask",
        }[event_id]
        event_slug = event_type.lower().replace("/", "-").replace(" ", "-")
        new_event_id = f"E{(event_date or 'undated')}-{event_slug}-{len(db['events']) + 1:03d}"
        event = {
            "id": new_event_id,
            "event_type": event_type,
            "date": event_date,
            "place": event_place,
            "confidence": event_confidence,
            "person_id": person_id if event_type != "ResearchTask" else "",
            "source_ids": [],
            "provenance": "manual",
        }
        if event_type == "ResearchTask":
            event["notes"] = f"Added while researching {person_id}."
        db["events"].append(event)
    else:
        event = next((item for item in db["events"] if item.get("id") == event_id), None)
        if event is None:
            return jsonify({"error": "Event not found"}), 404

    involved = person_id in {event.get("person_id", ""), event.get("groom_id", ""), event.get("bride_id", "")}
    if not involved:
        return jsonify({"error": "Selected event is not linked to this person"}), 400

    source_id = next_id(db["sources"], "S")
    if upload and upload.filename:
        MEDIA_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        filename = secure_filename(upload.filename)
        filename = f"{source_id}_{filename}" if filename else f"{source_id}.bin"
        target = MEDIA_UPLOADS_DIR / filename
        upload.save(target)
        local_image = f"media/uploads/{filename}"
    db["sources"].append(
        {
            "id": source_id,
            "title": title or f"Source for {event.get('event_type', 'event')}",
            "type": source_type,
            "date": source_date,
            "archive_url": archive_url,
            "image_url": "",
            "local_image": local_image,
            "priority": priority or "primary",
        }
    )

    source_ids = list(event.get("source_ids", []) or [])
    if source_id not in source_ids:
        source_ids.append(source_id)
    event["source_ids"] = source_ids

    save_db(db, data_path)
    return jsonify({"ok": True, "source_id": source_id, "event_id": event["id"]})


@app.post("/api/person/<person_id>/promote")
def api_person_promote(person_id: str):
    payload = request.get_json(force=True)
    provenance = str(payload.get("provenance", "")).strip()
    confidence = str(payload.get("confidence", "")).strip()
    note = str(payload.get("note", "")).strip()

    data_path = selected_data_path()
    db = load_db(data_path)
    person = next((item for item in db["people"] if item.get("id") == person_id), None)
    if person is None:
        return jsonify({"error": "Person not found"}), 404

    promote_person_record(person, provenance, confidence, note)
    save_db(db, data_path)
    return jsonify({"ok": True, "person_id": person_id})


@app.post("/api/person/<person_id>/merge")
def api_person_merge(person_id: str):
    payload = request.get_json(force=True)
    target_id = str(payload.get("target_id", "")).strip()
    if not target_id:
        return jsonify({"error": "Target person is required"}), 400

    data_path = selected_data_path()
    db = load_db(data_path)
    try:
        merge_person_records(db, person_id, target_id)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    save_db(db, data_path)
    return jsonify({"ok": True, "target_id": target_id})


if __name__ == "__main__":
    app.run(debug=True)
