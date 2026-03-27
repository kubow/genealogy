# Genealogy

Project layout:

- `app/` - local UIs: Flask editor, Streamlit viewer, templates, static assets, components
- `data/` - canonical data: `genealogy.json`, media, backups
- `sources/` - raw input files to import, such as GEDCOM exports
- `outputs/` - generated export files: CSV, GEDCOM, reports
- `docs/` - generated read-only static site for GitHub Pages
- `scripts/` - maintenance and build scripts:
  `genealogy_builder.py build` = regenerate `outputs/` and `docs/`
  `genealogy_builder.py sync-report --file sources/<file>.ged` = preview GEDCOM matches
  `genealogy_builder.py import-gedcom --file sources/<file>.ged --mode merge` = import GEDCOM
  `genealogy_builder.py wizard` = manual editing helper
  `genealogy_guardrails.py check` = validate canonical JSON structure
  `genealogy_guardrails.py fix` = normalize canonical JSON and write it back safely

Main files:

- canonical database: `data/genealogy.json`
- Flask app: `python3 -m app.flask_app`
- Streamlit app: `streamlit run app/streamlit_app.py`

Typical flow:

1. Put source GEDCOM files into `sources/`.
2. Run `sync-report`.
3. Run `import-gedcom`.
4. Run `build`.

JSON guard rails:

- `python3 scripts/genealogy_guardrails.py check`
- `python3 scripts/genealogy_guardrails.py fix`

Local docs preview:

- do not open `docs/index.html` directly as `file://`
- use `python3 scripts/serve_docs.py`
- then open `http://127.0.0.1:8000`

Install and run:

- `python3 -m pip install -r requirements.txt`
- `python3 -m app.flask_app`
- `streamlit run app/streamlit_app.py`
