const SIDEBAR_LIMITS = {
  left: { min: 220, max: 620, default: 320 },
  right: { min: 280, max: 720, default: 380 },
};

const state = {
  people: [],
  linkedEvents: [],
  focusId: "",
  selectedEventId: "",
  branchTargetId: "",
  branchOnly: false,
  displayAll: false,
  reviewOnly: false,
  linkedEventsView: false,
  reviewTotal: 0,
  leftSidebarWidth: SIDEBAR_LIMITS.left.default,
  rightSidebarWidth: SIDEBAR_LIMITS.right.default,
  cy: null,
};

const searchInput = document.getElementById("searchInput");
const linkedEventsViewToggle = document.getElementById("linkedEventsViewToggle");
const focusSelect = document.getElementById("focusSelect");
const branchSelect = document.getElementById("branchSelect");
const branchOnlyToggle = document.getElementById("branchOnlyToggle");
const displayAllToggle = document.getElementById("displayAllToggle");
const reviewOnlyToggle = document.getElementById("reviewOnlyToggle");
const branchHint = document.getElementById("branchHint");
const reviewQueueHint = document.getElementById("reviewQueueHint");
const treeTitle = document.getElementById("treeTitle");
const rightSidebarTitle = document.getElementById("rightSidebarTitle");
const cyContainer = document.getElementById("cy");
const personForm = document.getElementById("personForm");
const sourceForm = document.getElementById("sourceForm");
const personIdField = document.getElementById("personIdField");
const sourcePersonIdField = document.getElementById("sourcePersonIdField");
const saveStatus = document.getElementById("saveStatus");
const sourceStatus = document.getElementById("sourceStatus");
const reviewPanel = document.getElementById("reviewPanel");
const reviewSummary = document.getElementById("reviewSummary");
const reviewStatus = document.getElementById("reviewStatus");
const mergeTargetSelect = document.getElementById("mergeTargetSelect");
const promoteProvenance = document.getElementById("promoteProvenance");
const promoteConfidence = document.getElementById("promoteConfidence");
const reviewNote = document.getElementById("reviewNote");
const promoteButton = document.getElementById("promoteButton");
const mergeButton = document.getElementById("mergeButton");
const sourcesList = document.getElementById("sourcesList");
const workspace = document.getElementById("workspace");
const leftSidebar = document.getElementById("leftSidebar");
const rightSidebar = document.getElementById("rightSidebar");
const leftResizer = document.getElementById("leftResizer");
const rightResizer = document.getElementById("rightResizer");
const leftToggle = document.getElementById("leftToggle");
const rightToggle = document.getElementById("rightToggle");
const leftExpand = document.getElementById("leftExpand");
const rightExpand = document.getElementById("rightExpand");
const linkedEventsPanel = document.getElementById("linkedEventsPanel");
const linkedEventsList = document.getElementById("linkedEventsList");
const linkedEventsCount = document.getElementById("linkedEventsCount");
const personAdminPanel = document.getElementById("personAdminPanel");
const eventInspectorPanel = document.getElementById("eventInspectorPanel");
const eventInspectorHeading = document.getElementById("eventInspectorHeading");
const eventInspectorContent = document.getElementById("eventInspectorContent");
const personViewOnlySections = Array.from(document.querySelectorAll(".person-view-only"));

function mediaUrl(path) {
  if (!path) return "";
  return `/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function refreshAfterMutation({ preserveFocus = true, eventId = state.selectedEventId } = {}) {
  await bootstrap(preserveFocus);
  if (state.linkedEventsView) {
    await loadEventDetails(eventId);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function optionMarkup(options, selectedValue, includePlaceholder = false, placeholderLabel = "None") {
  const items = [];
  if (includePlaceholder) {
    items.push(`<option value="">${escapeHtml(placeholderLabel)}</option>`);
  }
  for (const option of options || []) {
    const value = option.id || "";
    const selected = value === (selectedValue || "") ? " selected" : "";
    items.push(`<option value="${escapeHtml(value)}"${selected}>${escapeHtml(option.label || value)}</option>`);
  }
  return items.join("");
}

function personMatches(person, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    person.label.toLowerCase().includes(q) ||
    person.id.toLowerCase().includes(q) ||
    person.name.toLowerCase().includes(q) ||
    (person.search_name || "").toLowerCase().includes(q)
  );
}

function visiblePeople() {
  return state.people.filter((person) => {
    if (state.reviewOnly && !person.needs_review) return false;
    return personMatches(person, searchInput.value);
  });
}

function eventMatches(event, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    event.id,
    event.label,
    event.event_type,
    event.date,
    event.place,
    ...(event.linked_people || []),
    ...(event.source_ids || []),
    ...(event.source_titles || []),
  ].some((value) => (value || "").toLowerCase().includes(q));
}

function visibleLinkedEvents() {
  return state.linkedEvents.filter((event) => eventMatches(event, searchInput.value));
}

function refreshFocusOptions() {
  const filtered = visiblePeople();
  setOptions(focusSelect, filtered, filtered.some((person) => person.id === state.focusId) ? state.focusId : (filtered[0]?.id || ""));
  reviewQueueHint.textContent = state.reviewTotal
    ? `${state.reviewTotal} people still need review.`
    : "No imported people are currently marked for review.";
  return filtered;
}

function setOptions(select, options, value, includeNone = false) {
  select.innerHTML = "";
  if (includeNone) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "None";
    select.appendChild(option);
  }
  for (const item of options) {
    const option = document.createElement("option");
    option.value = item.id || item.target_id;
    option.textContent = item.label;
    select.appendChild(option);
  }
  select.value = value || "";
}

function fillParentSelect(name, options, value) {
  const select = personForm.elements[name];
  select.innerHTML = "";
  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.id;
    option.textContent = optionData.label;
    select.appendChild(option);
  }
  select.value = value || "";
}

function fillSourceEventOptions(options, value) {
  const select = sourceForm.elements.event_id;
  select.innerHTML = "";
  for (const optionData of options || []) {
    const option = document.createElement("option");
    option.value = optionData.id;
    option.textContent = optionData.label;
    select.appendChild(option);
  }
  select.value = value || (options && options[0] ? options[0].id : "");
}

function updateSidebarButtons() {
  leftExpand.classList.toggle("hidden", !leftSidebar.classList.contains("collapsed"));
  rightExpand.classList.toggle("hidden", !rightSidebar.classList.contains("collapsed"));
  leftResizer.classList.toggle("hidden", leftSidebar.classList.contains("collapsed"));
  rightResizer.classList.toggle("hidden", rightSidebar.classList.contains("collapsed"));
}

function toggleSidebar(sidebar, collapsed) {
  if (!collapsed && window.innerWidth <= 980) {
    const otherSidebar = sidebar === leftSidebar ? rightSidebar : leftSidebar;
    otherSidebar.classList.add("collapsed");
  }
  sidebar.classList.toggle("collapsed", collapsed);
  if (sidebar === leftSidebar) {
    workspace.style.setProperty("--left-sidebar-width", collapsed ? "0px" : `${state.leftSidebarWidth || SIDEBAR_LIMITS.left.default}px`);
  }
  if (sidebar === rightSidebar) {
    workspace.style.setProperty("--right-sidebar-width", collapsed ? "0px" : `${state.rightSidebarWidth || SIDEBAR_LIMITS.right.default}px`);
  }
  updateSidebarButtons();
  fitGraphToState();
  if (collapsed && sidebar === leftSidebar) {
    if (rightSidebar.classList.contains("collapsed")) {
      toggleSidebar(rightSidebar, false);
    } else if (window.innerWidth <= 980) {
      toggleSidebar(rightSidebar, false);
    }
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setSidebarWidth(side, width) {
  const limits = SIDEBAR_LIMITS[side];
  const clamped = clamp(width, limits.min, limits.max);
  if (side === "left") {
    state.leftSidebarWidth = clamped;
    workspace.style.setProperty("--left-sidebar-width", `${clamped}px`);
  } else {
    state.rightSidebarWidth = clamped;
    workspace.style.setProperty("--right-sidebar-width", `${clamped}px`);
  }
}

function beginResize(side) {
  if (window.innerWidth <= 980) return;
  const resizer = side === "left" ? leftResizer : rightResizer;
  const onMove = (event) => {
    if (side === "left") {
      setSidebarWidth("left", event.clientX);
    } else {
      setSidebarWidth("right", window.innerWidth - event.clientX);
    }
  };
  const onUp = () => {
    resizer.classList.remove("dragging");
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    fitGraphToState();
  };
  resizer.classList.add("dragging");
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function syncWorkspaceWidths() {
  if (window.innerWidth <= 980) {
    workspace.style.removeProperty("--left-sidebar-width");
    workspace.style.removeProperty("--right-sidebar-width");
    return;
  }
  workspace.style.setProperty("--left-sidebar-width", leftSidebar.classList.contains("collapsed") ? "0px" : `${state.leftSidebarWidth}px`);
  workspace.style.setProperty("--right-sidebar-width", rightSidebar.classList.contains("collapsed") ? "0px" : `${state.rightSidebarWidth}px`);
}

function updateSourceFormHint() {
  const createMode = (sourceForm.elements.event_id.value || "").startsWith("__new_");
  sourceStatus.textContent = createMode ? "Choose date/place below to create the missing event and attach the source." : "";
}

function sourceNote(source) {
  if ((source.type || "").toLowerCase() === "gedcom import") {
    return source.title || source.id;
  }
  if ((source.title || "").toLowerCase().startsWith("imported gedcom")) {
    return source.title || source.id;
  }
  return "";
}

function renderSources(events) {
  sourcesList.innerHTML = "";
  if (!events.length) {
    sourcesList.innerHTML = '<p class="hint">No linked events or sources for this person.</p>';
    return;
  }
  for (const event of events) {
    const card = document.createElement("article");
    card.className = "source-card event-link-card";
    const sourceLinks = [];
    const importNotes = [];
    for (const source of event.sources || []) {
      const note = sourceNote(source);
      if (note) {
        importNotes.push(note);
        continue;
      }
      const imageUrl = mediaUrl(source.local_image);
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(source.local_image || "");
      sourceLinks.push(`
        <div class="linked-source-card">
          <div class="source-meta">${escapeHtml([source.id, source.type, source.date, source.priority].filter(Boolean).join(" | "))}</div>
          <h4>${escapeHtml(source.title || source.id)}</h4>
          <div class="source-actions">
            ${source.archive_url ? `<a class="link-chip" href="${source.archive_url}" target="_blank" rel="noreferrer">Open website</a>` : ""}
            ${imageUrl ? `<a class="link-chip" href="${imageUrl}" target="_blank" rel="noreferrer">${isImage ? "Open image" : "Open local file"}</a>` : ""}
          </div>
          ${imageUrl && isImage ? `<img class="image-thumb" src="${imageUrl}" alt="${escapeHtml(source.title || source.id)}" />` : ""}
        </div>
      `);
    }
    card.innerHTML = `
      <div class="event-link-head">
        <h4>${escapeHtml(event.type || event.id || "Event")}</h4>
        <span class="readonly-id">${escapeHtml(event.id || "")}</span>
      </div>
      <div class="source-meta">${escapeHtml([event.date, event.place, event.confidence, event.provenance].filter(Boolean).join(" | "))}</div>
      ${importNotes.length ? `<p class="event-note">${escapeHtml(importNotes.join(" | "))}</p>` : ""}
      ${event.notes ? `<p class="event-note">${escapeHtml(event.notes)}</p>` : ""}
      ${
        (event.related_people || []).length
          ? `<div class="event-people">${event.related_people.map((person) => `<span class="link-chip">${escapeHtml(person.label)}</span>`).join("")}</div>`
          : ""
      }
      ${sourceLinks.length ? `<div class="linked-source-list">${sourceLinks.join("")}</div>` : '<p class="hint">No attached source links beyond import notes.</p>'}
    `;
    sourcesList.appendChild(card);
  }
}

function renderDetails(payload) {
  const person = payload.person || {};
  treeTitle.textContent = person.name || "Family tree";
  personForm.dataset.personId = person.id || "";
  sourceForm.dataset.personId = person.id || "";
  personIdField.value = person.id || "";
  sourcePersonIdField.value = person.id || "";
  for (const name of ["name", "sex", "confidence", "birth_date", "birth_place", "birth_surname", "married_surname", "death_date", "death_place", "provenance", "notes"]) {
    personForm.elements[name].value = person[name] || "";
  }
  fillParentSelect("father", payload.parent_options || [], person.father);
  fillParentSelect("mother", payload.parent_options || [], person.mother);
  fillSourceEventOptions(payload.event_options || []);
  updateSourceFormHint();
  renderSources(payload.events || []);
  renderReview(payload.review || {}, person);
}

function renderReview(review, person) {
  reviewPanel.classList.toggle("hidden", !state.reviewOnly);
  if (!state.reviewOnly) {
    reviewStatus.textContent = "";
    return;
  }
  const suggestedMatches = review.suggested_matches || [];
  if (!review.needs_review) {
    reviewSummary.textContent = "This person is not currently marked as needing review.";
    reviewStatus.textContent = "";
    reviewNote.value = "";
    setOptions(mergeTargetSelect, [], "", true);
    mergeTargetSelect.disabled = true;
    mergeButton.disabled = true;
    return;
  }

  reviewSummary.textContent = [
    `${person.provenance || "unknown"} provenance`,
    `${person.confidence || "unknown"} confidence`,
    suggestedMatches.length ? `${suggestedMatches.length} suggested merge target(s)` : "no suggested merge targets",
  ].join(" | ");

  setOptions(
    mergeTargetSelect,
    suggestedMatches.map((candidate) => ({
      id: candidate.id,
      label: `${candidate.label} | score ${candidate.score} | ${candidate.provenance || "unknown"}`,
    })),
    suggestedMatches[0]?.id || "",
    true,
  );
  mergeTargetSelect.disabled = !suggestedMatches.length;
  mergeButton.disabled = !suggestedMatches.length;
}

function setViewMode() {
  const linkedMode = state.linkedEventsView;
  linkedEventsPanel.classList.toggle("hidden", !linkedMode);
  cyContainer.classList.toggle("hidden", linkedMode);
  personAdminPanel.classList.toggle("hidden", linkedMode);
  eventInspectorPanel.classList.toggle("hidden", !linkedMode);
  for (const section of personViewOnlySections) {
    section.classList.toggle("hidden", linkedMode);
  }
  if (linkedMode) {
    reviewPanel.classList.add("hidden");
  }
  rightSidebarTitle.textContent = linkedMode ? "Event details" : "Admin";
  treeTitle.textContent = linkedMode ? "Linked events review" : "Family tree";
}

function renderLinkedEventsList() {
  const events = visibleLinkedEvents();
  linkedEventsCount.textContent = events.length
    ? `${events.length} linked event${events.length === 1 ? "" : "s"} shown.`
    : "No linked events match the current filter.";
  linkedEventsList.innerHTML = "";
  if (!events.length) {
    linkedEventsList.innerHTML = '<p class="hint">No linked events to display.</p>';
    return;
  }
  for (const event of events) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-row${event.id === state.selectedEventId ? " selected" : ""}`;
    button.innerHTML = `
      <div class="event-row-title">${event.label || event.id}</div>
      <div class="event-row-meta">${[event.id, event.confidence, event.provenance].filter(Boolean).join(" | ")}</div>
      <div class="event-row-links">${(event.linked_people || []).join(" | ")}</div>
      <div class="event-row-links">${(event.source_titles || []).join(" | ")}</div>
    `;
    button.addEventListener("click", async () => {
      state.selectedEventId = event.id;
      renderLinkedEventsList();
      await loadEventDetails(event.id);
    });
    linkedEventsList.appendChild(button);
  }
}

function renderEventDetails(payload) {
  const event = payload.event || {};
  eventInspectorHeading.textContent = event.event_type || event.id || "Event";
  const people = payload.people || [];
  const sources = payload.sources || [];
  const rawJson = JSON.stringify(payload.raw_json || event, null, 2);
  const personOptions = payload.person_options || [];
  const sourceOptions = (payload.source_options || []).filter((option) => !(event.source_ids || []).includes(option.id));
  eventInspectorContent.innerHTML = `
    <div class="detail-grid">
      <div><strong>ID</strong><span>${escapeHtml(event.id || "")}</span></div>
      <div><strong>Date</strong><span>${escapeHtml(event.date || "")}</span></div>
      <div><strong>Type</strong><span>${escapeHtml(event.event_type || "")}</span></div>
      <div><strong>Place</strong><span>${escapeHtml(event.place || "")}</span></div>
      <div><strong>Confidence</strong><span>${escapeHtml(event.confidence || "")}</span></div>
      <div><strong>Provenance</strong><span>${escapeHtml(event.provenance || "")}</span></div>
    </div>
    <section class="detail-section">
      <strong>Edit event</strong>
      <form id="eventEditForm">
        <div class="detail-form-grid">
          <label>
            <span>Type</span>
            <input name="event_type" type="text" value="${escapeHtml(event.event_type || "")}" />
          </label>
          <label>
            <span>Date</span>
            <input name="date" type="text" value="${escapeHtml(event.date || "")}" />
          </label>
          <label>
            <span>Place</span>
            <input name="place" type="text" value="${escapeHtml(event.place || "")}" />
          </label>
          <label>
            <span>Confidence</span>
            <select name="confidence">
              ${optionMarkup([
                { id: "", label: "" },
                { id: "open", label: "open" },
                { id: "possible", label: "possible" },
                { id: "probable", label: "probable" },
                { id: "confirmed", label: "confirmed" },
              ], event.confidence)}
            </select>
          </label>
          <label>
            <span>Provenance</span>
            <input name="provenance" type="text" value="${escapeHtml(event.provenance || "")}" />
          </label>
          <label>
            <span>Person</span>
            <select name="person_id">${optionMarkup(personOptions, event.person_id, false)}</select>
          </label>
          <label>
            <span>Groom</span>
            <select name="groom_id">${optionMarkup(personOptions, event.groom_id, false)}</select>
          </label>
          <label>
            <span>Bride</span>
            <select name="bride_id">${optionMarkup(personOptions, event.bride_id, false)}</select>
          </label>
          <label class="full">
            <span>Notes</span>
            <textarea name="notes">${escapeHtml(event.notes || "")}</textarea>
          </label>
        </div>
        <div class="inline-actions">
          <button type="submit">Save event</button>
          <span id="eventEditStatus" class="hint"></span>
        </div>
      </form>
    </section>
    <section class="detail-section">
      <strong>Linked people</strong>
      <div class="detail-list">
        ${
          people.length
            ? people.map((person) => `<div class="detail-item"><span>${escapeHtml(person.role)}: ${escapeHtml(person.label)}</span><span>${escapeHtml(person.id)}</span></div>`).join("")
            : '<p class="hint">No linked people recorded.</p>'
        }
      </div>
    </section>
    <section class="detail-section">
      <strong>Linked sources</strong>
      <div class="detail-list">
        ${
          sources.length
            ? sources.map((source) => `
              <div class="detail-item">
                <span>${escapeHtml(source.title || source.id)}</span>
                <span>${escapeHtml([source.id, source.type, source.date].filter(Boolean).join(" | "))}</span>
              </div>
            `).join("")
            : '<p class="hint">No linked sources recorded.</p>'
        }
      </div>
    </section>
    <section class="detail-section">
      <strong>Link existing source</strong>
      <form id="eventLinkSourceForm">
        <div class="detail-form-grid">
          <label class="full">
            <span>Source</span>
            <select name="source_id">${optionMarkup(sourceOptions, "", true, "Choose source")}</select>
          </label>
        </div>
        <div class="inline-actions">
          <button type="submit">Link source</button>
          <span id="eventLinkStatus" class="hint"></span>
        </div>
      </form>
    </section>
    <section class="detail-section">
      <strong>Create and link source</strong>
      <form id="eventSourceForm" enctype="multipart/form-data">
        <div class="detail-form-grid">
          <label>
            <span>Source title</span>
            <input name="title" type="text" />
          </label>
          <label>
            <span>Type</span>
            <input name="type" type="text" />
          </label>
          <label class="full">
            <span>Website link</span>
            <input name="archive_url" type="url" />
          </label>
          <label>
            <span>Date</span>
            <input name="date" type="text" />
          </label>
          <label>
            <span>Priority</span>
            <select name="priority">
              <option value="primary">primary</option>
              <option value="secondary">secondary</option>
            </select>
          </label>
          <label class="full">
            <span>Attach local image</span>
            <input name="image" type="file" accept="image/*" />
          </label>
        </div>
        <div class="inline-actions">
          <button type="submit">Create source</button>
          <span id="eventSourceStatus" class="hint"></span>
        </div>
      </form>
    </section>
    <section class="detail-section">
      <strong>Raw record</strong>
      <pre class="raw-record">${escapeHtml(rawJson)}</pre>
    </section>
  `;

  const eventEditForm = document.getElementById("eventEditForm");
  const eventLinkSourceForm = document.getElementById("eventLinkSourceForm");
  const eventSourceForm = document.getElementById("eventSourceForm");
  const eventEditStatus = document.getElementById("eventEditStatus");
  const eventLinkStatus = document.getElementById("eventLinkStatus");
  const eventSourceStatus = document.getElementById("eventSourceStatus");

  eventEditForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    eventEditStatus.textContent = "Saving...";
    const formData = new FormData(eventEditForm);
    const { response, payload: savePayload } = await fetchJson(`/api/event/${encodeURIComponent(event.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData.entries())),
    });
    if (!response.ok) {
      eventEditStatus.textContent = savePayload.error || "Save failed.";
      return;
    }
    eventEditStatus.textContent = "Saved.";
    await refreshAfterMutation({ eventId: event.id });
  });

  eventLinkSourceForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    eventLinkStatus.textContent = "Linking...";
    const formData = new FormData(eventLinkSourceForm);
    const sourceId = formData.get("source_id");
    const { response, payload: linkPayload } = await fetchJson(`/api/event/${encodeURIComponent(event.id)}/link-source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_id: sourceId }),
    });
    if (!response.ok) {
      eventLinkStatus.textContent = linkPayload.error || "Link failed.";
      return;
    }
    eventLinkStatus.textContent = "Source linked.";
    await refreshAfterMutation({ eventId: event.id });
  });

  eventSourceForm.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    eventSourceStatus.textContent = "Creating source...";
    const formData = new FormData(eventSourceForm);
    const { response, payload: sourcePayload } = await fetchJson(`/api/event/${encodeURIComponent(event.id)}/sources`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      eventSourceStatus.textContent = sourcePayload.error || "Create source failed.";
      return;
    }
    eventSourceStatus.textContent = "Source created.";
    await refreshAfterMutation({ eventId: event.id });
  });
}

async function loadEventDetails(eventId) {
  if (!eventId) {
    eventInspectorHeading.textContent = "Event";
    eventInspectorContent.innerHTML = '<p class="hint">Select a linked event to inspect it.</p>';
    return;
  }
  const { response, payload } = await fetchJson(`/api/event/${encodeURIComponent(eventId)}`);
  if (!response.ok) {
    eventInspectorHeading.textContent = "Event";
    eventInspectorContent.innerHTML = `<p class="hint">${payload.error || "Failed to load event details."}</p>`;
    return;
  }
  renderEventDetails(payload);
}

function fitGraphToState() {
  if (!state.cy) return;
  const pathElements = state.cy.elements('[path = "true"]');
  if (state.branchTargetId && pathElements.length) {
    state.cy.animate({ fit: { eles: pathElements, padding: 90 }, duration: 220 });
    return;
  }
  state.cy.fit(state.cy.elements(), 40);
}

function dagreLayoutOptions() {
  return {
    name: "dagre",
    rankDir: "TB",
    ranker: "network-simplex",
    nodeSep: 42,
    rankSep: 110,
    edgeSep: 22,
    fit: true,
    padding: 32,
    animate: false,
    spacingFactor: 1.05,
    nodeDimensionsIncludeLabels: false,
    sort: (left, right) => {
      const leftOrder = Number(left.data("layout_order") || 0);
      const rightOrder = Number(right.data("layout_order") || 0);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.id()).localeCompare(String(right.id()));
    },
    minLen: (edge) => (edge.data("kind") === "order" ? 0 : 1),
    edgeWeight: (edge) => {
      if (edge.data("kind") === "order") return 32;
      if (edge.data("path") === "true") return 10;
      return 5;
    },
  };
}

function buildCy(elements) {
  if (!state.cy) {
    cytoscape.use(cytoscapeDagre);
    state.cy = cytoscape({
      container: cyContainer,
      elements,
      wheelSensitivity: 0.18,
      minZoom: 0.1,
      maxZoom: 3,
      style: [
        {
          selector: 'node[kind = "person"]',
          style: {
            shape: "round-rectangle",
            width: 182,
            height: 80,
            "background-color": "#fffdf7",
            "border-width": 2,
            "border-color": "#ccb999",
            label: "data(display_label)",
            "text-wrap": "wrap",
            "text-max-width": 155,
            "text-valign": "center",
            "text-halign": "center",
            "font-size": 13,
            "font-weight": 700,
            color: "#3b2c18"
          }
        },
        { selector: 'node[kind = "person"][selected = "true"]', style: { "background-color": "#fff2cc", "border-color": "#b7791f", "border-width": 3 } },
        { selector: 'node[path = "true"]', style: { "border-color": "#c05621", "border-width": 4, "background-color": "#fff0df" } },
        { selector: 'node[kind = "family"]', style: { shape: "diamond", width: 18, height: 18, "background-color": "#c9b392", "border-width": 1, "border-color": "#987f5e", label: "data(label)", "font-size": 9, "text-valign": "bottom", "text-margin-y": 11, color: "#6b5a43" } },
        { selector: 'node[kind = "family"][path = "true"]', style: { "background-color": "#dd6b20", "border-color": "#9c4221", width: 22, height: 22 } },
        { selector: 'edge[kind = "order"]', style: { width: 0, opacity: 0, "events": "no" } },
        { selector: "edge", style: { width: 2, "line-color": "#a08f73", "curve-style": "taxi", "taxi-direction": "vertical", "taxi-turn": 28, "taxi-turn-min-distance": 14 } },
        { selector: 'edge[path = "true"]', style: { width: 4, "line-color": "#dd6b20" } }
      ],
      layout: dagreLayoutOptions()
    });
    state.cy.on("tap", 'node[kind = "person"]', async (event) => {
      const personId = event.target.data("person_id");
      if (!personId || personId === state.focusId) return;
      state.focusId = personId;
      if (!state.displayAll) {
        state.branchTargetId = "";
        branchOnlyToggle.checked = false;
        state.branchOnly = false;
      }
      await refreshGraph();
    });
    fitGraphToState();
  } else {
    state.cy.json({ elements });
    const layout = state.cy.layout(dagreLayoutOptions());
    layout.one("layoutstop", fitGraphToState);
    layout.run();
  }
}

async function refreshGraph() {
  const params = new URLSearchParams({
    focus_id: state.focusId,
    branch_target_id: state.branchTargetId,
    branch_only: String(state.branchOnly),
    display_all: String(state.displayAll),
  });
  const { payload } = await fetchJson(`/api/graph?${params.toString()}`);
  const elements = payload.elements.map((element) => {
    if (element.data.kind !== "person") return element;
    return { ...element, data: { ...element.data, display_label: [element.data.label, element.data.dates, element.data.meta].filter(Boolean).join("\n") } };
  });

  setOptions(branchSelect, payload.branch_options || [], state.branchTargetId, true);
  branchSelect.disabled = state.displayAll;
  branchOnlyToggle.disabled = state.displayAll || !state.branchTargetId;
  branchHint.textContent = state.displayAll
    ? "Display all shows the full connected structure."
    : (payload.branch_found ? "" : state.branchTargetId ? "Selected branch target is outside the current branch window." : "");

  buildCy(elements);
  renderDetails(payload.focus_person);
  focusSelect.value = state.focusId;
}

async function bootstrap(preserveFocus = false) {
  const { payload } = await fetchJson("/api/bootstrap");
  state.people = payload.people;
  state.reviewTotal = payload.review_total || 0;
  if (!preserveFocus || !state.people.some((person) => person.id === state.focusId)) {
    state.focusId = payload.default_focus_id;
  }
  const filtered = refreshFocusOptions();
  if (!filtered.some((person) => person.id === state.focusId) && filtered[0]) {
    state.focusId = filtered[0].id;
  }
  setOptions(focusSelect, filtered, state.focusId);
  state.linkedEvents = payload.linked_events || [];
  if (!state.linkedEvents.some((event) => event.id === state.selectedEventId)) {
    state.selectedEventId = payload.default_event_id || "";
  }
  renderLinkedEventsList();
  setViewMode();
  if (state.linkedEventsView) {
    await loadEventDetails(state.selectedEventId);
    return;
  }
  await refreshGraph();
}

searchInput.addEventListener("input", () => {
  if (state.linkedEventsView) {
    const filteredEvents = visibleLinkedEvents();
    if (!filteredEvents.some((event) => event.id === state.selectedEventId)) {
      state.selectedEventId = filteredEvents[0]?.id || "";
      loadEventDetails(state.selectedEventId);
    }
    renderLinkedEventsList();
    return;
  }
  const filtered = refreshFocusOptions();
  if (!filtered.some((person) => person.id === state.focusId) && filtered[0]) {
    state.focusId = filtered[0].id;
    refreshGraph();
  }
});

reviewOnlyToggle.addEventListener("change", async () => {
  if (state.linkedEventsView) return;
  state.reviewOnly = reviewOnlyToggle.checked;
  const filtered = refreshFocusOptions();
  if (!filtered.some((person) => person.id === state.focusId) && filtered[0]) {
    state.focusId = filtered[0].id;
  }
  await refreshGraph();
});

focusSelect.addEventListener("change", async () => {
  state.focusId = focusSelect.value;
  state.branchTargetId = "";
  branchOnlyToggle.checked = false;
  state.branchOnly = false;
  await refreshGraph();
});

displayAllToggle.addEventListener("change", async () => {
  if (state.linkedEventsView) return;
  state.displayAll = displayAllToggle.checked;
  state.branchTargetId = "";
  branchOnlyToggle.checked = false;
  state.branchOnly = false;
  await refreshGraph();
});

branchSelect.addEventListener("change", async () => {
  if (state.linkedEventsView) return;
  state.branchTargetId = branchSelect.value;
  state.branchOnly = Boolean(state.branchTargetId);
  branchOnlyToggle.checked = state.branchOnly;
  await refreshGraph();
});

branchOnlyToggle.addEventListener("change", async () => {
  if (state.linkedEventsView) return;
  state.branchOnly = branchOnlyToggle.checked;
  await refreshGraph();
});

linkedEventsViewToggle.addEventListener("change", async () => {
  state.linkedEventsView = linkedEventsViewToggle.checked;
  setViewMode();
  if (state.linkedEventsView) {
    renderLinkedEventsList();
    await loadEventDetails(state.selectedEventId);
    return;
  }
  await refreshGraph();
});

sourceForm.elements.event_id.addEventListener("change", updateSourceFormHint);

leftToggle.addEventListener("click", () => {
  toggleSidebar(leftSidebar, true);
  rightSidebar.classList.remove("collapsed");
  workspace.style.setProperty("--right-sidebar-width", `${state.rightSidebarWidth || SIDEBAR_LIMITS.right.default}px`);
  updateSidebarButtons();
  fitGraphToState();
});
rightToggle.addEventListener("click", () => toggleSidebar(rightSidebar, true));
leftExpand.addEventListener("click", () => toggleSidebar(leftSidebar, false));
rightExpand.addEventListener("click", () => toggleSidebar(rightSidebar, false));
leftResizer.addEventListener("pointerdown", () => beginResize("left"));
rightResizer.addEventListener("pointerdown", () => beginResize("right"));
window.addEventListener("resize", () => {
  syncWorkspaceWidths();
  fitGraphToState();
});

personForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveStatus.textContent = "Saving...";
  const formData = new FormData(personForm);
  const payload = Object.fromEntries(formData.entries());
  const { response, payload: savePayload } = await fetchJson(`/api/person/${encodeURIComponent(personForm.dataset.personId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    saveStatus.textContent = savePayload.error || "Save failed.";
    return;
  }
  saveStatus.textContent = "Saved.";
  await refreshAfterMutation();
});

sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sourceStatus.textContent = "Adding source...";
  const formData = new FormData(sourceForm);
  const { response, payload } = await fetchJson(`/api/person/${encodeURIComponent(sourceForm.dataset.personId)}/sources`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    sourceStatus.textContent = payload.error || "Add source failed.";
    return;
  }
  sourceStatus.textContent = "Source added.";
  sourceForm.reset();
  updateSourceFormHint();
  await refreshGraph();
});

promoteButton.addEventListener("click", async () => {
  const personId = personForm.dataset.personId;
  if (!personId) return;
  reviewStatus.textContent = "Saving review...";
  const { response, payload } = await fetchJson(`/api/person/${personId}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provenance: promoteProvenance.value,
      confidence: promoteConfidence.value,
      note: reviewNote.value,
    }),
  });
  if (!response.ok) {
    reviewStatus.textContent = payload.error || "Review update failed.";
    return;
  }
  reviewStatus.textContent = "Person marked as reviewed.";
  reviewNote.value = "";
  await refreshAfterMutation();
});

mergeButton.addEventListener("click", async () => {
  const personId = personForm.dataset.personId;
  const targetId = mergeTargetSelect.value;
  if (!personId || !targetId) return;
  reviewStatus.textContent = "Merging duplicate...";
  const { response, payload } = await fetchJson(`/api/person/${personId}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_id: targetId }),
  });
  if (!response.ok) {
    reviewStatus.textContent = payload.error || "Merge failed.";
    return;
  }
  reviewStatus.textContent = `Merged into ${payload.target_id}.`;
  state.focusId = payload.target_id;
  reviewNote.value = "";
  await bootstrap(true);
});

syncWorkspaceWidths();
updateSidebarButtons();
bootstrap();
