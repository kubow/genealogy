# Data Model

Current person fields:

- `id`
- `name`
- `sex`
- `birth_date`, `birth_place`
- `death_date`, `death_place`
- `father`, `mother`
- `confidence`
- `provenance`
- `notes`

Current limitation:

- `name` has to carry both identity and display concerns, so it cannot cleanly represent maiden name, married surname, and uncertain family names at the same time.

Recommended next extensions:

- `birth_surname`: family-of-origin surname
- `married_surname`: spouse/family surname used later in life
- `display_name`: optional curated display override for UI
- `aliases`: alternate spellings and record-name variants
- `review_status`: `imported`, `reviewed`, `trusted`

Suggested rule:

- keep raw genealogical identity in structured fields
- let the UI build the visible label from those fields
- use `display_name` only when the structured fields still cannot express the intended presentation
