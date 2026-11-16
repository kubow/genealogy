const SIDEBAR_LIMITS = {
  left: { min: 220, max: 620, default: 320 },
  right: { min: 280, max: 720, default: 380 },
};
const requestedMode = new URLSearchParams(window.location.search).get("mode");
const initialMode = ["explore", "review", "sources"].includes(requestedMode) ? requestedMode : "explore";

const LAYOUT_STORAGE_KEY = "genealogy.layout.v1";
const LAYOUT_DEFAULTS = {
  tree: { engine: "dagre", rankDir: "TB", rankSep: 110, nodeSep: 60, coupleGap: 46, ranker: "network-simplex", edgeStyle: "taxi", repulsion: 12000, edgeLength: 120, gravity: 0.25 },
  star: { generations: 5, spread: 360, ringGap: 220, cardSize: "normal" },
  fan: { generations: 5, sweep: 360, ringWidth: 95, colorBy: "line", showDates: true, showEmpty: true },
};

function loadLayoutSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) || "{}") || {}; } catch { saved = {}; }
  return Object.fromEntries(Object.entries(LAYOUT_DEFAULTS).map(([key, value]) => [key, { ...value, ...(saved[key] || {}) }]));
}

const state = {
  people: [],
  dataFile: new URLSearchParams(window.location.search).get("data") || "genealogy.json",
  linkedEvents: [],
  focusId: "",
  selectedPersonId: "",
  coupleEventId: "",
  couplePersonIds: [],
  currentPersonPayload: null,
  selectedEventId: "",
  branchTargetId: "",
  traceTargetId: "",
  viewMode: "tree",
  viewPartnerId: "",
  branchOnly: false,
  displayAll: false,
  reviewOnly: initialMode === "review",
  linkedEventsView: initialMode === "sources",
  mode: initialMode,
  editPanelOpen: false,
  personFormDirty: false,
  reviewTotal: 0,
  leftSidebarWidth: SIDEBAR_LIMITS.left.default,
  rightSidebarWidth: SIDEBAR_LIMITS.right.default,
  cy: null,
  graphElements: [],
  layout: loadLayoutSettings(),
  fanView: null,
  fanRadius: 0,
};

const searchInput = document.getElementById("searchInput");
const dataFileSelect = document.getElementById("dataFileSelect");
const linkedEventsViewToggle = document.getElementById("linkedEventsViewToggle");
const focusSelect = document.getElementById("focusSelect");
const branchSelect = document.getElementById("branchSelect");
const traceSelect = document.getElementById("traceSelect");
const viewModeSelect = document.getElementById("viewModeSelect");
const viewButtons = [...document.querySelectorAll(".view-btn")];
const fanChart = document.getElementById("fanChart");
const layoutSettings = document.getElementById("layoutSettings");
const layoutSettingsBtn = document.getElementById("layoutSettingsBtn");
const branchOnlyToggle = document.getElementById("branchOnlyToggle");
const displayAllToggle = document.getElementById("displayAllToggle");
const reviewOnlyToggle = document.getElementById("reviewOnlyToggle");
const branchHint = document.getElementById("branchHint");
const reviewQueueHint = document.getElementById("reviewQueueHint");
const treeTitle = document.getElementById("treeTitle");
const rightSidebarTitle = document.getElementById("rightSidebarTitle");
const cyContainer = document.getElementById("cy");
const personForm = document.getElementById("personForm");
const personFacts = document.getElementById("personFacts");
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
const personCard = document.getElementById("personCard");
const couplePanel = document.getElementById("couplePanel");
const fullTreeBtn = document.getElementById("fullTreeBtn");
const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const helpCloseBtn = document.getElementById("helpCloseBtn");
const closeEditBtn = document.getElementById("closeEditBtn");
const editPanelHead = document.querySelector(".edit-panel-head");
const editLinkedRecords = document.querySelector(".edit-linked-records");
const eventInspectorPanel = document.getElementById("eventInspectorPanel");
const eventInspectorHeading = document.getElementById("eventInspectorHeading");
const eventInspectorContent = document.getElementById("eventInspectorContent");
const personViewOnlySections = Array.from(document.querySelectorAll(".person-view-only"));
const exploreModeBtn = document.getElementById("exploreModeBtn");
const reviewModeBtn = document.getElementById("reviewModeBtn");
const sourcesModeBtn = document.getElementById("sourcesModeBtn");
const reviewModeCount = document.getElementById("reviewModeCount");
const reviewQueuePanel = document.getElementById("reviewQueuePanel");
const reviewPeopleList = document.getElementById("reviewPeopleList");
const reviewPeopleCount = document.getElementById("reviewPeopleCount");
const focusContextName = document.getElementById("focusContextName");
const graphControls = document.getElementById("graphControls");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const fitGraphBtn = document.getElementById("fitGraphBtn");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const navigatorHelpTitle = document.getElementById("navigatorHelpTitle");

function isMobileLayout() {
  return window.innerWidth <= 980;
}

function canDiscardPersonEdits() {
  if (!state.personFormDirty) return true;
  return window.confirm("Discard your unsaved changes to this person?");
}

function setPersonFormClean() {
  state.personFormDirty = false;
  personForm.classList.remove("has-unsaved-changes");
}

function mediaUrl(path, available = true) {
  if (!path || !available) return "";
  return `/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchJson(url, options) {
  const requestUrl = new URL(url, window.location.origin);
  if (requestUrl.pathname.startsWith("/api/")) requestUrl.searchParams.set("data", state.dataFile);
  const response = await fetch(`${requestUrl.pathname}${requestUrl.search}`, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function refreshAfterMutation({ preserveFocus = true, eventId = state.selectedEventId } = {}) {
  const editWasOpen = state.editPanelOpen;
  const prevSelectedId = state.selectedPersonId;
  await bootstrap(preserveFocus);
  if (state.linkedEventsView) {
    await loadEventDetails(eventId);
    return;
  }
  // After mutation, restore the person card that was being viewed/edited
  if (prevSelectedId && prevSelectedId !== state.focusId) {
    await loadPersonCard(prevSelectedId);
  }
  if (editWasOpen) showPersonPanel(true);
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
  reviewQueueHint.textContent = state.mode === "review"
    ? (state.reviewTotal ? `${state.reviewTotal} people still need review.` : "The review queue is clear.")
    : "Select a person to inspect them. Re-centering the tree is always a separate action.";
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
  const drawerOpen = isMobileLayout()
    && (!leftSidebar.classList.contains("collapsed") || !rightSidebar.classList.contains("collapsed"));
  drawerBackdrop.classList.toggle("hidden", !drawerOpen);
}

function toggleSidebar(sidebar, collapsed) {
  if (!collapsed && isMobileLayout()) {
    const otherSidebar = sidebar === leftSidebar ? rightSidebar : leftSidebar;
    otherSidebar.classList.add("collapsed");
  }
  sidebar.classList.toggle("collapsed", collapsed);
  if (sidebar === leftSidebar) {
    workspace.style.setProperty("--left-sidebar-width", collapsed ? "0px" : `${state.leftSidebarWidth || SIDEBAR_LIMITS.left.default}px`);
    if (collapsed) workspace.style.setProperty("--left-resizer-width", "0px");
    else workspace.style.removeProperty("--left-resizer-width");
  }
  if (sidebar === rightSidebar) {
    workspace.style.setProperty("--right-sidebar-width", collapsed ? "0px" : `${state.rightSidebarWidth || SIDEBAR_LIMITS.right.default}px`);
    if (collapsed) workspace.style.setProperty("--right-resizer-width", "0px");
    else workspace.style.removeProperty("--right-resizer-width");
  }
  updateSidebarButtons();
  fitGraphToState();
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
    workspace.style.removeProperty("--left-resizer-width");
    workspace.style.removeProperty("--right-resizer-width");
    return;
  }
  const leftCollapsed = leftSidebar.classList.contains("collapsed");
  const rightCollapsed = rightSidebar.classList.contains("collapsed");
  workspace.style.setProperty("--left-sidebar-width", leftCollapsed ? "0px" : `${state.leftSidebarWidth}px`);
  workspace.style.setProperty("--right-sidebar-width", rightCollapsed ? "0px" : `${state.rightSidebarWidth}px`);
  if (leftCollapsed) workspace.style.setProperty("--left-resizer-width", "0px");
  else workspace.style.removeProperty("--left-resizer-width");
  if (rightCollapsed) workspace.style.setProperty("--right-resizer-width", "0px");
  else workspace.style.removeProperty("--right-resizer-width");
}

function updateSourceFormHint() {
  const createMode = (sourceForm.elements.event_id.value || "").startsWith("__new_");
  sourceForm.querySelectorAll(".new-event-field").forEach((field) => field.classList.toggle("hidden", !createMode));
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

function markSelected(personId) {
  highlightFanSelection(personId);
  if (!state.cy) return;
  state.cy.elements().removeClass("cy-selected");
  if (personId) {
    const node = state.cy.getElementById(`person:${personId}`);
    if (node.length) node.addClass("cy-selected");
  }
}

function applyCoupleHighlight() {
  if (!state.cy) return;
  for (const personId of state.couplePersonIds) {
    const node = state.cy.getElementById(`person:${personId}`);
    if (node.length) node.addClass("cy-couple");
  }
  if (state.coupleEventId) {
    state.cy.nodes('[kind = "family"]').forEach((node) => {
      if (node.data("event_id") === state.coupleEventId) node.addClass("cy-couple-family");
    });
  }
}

function clearCoupleHighlight() {
  if (!state.cy) return;
  state.cy.elements().removeClass("cy-couple cy-couple-family");
  state.couplePersonIds = [];
  state.coupleEventId = "";
}

function showPersonPanel(showEdit = false) {
  personCard.classList.remove("hidden");
  couplePanel.classList.add("hidden");
  const reviewMode = state.mode === "review";
  personAdminPanel.classList.remove("hidden");
  state.editPanelOpen = reviewMode ? false : showEdit;
  personCard.classList.toggle("editing", showEdit && !reviewMode);
  personForm.classList.toggle("readonly-person-form", !showEdit && !reviewMode);
  personForm.querySelectorAll("input:not([readonly]), select, textarea").forEach((field) => {
    field.disabled = !showEdit && !reviewMode;
  });
  personForm.querySelector(".person-save-actions").classList.toggle("hidden", !showEdit && !reviewMode);
  sourceForm.classList.toggle("hidden", !showEdit && !reviewMode);
  editLinkedRecords?.classList.toggle("hidden", !showEdit && !reviewMode);
  editPanelHead?.classList.toggle("hidden", !showEdit || reviewMode);
  const editBtn = personCard.querySelector(".edit-toggle-btn");
  if (editBtn) editBtn.classList.toggle("active", showEdit);
}

function showCouplePanel() {
  couplePanel.classList.remove("hidden");
  personCard.classList.add("hidden");
  personAdminPanel.classList.add("hidden");
}

async function loadPersonCard(personId) {
  const { response, payload } = await fetchJson(`/api/person/${encodeURIComponent(personId)}`);
  if (!response.ok) return;
  renderPersonCard(payload);
  renderDetails(payload);
  showPersonPanel(false);
}

function renderPersonCard(payload) {
  if (!personCard) return;
  state.currentPersonPayload = payload;
  const person = payload.person || {};
  const relations = payload.relations || {};
  const conf = person.confidence || "";
  const confBadge = conf ? `<span class="conf-badge conf-${escapeHtml(conf)}">${escapeHtml(conf)}</span>` : "";
  const birth = [person.birth_date, person.birth_place].filter(Boolean).join(" · ");
  const death = [person.death_date, person.death_place].filter(Boolean).join(" · ");
  const birthSurname = person.birth_surname || "";
  const marriedSurname = person.married_surname || "";
  const surnameLine = marriedSurname
    ? `${marriedSurname}${birthSurname && birthSurname.toLowerCase() !== marriedSurname.toLowerCase() ? ` (${birthSurname})` : ""}`
    : birthSurname;
  const nameLine = [person.name, surnameLine].filter(Boolean).join(" ");

  const editing = state.editPanelOpen && state.mode !== "review";
  const parentOptions = payload.parent_options || [];
  const parentSelect = (relation, selectedId, existing, label) => editing
    ? `<select class="relation-select" data-relation="${relation}">${optionMarkup(parentOptions, selectedId || "")}</select>`
    : existing;
  const fatherChip = relations.father
    ? `<button type="button" class="rel-chip" data-person-id="${escapeHtml(relations.father.id)}">${escapeHtml(relations.father.label)}</button>`
    : `<span class="rel-chip rel-unknown">Unknown</span>`;
  const motherChip = relations.mother
    ? `<button type="button" class="rel-chip" data-person-id="${escapeHtml(relations.mother.id)}">${escapeHtml(relations.mother.label)}</button>`
    : `<span class="rel-chip rel-unknown">Unknown</span>`;

  const partnerChips = (relations.partners || []).map((p) => {
    const label = p.marriage_date ? `${p.label} · ${p.marriage_date.slice(0, 4)}` : p.label;
    const coupleAttr = p.marriage_event_id ? ` data-couple-event-id="${escapeHtml(p.marriage_event_id)}"` : "";
    return `<button type="button" class="rel-chip rel-spouse"${coupleAttr} data-person-id="${escapeHtml(p.id)}">${escapeHtml(label)}</button>`;
  });

  const childItems = (relations.children || []).map((c) =>
    `<button type="button" class="rel-chip" data-person-id="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>` +
    `<button type="button" class="branch-btn" data-branch-id="${escapeHtml(c.id)}" title="Trace branch to ${escapeHtml(c.label)}">branch</button>`
  );
  const linkedRecords = (payload.events || []).map((event) => {
    const mappedTo = [event.type || event.id, event.date, event.place].filter(Boolean).join(" · ");
    const sourceRows = (event.sources || []).map((source) => {
      const archive = source.archive_url ? `<a href="${escapeHtml(source.archive_url)}" target="_blank" rel="noreferrer">Archive</a>` : "<span>no archive link</span>";
      const localUrl = mediaUrl(source.local_image, source.local_image_available);
      return `<li><span>${escapeHtml(source.title || source.id || "Source")}</span>${archive}${localUrl ? `<a href="${localUrl}" target="_blank" rel="noreferrer">Local file</a>` : ""}</li>`;
    }).join("");
    return `<details class="linked-record"><summary><span>${escapeHtml(mappedTo || event.id || "Event")}</span><small>${(event.sources || []).length} linked record${(event.sources || []).length === 1 ? "" : "s"}</small></summary><div class="linked-record-body">${event.notes ? `<p class="event-note">${escapeHtml(event.notes)}</p>` : ""}<ul>${sourceRows || "<li><span>No linked records.</span></li>"}</ul></div></details>`;
  }).join("");

  personCard.innerHTML = `
    <div class="person-card-head">
      <div class="identity-summary">
        <h3 class="person-card-name">${escapeHtml(nameLine || person.id || "")}</h3>
        ${confBadge}
      </div>
      <button type="button" class="icon-btn edit-toggle-btn" title="Edit" data-edit-person-id="${escapeHtml(person.id || "")}">&#9998;</button>
    </div>
    ${(birth || death) ? `<div class="person-card-vitals identity-summary">${birth ? `<span><b>Born</b> ${escapeHtml(birth)}</span>` : ""}${death ? `<span><b>Died</b> ${escapeHtml(death)}</span>` : ""}</div>` : ""}
    <div id="personRecordMount"></div>
    <section class="rel-section">
      <h4>Family links</h4>
      <div class="rel-row"><span class="rel-label">Father</span>${parentSelect("father", person.father, fatherChip, "Father")}</div>
      <div class="rel-row"><span class="rel-label">Mother</span>${parentSelect("mother", person.mother, motherChip, "Mother")}</div>
      ${partnerChips.length ? `<div class="rel-row"><span class="rel-label">Spouse</span><span class="rel-chips">${partnerChips.join("")}</span></div>` : ""}
      ${childItems.length ? `<div class="rel-row rel-children"><span class="rel-label">Children</span><span class="rel-chips">${childItems.join("")}</span></div>` : ""}
    </section>
    ${person.id ? `<div class="person-card-actions"><button type="button" class="focus-person-btn" data-focus-id="${escapeHtml(person.id)}">Focus tree here</button></div>` : ""}
    <section class="person-evidence">
      <h4>Linked records</h4>
      ${linkedRecords || '<p class="hint">No linked records.</p>'}
    </section>
  `;
  // Keep one person-record component: the established form and its save
  // wiring are mounted directly inside the selected person's top card.
  personCard.querySelector("#personRecordMount")?.appendChild(personForm);

  personCard.querySelectorAll(".relation-select").forEach((select) => {
    select.addEventListener("change", () => {
      personForm.elements[select.dataset.relation].value = select.value;
      state.personFormDirty = true;
      personForm.classList.add("has-unsaved-changes");
      saveStatus.textContent = "Unsaved changes";
    });
  });

  personCard.querySelectorAll(".rel-chip[data-person-id]").forEach((chip) => {
    chip.addEventListener("click", async () => {
      if (!canDiscardPersonEdits()) return;
      const coupleEventId = chip.dataset.coupleEventId;
      const pid = chip.dataset.personId;
      if (coupleEventId) {
        state.coupleEventId = coupleEventId;
        const { payload: cp } = await fetchJson(`/api/couple/${encodeURIComponent(coupleEventId)}`);
        state.couplePersonIds = [cp.groom?.person?.id, cp.bride?.person?.id].filter(Boolean);
        applyCoupleHighlight();
        renderMarriageCard(cp);
        showCouplePanel();
        return;
      }
      if (!pid) return;
      state.selectedPersonId = pid;
      markSelected(pid);
      clearCoupleHighlight();
      await loadPersonCard(pid);
      if (isMobileLayout()) toggleSidebar(rightSidebar, false);
    });
  });

  personCard.querySelectorAll(".branch-btn[data-branch-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!canDiscardPersonEdits()) return;
      state.branchTargetId = btn.dataset.branchId;
      state.traceTargetId = "";
      state.branchOnly = false;
      branchOnlyToggle.checked = false;
      if (branchSelect) branchSelect.value = btn.dataset.branchId;
      await refreshGraph();
    });
  });

  const focusBtn = personCard.querySelector(".focus-person-btn");
  if (focusBtn) {
    focusBtn.addEventListener("click", async () => {
      if (!canDiscardPersonEdits()) return;
      const fid = focusBtn.dataset.focusId;
      if (!fid || fid === state.focusId) return;
      state.focusId = fid;
      if (!state.displayAll) {
        state.branchTargetId = "";
        state.traceTargetId = "";
        branchOnlyToggle.checked = false;
        state.branchOnly = false;
      }
      await refreshGraph();
    });
  }

  const editBtn = personCard.querySelector(".edit-toggle-btn");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      // The record panel stays visible in both modes; only its field state
      // changes. Using panel visibility here prevented the pencil from ever
      // enabling editing.
      state.editPanelOpen = !state.editPanelOpen;
      renderPersonCard(state.currentPersonPayload);
      showPersonPanel(state.editPanelOpen);
    });
  }

  rightSidebarTitle.textContent = nameLine || person.id || "Person";
  if (state.mode === "review") focusContextName.textContent = nameLine || person.id || "Review queue";
}

function renderMarriageCard(payload) {
  if (!couplePanel) return;
  const event = payload.event || {};
  const groom = (payload.groom || {}).person || {};
  const bride = (payload.bride || {}).person || {};

  const spouseCard = (personData) => {
    if (!personData.id) return `<div class="couple-person-card couple-person-empty"><p class="hint">Unknown</p></div>`;
    const nameLine = [personData.name, personData.birth_surname || personData.married_surname].filter(Boolean).join(" ");
    const birth = [personData.birth_date ? personData.birth_date.slice(0, 4) : "", personData.birth_place].filter(Boolean).join(" · ");
    const death = [personData.death_date ? personData.death_date.slice(0, 4) : "", personData.death_place].filter(Boolean).join(" · ");
    return `
      <div class="couple-person-card">
        <h4>${escapeHtml(nameLine || personData.id)}</h4>
        ${birth ? `<p class="couple-person-dates">b. ${escapeHtml(birth)}</p>` : ""}
        ${death ? `<p class="couple-person-dates">d. ${escapeHtml(death)}</p>` : ""}
        <button type="button" class="focus-person-btn" data-focus-id="${escapeHtml(personData.id)}">Focus</button>
      </div>`;
  };

  const importNotes = [];
  const sourceItems = [];
  for (const source of payload.sources || []) {
    const note = sourceNote(source);
    if (note) {
      importNotes.push(note);
      continue;
    }
    const imageUrl = mediaUrl(source.local_image, source.local_image_available);
    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(source.local_image || "");
    sourceItems.push(`
      <div class="linked-source-card">
        <div class="source-meta">${escapeHtml([source.id, source.type, source.date, source.priority].filter(Boolean).join(" | "))}</div>
        <h4>${escapeHtml(source.title || source.id)}</h4>
        <div class="source-actions">
          ${source.archive_url ? `<a class="link-chip" href="${escapeHtml(source.archive_url)}" target="_blank" rel="noreferrer">Open website</a>` : ""}
          ${imageUrl ? `<a class="link-chip" href="${imageUrl}" target="_blank" rel="noreferrer">${isImage ? "Open image" : "Open local file"}</a>` : ""}
        </div>
      </div>`);
  }

  const datePlace = [event.date, event.place].filter(Boolean).join(" · ");
  couplePanel.innerHTML = `
    <div class="couple-panel-head">
      <h3>Marriage${datePlace ? " · " + escapeHtml(datePlace) : ""}</h3>
      <button type="button" class="icon-btn close-couple-btn" title="Close">&times;</button>
    </div>
    ${event.confidence ? `<p class="hint">${escapeHtml(event.confidence)}${event.provenance ? " · " + escapeHtml(event.provenance) : ""}</p>` : ""}
    <div class="couple-persons">
      ${spouseCard(groom)}
      <span class="couple-divider">&loz;</span>
      ${spouseCard(bride)}
    </div>
    ${event.notes ? `<p class="event-note">${escapeHtml(event.notes)}</p>` : ""}
    ${importNotes.length ? `<p class="event-note">${escapeHtml(importNotes.join(" | "))}</p>` : ""}
    ${sourceItems.length ? `<div class="linked-source-list">${sourceItems.join("")}</div>` : '<p class="hint">No source links attached to this marriage.</p>'}
  `;

  couplePanel.querySelectorAll(".focus-person-btn[data-focus-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const fid = btn.dataset.focusId;
      if (!fid) return;
      state.focusId = fid;
      state.selectedPersonId = fid;
      clearCoupleHighlight();
      if (!state.displayAll) {
        state.branchTargetId = "";
        state.traceTargetId = "";
        branchOnlyToggle.checked = false;
        state.branchOnly = false;
      }
      showPersonPanel(false);
      await refreshGraph();
    });
  });

  const closeBtn = couplePanel.querySelector(".close-couple-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      clearCoupleHighlight();
      showPersonPanel(false);
      const cardName = personCard.querySelector(".person-card-name");
      rightSidebarTitle.textContent = cardName ? cardName.textContent : "Family tree";
    });
  }

  rightSidebarTitle.textContent = "Marriage";
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
      const imageUrl = mediaUrl(source.local_image, source.local_image_available);
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
          <form class="source-edit-form" data-source-id="${escapeHtml(source.id || "")}">
            <div class="detail-form-grid">
              <label>
                <span>Source ID</span>
                <input type="text" value="${escapeHtml(source.id || "")}" readonly />
              </label>
              <label>
                <span>Title</span>
                <input name="title" type="text" value="${escapeHtml(source.title || "")}" />
              </label>
              <label>
                <span>Type</span>
                <input name="type" type="text" value="${escapeHtml(source.type || "")}" />
              </label>
              <label>
                <span>Date</span>
                <input name="date" type="text" value="${escapeHtml(source.date || "")}" />
              </label>
              <label class="full">
                <span>Website link</span>
                <input name="archive_url" type="url" value="${escapeHtml(source.archive_url || "")}" />
              </label>
              <label>
                <span>Priority</span>
                <select name="priority">
                  ${optionMarkup([
                    { id: "primary", label: "primary" },
                    { id: "secondary", label: "secondary" },
                  ], source.priority || "primary")}
                </select>
              </label>
            </div>
            <div class="inline-actions">
              <button type="submit">Save source</button>
              <span class="hint source-edit-status"></span>
            </div>
          </form>
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

function factYear(fact) {
  const date = String(fact.date || "");
  const match = date.match(/\d{4}/);
  return { year: match ? Number(match[0]) : 9999, before: date.startsWith("before") ? -1 : 0, date };
}

function renderFactMedallion(facts, factSources) {
  if (!facts.length) return "";
  const sorted = [...facts].sort((a, b) => {
    const ka = factYear(a);
    const kb = factYear(b);
    return ka.year - kb.year || ka.before - kb.before || ka.date.localeCompare(kb.date);
  });
  const groups = [];
  for (const fact of sorted) {
    const date = fact.date || "undated";
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.facts.push(fact);
    else groups.push({ date, facts: [fact] });
  }
  const rows = groups.map((group) => {
    const lines = group.facts
      .map((fact) => `<p class="medallion-text">${escapeHtml(fact.value || "")}${fact.place ? ` <span class="medallion-place">· ${escapeHtml(fact.place)}</span>` : ""}</p>`)
      .join("");
    const seen = new Set();
    const evidence = group.facts
      .filter((fact) => {
        const key = fact.source_id || fact.evidence || "";
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((fact) => {
        const source = factSources[fact.source_id] || {};
        const text = escapeHtml(fact.evidence || source.title || fact.source_id || "");
        const body = source.archive_url ? `<a href="${escapeHtml(source.archive_url)}" target="_blank" rel="noopener">${text}</a>` : text;
        return `<p class="medallion-evidence"><span>${escapeHtml(fact.source_id || "")}</span> ${body}</p>`;
      })
      .join("");
    return `<li class="medallion-row">
      <span class="medallion-date">${escapeHtml(group.date)}</span>
      <div class="medallion-body">${lines}${evidence}</div>
    </li>`;
  });
  return `<h4>Life in records</h4><ol class="medallion">${rows.join("")}</ol>`;
}

function renderDetails(payload) {
  const person = payload.person || {};
  personForm.dataset.personId = person.id || "";
  sourceForm.dataset.personId = person.id || "";
  personIdField.value = person.id || "";
  sourcePersonIdField.value = person.id || "";
  for (const name of ["name", "sex", "confidence", "birth_date", "birth_place", "birth_surname", "married_surname", "death_date", "death_place", "provenance", "notes"]) {
    personForm.elements[name].value = person[name] || "";
  }
  fillParentSelect("father", payload.parent_options || [], person.father);
  fillParentSelect("mother", payload.parent_options || [], person.mother);
  personFacts.innerHTML = renderFactMedallion(person.facts || [], payload.fact_sources || {});
  fillSourceEventOptions(payload.event_options || []);
  updateSourceFormHint();
  renderSources(payload.events || []);
  renderReview(payload.review || {}, person);
  setPersonFormClean();
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
  const linkedMode = state.mode === "sources";
  const reviewMode = state.mode === "review";
  state.linkedEventsView = linkedMode;
  state.reviewOnly = reviewMode;
  workspace.dataset.mode = state.mode;
  linkedEventsViewToggle.checked = linkedMode;
  reviewOnlyToggle.checked = reviewMode;
  linkedEventsPanel.classList.toggle("hidden", !linkedMode);
  reviewQueuePanel.classList.toggle("hidden", !reviewMode);
  syncCanvasSurface();
  graphControls.classList.toggle("hidden", linkedMode || reviewMode);
  if (personCard) personCard.classList.toggle("hidden", linkedMode);
  if (couplePanel) couplePanel.classList.add("hidden");
  if (linkedMode) {
    personAdminPanel.classList.add("hidden");
    state.editPanelOpen = false;
  } else if (reviewMode) {
    personAdminPanel.classList.remove("hidden");
    state.editPanelOpen = false;
  } else {
    personAdminPanel.classList.remove("hidden");
  }
  eventInspectorPanel.classList.toggle("hidden", !linkedMode);
  for (const section of personViewOnlySections) {
    section.classList.toggle("hidden", linkedMode || reviewMode);
  }
  if (linkedMode) {
    reviewPanel.classList.add("hidden");
  }
  exploreModeBtn.classList.toggle("active", state.mode === "explore");
  reviewModeBtn.classList.toggle("active", reviewMode);
  sourcesModeBtn.classList.toggle("active", linkedMode);
  for (const [button, active] of [
    [exploreModeBtn, state.mode === "explore"],
    [reviewModeBtn, reviewMode],
    [sourcesModeBtn, linkedMode],
  ]) button.setAttribute("aria-pressed", String(active));
  rightSidebarTitle.textContent = linkedMode ? "Event details" : reviewMode ? "Review details" : "Person details";
  treeTitle.textContent = linkedMode ? "Sources and events" : reviewMode ? "Review queue" : "Tree centred on";
  if (linkedMode) focusContextName.textContent = `${state.linkedEvents.length} linked events`;
  if (reviewMode) focusContextName.textContent = `${state.reviewTotal} people awaiting review`;
  navigatorHelpTitle.textContent = linkedMode ? "Review evidence" : reviewMode ? "Resolve uncertain people" : "Explore the family";
  reviewQueueHint.textContent = reviewMode
    ? (state.reviewTotal ? `${state.reviewTotal} people still need review.` : "The review queue is clear.")
    : linkedMode
      ? "Search events by person, place, date, source, or ID."
      : "Select a person to inspect them. Re-centering the tree is always a separate action.";
}

function renderReviewPeopleList() {
  const people = visiblePeople();
  reviewPeopleCount.textContent = people.length
    ? `${people.length} ${people.length === 1 ? "person" : "people"} awaiting review.`
    : "No people match the current search.";
  reviewPeopleList.innerHTML = "";
  for (const person of people) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `event-row${person.id === state.selectedPersonId ? " selected" : ""}`;
    button.innerHTML = `
      <div class="event-row-title">${escapeHtml(person.label)}</div>
      <div class="event-row-meta">${escapeHtml([person.id, person.confidence, person.provenance].filter(Boolean).join(" · "))}</div>
    `;
    button.addEventListener("click", async () => {
      if (!canDiscardPersonEdits()) return;
      state.selectedPersonId = person.id;
      renderReviewPeopleList();
      await loadPersonCard(person.id);
      if (isMobileLayout()) toggleSidebar(rightSidebar, false);
    });
    reviewPeopleList.appendChild(button);
  }
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
  if (state.mode === "sources") focusContextName.textContent = event.label || event.event_type || event.id || "Event details";
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

// ---------------------------------------------------------------------------
// Graph views: tree (couple blocks + dagre or force), couple star, fan chart
// ---------------------------------------------------------------------------

const CARD = { w: 182, h: 80 };
const STAR_CARD = { normal: { w: 160, h: 66, fs: 12 }, compact: { w: 124, h: 52, fs: 10 } };
const FAN_LINE_COLORS = ["#d9a25b", "#c97b6a", "#5f9c95", "#6f8fb8"];
const FAN_CONFIDENCE_COLORS = { confirmed: "#8db97a", probable: "#e2bb5e", possible: "#d6c7ae" };

function fitGraphToState() {
  if (state.viewMode === "two-way-fan") {
    fanFit();
    return;
  }
  if (!state.cy) return;
  state.cy.resize();
  const pathElements = state.cy.elements('[path = "true"]');
  if (state.viewMode === "tree" && (state.branchTargetId || state.traceTargetId) && pathElements.length) {
    state.cy.animate({ fit: { eles: pathElements, padding: 90 }, duration: 220 });
    return;
  }
  state.cy.fit(state.cy.elements(), 40);
}

function syncCanvasSurface() {
  const explore = state.mode === "explore";
  const fan = explore && state.viewMode === "two-way-fan";
  fanChart.classList.toggle("hidden", !fan);
  cyContainer.classList.toggle("hidden", !explore || fan);
  for (const button of viewButtons) {
    const active = button.dataset.view === state.viewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  fullTreeBtn.disabled = state.viewMode !== "tree";
  fullTreeBtn.title = state.viewMode === "tree" ? "Toggle the full connected tree" : "Overview is available in the tree view";
  if (!explore) closeLayoutSettings();
}

function classifyEdges(elements) {
  return elements.map((element) => {
    const data = element.data;
    if (!("source" in data) || data.kind === "order") return element;
    if (String(data.target).startsWith("family:")) return { ...element, data: { ...data, kind: "spouse" } };
    if (String(data.source).startsWith("family:")) return { ...element, data: { ...data, kind: "child" } };
    return element;
  });
}

// --- cytoscape instance -----------------------------------------------------

function ensureCy() {
  if (state.cy) return;
  state.cy = cytoscape({
    container: cyContainer,
    elements: [],
    minZoom: 0.05,
    maxZoom: 3,
    wheelSensitivity: 0.25,
    style: [
      {
        selector: 'node[kind = "person"]',
        style: {
          shape: "round-rectangle",
          width: CARD.w,
          height: CARD.h,
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
      { selector: 'node[kind = "person"][w]', style: { width: "data(w)", height: "data(h)", "font-size": "data(fs)", "text-max-width": "data(tw)" } },
      { selector: 'node[kind = "person"][line_color]', style: { "border-color": "data(line_color)", "border-width": 3 } },
      { selector: 'node[kind = "person"][selected = "true"]', style: { "background-color": "#fff2cc", "border-color": "#b7791f", "border-width": 3 } },
      { selector: 'node[path = "true"]', style: { "border-color": "#c05621", "border-width": 4, "background-color": "#fff0df" } },
      { selector: 'node[kind = "family"]', style: { shape: "diamond", width: 22, height: 22, "background-color": "#c9b392", "border-width": 1, "border-color": "#987f5e", label: "data(label)", "font-size": 8, "text-valign": "bottom", "text-margin-y": 8, color: "#6b5a43", "text-background-color": "#fbf6ec", "text-background-opacity": 0.92, "text-background-padding": 2, "text-background-shape": "roundrectangle" } },
      { selector: 'node[kind = "family"][path = "true"]', style: { "background-color": "#dd6b20", "border-color": "#9c4221", width: 28, height: 28 } },
      { selector: "edge", style: { width: 2, "line-color": "#a08f73", "curve-style": "taxi", "taxi-direction": "vertical", "taxi-turn": 28, "taxi-turn-min-distance": 14 } },
      { selector: 'edge[kind = "spouse"]', style: { "curve-style": "straight", width: 2.5, "line-color": "#b89a6e" } },
      { selector: 'edge[kind = "star"]', style: { "curve-style": "straight", width: 1.6, "line-color": "#b8a585" } },
      { selector: 'edge[kind = "order"]', style: { width: 0, opacity: 0, events: "no" } },
      { selector: 'edge[path = "true"]', style: { width: 4, "line-color": "#dd6b20" } },
      { selector: 'node[kind = "person"].cy-selected', style: { "background-color": "#fff2cc", "border-color": "#b7791f", "border-width": 3 } },
      { selector: 'node[kind = "person"].cy-couple', style: { "background-color": "#dbeeff", "border-color": "#4a7fa5", "border-width": 3 } },
      { selector: 'node[kind = "family"].cy-couple-family', style: { "background-color": "#4a7fa5", "border-color": "#2d5c7a", width: 28, height: 28 } }
    ],
    layout: { name: "preset" }
  });
  let tapDebounceTimer = null;
  state.cy.on("tap", 'node[kind = "person"]', (event) => {
    const personId = event.target.data("person_id");
    if (!personId) return;
    clearTimeout(tapDebounceTimer);
    tapDebounceTimer = setTimeout(() => {
      tapDebounceTimer = null;
      selectPersonFromView(personId);
    }, 260);
  });
  state.cy.on("dbltap", 'node[kind = "person"]', (event) => {
    clearTimeout(tapDebounceTimer);
    tapDebounceTimer = null;
    focusPersonFromView(event.target.data("person_id"));
  });
  state.cy.on("tap", 'node[kind = "family"]', async (event) => {
    const eventId = event.target.data("event_id");
    if (!eventId) return;
    state.coupleEventId = eventId;
    const { payload } = await fetchJson(`/api/couple/${encodeURIComponent(eventId)}`);
    state.couplePersonIds = [
      (payload.groom || {}).person ? payload.groom.person.id : null,
      (payload.bride || {}).person ? payload.bride.person.id : null,
    ].filter(Boolean);
    applyCoupleHighlight();
    renderMarriageCard(payload);
    showCouplePanel();
  });
}

async function selectPersonFromView(personId) {
  if (!personId || !canDiscardPersonEdits()) return;
  state.selectedPersonId = personId;
  markSelected(personId);
  clearCoupleHighlight();
  await loadPersonCard(personId);
  if (isMobileLayout()) toggleSidebar(rightSidebar, false);
}

async function focusPersonFromView(personId) {
  if (!personId || !canDiscardPersonEdits() || personId === state.focusId) return;
  state.focusId = personId;
  state.selectedPersonId = personId;
  if (!state.displayAll) {
    state.branchTargetId = "";
    state.traceTargetId = "";
    branchOnlyToggle.checked = false;
    state.branchOnly = false;
  }
  await refreshGraph();
}

function setCyElements(elements) {
  ensureCy();
  state.cy.batch(() => {
    state.cy.elements().remove();
    state.cy.add(elements);
  });
}

function renderGraphView() {
  syncCanvasSurface();
  if (state.viewMode === "two-way-fan") {
    renderFan();
    fanFit();
    return;
  }
  if (state.viewMode === "couple-star") {
    const { elements, positions } = buildStarElements(state.graphElements);
    setCyElements(elements);
    applyEdgeStyle("star");
    state.cy.resize();
    state.cy.layout({ name: "preset", positions: (node) => positions[node.id()] || { x: 0, y: 0 }, fit: true, padding: 50, animate: false }).run();
    return;
  }
  setCyElements(state.graphElements);
  state.cy.resize();
  runTreeLayout();
}

// --- tree -------------------------------------------------------------------

function applyEdgeStyle(view) {
  if (!state.cy) return;
  const cfg = state.layout.tree;
  const horizontal = cfg.rankDir === "LR" || cfg.rankDir === "RL";
  const childStyle = view === "tree"
    ? cfg.edgeStyle === "taxi"
      ? { "curve-style": "taxi", "taxi-direction": horizontal ? "horizontal" : "vertical", "taxi-turn": "50%", "taxi-turn-min-distance": 10 }
      : cfg.edgeStyle === "bezier"
        ? { "curve-style": "unbundled-bezier", "control-point-distances": [0], "control-point-weights": [0.5] }
        : { "curve-style": "straight" }
    : { "curve-style": "straight" };
  if (view === "tree" && cfg.engine === "force") Object.assign(childStyle, { "curve-style": "straight" });
  state.cy.style().selector('edge[kind = "child"]').style(childStyle).update();
}

function orderUnitMembers(members, spouseLinks, nodeById) {
  if (members.length < 2) return members;
  if (members.length === 2) {
    const [a, b] = members;
    const sexA = nodeById[a].data("sex");
    const sexB = nodeById[b].data("sex");
    return sexA !== "M" && sexB === "M" ? [b, a] : [a, b];
  }
  // A person with several marriages sits in the middle of a chain of spouses.
  const degree = (id) => (spouseLinks[id] || new Set()).size;
  const start = members.find((id) => degree(id) === 1) || members[0];
  const order = [start];
  const seen = new Set(order);
  while (order.length < members.length) {
    const last = order[order.length - 1];
    const next = [...(spouseLinks[last] || [])].find((id) => !seen.has(id) && members.includes(id))
      || members.find((id) => !seen.has(id));
    order.push(next);
    seen.add(next);
  }
  return order;
}

function coupleTreePositions(cfg) {
  const cy = state.cy;
  const horizontal = cfg.rankDir === "LR" || cfg.rankDir === "RL";
  const cross = horizontal ? CARD.h : CARD.w;
  const along = horizontal ? CARD.w : CARD.h;
  const persons = cy.nodes('[kind = "person"]');
  const families = cy.nodes('[kind = "family"]');
  const nodeById = {};
  const root = {};
  persons.forEach((node) => { nodeById[node.id()] = node; root[node.id()] = node.id(); });
  const find = (id) => { while (root[id] !== id) { root[id] = root[root[id]]; id = root[id]; } return id; };
  const famParents = {};
  const famChildren = {};
  const spouseLinks = {};
  families.forEach((family) => {
    const parents = family.incomers('node[kind = "person"]').map((node) => node.id());
    famParents[family.id()] = parents;
    famChildren[family.id()] = family.outgoers('node[kind = "person"]').map((node) => node.id());
    for (let index = 1; index < parents.length; index += 1) {
      root[find(parents[index])] = find(parents[0]);
      (spouseLinks[parents[0]] ||= new Set()).add(parents[index]);
      (spouseLinks[parents[index]] ||= new Set()).add(parents[0]);
    }
  });
  const unitMembers = {};
  persons.forEach((node) => { (unitMembers[find(node.id())] ||= []).push(node.id()); });
  const unitOf = {};
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: cfg.nodeSep, ranksep: cfg.rankSep, ranker: cfg.ranker, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const [unitId, members] of Object.entries(unitMembers)) {
    const ordered = orderUnitMembers(members, spouseLinks, nodeById);
    unitMembers[unitId] = ordered;
    for (const id of ordered) unitOf[id] = unitId;
    g.setNode(unitId, { width: ordered.length * cross + (ordered.length - 1) * cfg.coupleGap, height: along });
  }
  families.forEach((family) => {
    const parents = famParents[family.id()];
    if (!parents.length) return;
    const parentUnit = unitOf[parents[0]];
    for (const childId of famChildren[family.id()]) {
      const childUnit = unitOf[childId];
      if (!childUnit || childUnit === parentUnit) continue;
      const onPath = family.edgesTo(nodeById[childId]).some((edge) => edge.data("path") === "true");
      const existing = g.edge(parentUnit, childUnit);
      g.setEdge(parentUnit, childUnit, { minlen: 1, weight: (existing ? existing.weight : 0) + (onPath ? 10 : 1) });
    }
  });
  dagre.layout(g);
  const raw = {};
  for (const [unitId, members] of Object.entries(unitMembers)) {
    const box = g.node(unitId);
    const start = box.x - box.width / 2 + cross / 2;
    members.forEach((id, index) => { raw[id] = { x: start + index * (cross + cfg.coupleGap), y: box.y }; });
  }
  families.forEach((family) => {
    const parents = famParents[family.id()].filter((id) => raw[id]);
    const children = famChildren[family.id()].filter((id) => raw[id]);
    if (parents.length >= 2) {
      const xs = parents.map((id) => raw[id].x);
      raw[family.id()] = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: raw[parents[0]].y };
    } else if (parents.length === 1) {
      raw[family.id()] = { x: raw[parents[0]].x, y: raw[parents[0]].y + along / 2 + 22 };
    } else if (children.length) {
      raw[family.id()] = { x: children.reduce((sum, id) => sum + raw[id].x, 0) / children.length, y: raw[children[0]].y - along / 2 - 22 };
    }
  });
  const transform = {
    TB: ({ x, y }) => ({ x, y }),
    BT: ({ x, y }) => ({ x, y: -y }),
    LR: ({ x, y }) => ({ x: y, y: x }),
    RL: ({ x, y }) => ({ x: -y, y: x }),
  }[cfg.rankDir] || ((point) => point);
  const positions = {};
  for (const [id, point] of Object.entries(raw)) positions[id] = transform(point);
  return positions;
}

function runTreeLayout() {
  if (!state.cy || state.viewMode !== "tree") return;
  const cfg = state.layout.tree;
  applyEdgeStyle("tree");
  let layout;
  if (cfg.engine === "force") {
    layout = state.cy.elements().not('edge[kind = "order"]').layout({
      name: "cose",
      animate: false,
      randomize: true,
      fit: true,
      padding: 40,
      nodeRepulsion: () => cfg.repulsion,
      idealEdgeLength: (edge) => edge.data("kind") === "spouse" ? 30 : cfg.edgeLength,
      edgeElasticity: (edge) => edge.data("kind") === "spouse" ? 400 : 100,
      gravity: cfg.gravity,
      nodeOverlap: 24,
      componentSpacing: 120,
      numIter: 2500,
    });
  } else {
    const positions = coupleTreePositions(cfg);
    layout = state.cy.layout({ name: "preset", positions: (node) => positions[node.id()] || { x: 0, y: 0 }, fit: false, animate: false });
  }
  layout.one("layoutstop", fitGraphToState);
  layout.run();
}

// --- ancestor slots shared by star and fan --------------------------------------

function ancestorPeople(elements) {
  const people = {};
  for (const element of elements) {
    if (element.data.kind === "person") people[element.data.person_id] = element.data;
  }
  return people;
}

function rootSectors(sweep, hasPartner) {
  if (hasPartner) return [[270, 270 - sweep / 2], [270, 270 + sweep / 2]];
  return [[270 - sweep / 2, 270 + sweep / 2]];
}

function hasKnownParents(people, personId) {
  const person = people[personId];
  return Boolean(person && ((person.father_id && people[person.father_id]) || (person.mother_id && people[person.mother_id])));
}

function ancestorSlots(people, generations, sweep, withEmpty) {
  const roots = [state.focusId, state.viewPartnerId].filter((id) => id && people[id]);
  const couple = roots.length > 1;
  const centreSectors = rootSectors(sweep, couple);
  let sectors = centreSectors;
  let lineGen = 2;
  if (couple) {
    const withAncestry = roots.map((id) => hasKnownParents(people, id));
    // When only one spouse has recorded ancestors, give that line the whole chart.
    if (withAncestry[0] !== withAncestry[1]) {
      const full = rootSectors(sweep, false)[0];
      sectors = withAncestry.map((has) => (has ? full : [270, 270]));
    } else {
      lineGen = 1;
    }
  }
  const slots = [];
  const walk = (personId, gen, a, b, line, childId) => {
    const person = people[personId];
    slots.push({ pid: personId, person, gen, a, b, line, childId, known: true });
    if (gen >= generations) return;
    const mid = (a + b) / 2;
    [[person.father_id, a, mid, 0], [person.mother_id, mid, b, 1]].forEach(([parentId, start, end, side]) => {
      const nextLine = gen < lineGen ? line * 2 + side : line;
      if (parentId && people[parentId]) walk(parentId, gen + 1, start, end, nextLine, personId);
      else if (withEmpty) slots.push({ pid: "", person: null, gen: gen + 1, a: start, b: end, line: nextLine, childId: personId, known: false });
    });
  };
  roots.forEach((rootId, index) => walk(rootId, 0, sectors[index][0], sectors[index][1], lineGen === 1 ? index : 0, ""));
  for (const slot of slots) {
    if (slot.gen !== 0) continue;
    const index = roots.indexOf(slot.pid);
    [slot.a, slot.b] = centreSectors[index];
  }
  return { roots, slots };
}

function polar(radius, degrees) {
  const angle = (degrees * Math.PI) / 180;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

function tint(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const mix = (channel) => Math.round(channel + (255 - channel) * amount);
  const r = mix(value >> 16);
  const g = mix((value >> 8) & 255);
  const b = mix(value & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function cleanDates(dates) {
  return String(dates || "").trim().split(/\s{2,}/).filter(Boolean).join(" – ");
}

function shortDates(dates) {
  // Estimated dates carry their reasoning in brackets; keep the cards readable.
  return cleanDates(String(dates || "").replace(/\s*\([^)]*\)/g, ""));
}

// --- couple star -------------------------------------------------------------

function starSlots(people, generations, sweep) {
  const roots = [state.focusId, state.viewPartnerId].filter((id) => id && people[id]);
  const parentsOf = (personId) => {
    const person = people[personId];
    return [person.father_id, person.mother_id].filter((id) => id && people[id]);
  };
  const weightCache = new Map();
  const weight = (personId, gen, trail) => {
    const key = `${personId}:${gen}`;
    if (weightCache.has(key)) return weightCache.get(key);
    const parents = gen < generations ? parentsOf(personId).filter((id) => !trail.has(id)) : [];
    const value = parents.length ? parents.reduce((sum, id) => sum + weight(id, gen + 1, new Set([...trail, id])), 0) : 1;
    weightCache.set(key, value);
    return value;
  };
  const slots = [];
  const bothLines = roots.length > 1 && roots.every((id) => hasKnownParents(people, id));
  const lineGen = bothLines ? 1 : 2;
  const walk = (personId, gen, a, b, line, childId, trail) => {
    slots.push({ pid: personId, person: people[personId], gen, a, b, line, childId });
    if (gen >= generations) return;
    const parents = parentsOf(personId).filter((id) => !trail.has(id));
    const weights = parents.map((id) => weight(id, gen + 1, new Set([...trail, id])));
    const total = weights.reduce((sum, value) => sum + value, 0) || 1;
    let cursor = a;
    parents.forEach((parentId, index) => {
      const end = cursor + ((b - a) * weights[index]) / total;
      const side = parentId === people[personId].father_id ? 0 : 1;
      walk(parentId, gen + 1, cursor, end, gen < lineGen ? line * 2 + side : line, personId, new Set([...trail, parentId]));
      cursor = end;
    });
  };
  if (roots.length > 1) {
    const rootWeights = roots.map((id) => (hasKnownParents(people, id) ? weight(id, 0, new Set([id])) : 0));
    const total = rootWeights[0] + rootWeights[1] || 1;
    const shares = rootWeights.map((value) => (sweep * value) / total);
    walk(roots[0], 0, 270, 270 - shares[0], bothLines ? 0 : 0, "", new Set([roots[0]]));
    walk(roots[1], 0, 270, 270 + shares[1], bothLines ? 1 : 0, "", new Set([roots[1]]));
  } else if (roots.length) {
    walk(roots[0], 0, 270 - sweep / 2, 270 + sweep / 2, 0, "", new Set([roots[0]]));
  }
  return { roots, slots };
}

function buildStarElements(elements) {
  const cfg = state.layout.star;
  const card = STAR_CARD[cfg.cardSize] || STAR_CARD.normal;
  const people = ancestorPeople(elements);
  const { roots, slots } = starSlots(people, cfg.generations, cfg.spread);
  const couple = roots.length > 1;
  const sweepRad = (cfg.spread * Math.PI) / 180;
  const centreOffset = couple ? card.w / 2 + 40 : 0;
  const needed = (card.w + card.h) / 2 + 18;
  const perGeneration = [];
  for (const slot of slots) perGeneration[slot.gen] = (perGeneration[slot.gen] || 0) + 1;
  const radius = [0];
  for (let gen = 1; gen <= cfg.generations; gen += 1) {
    const count = perGeneration[gen] || 0;
    const minimum = gen === 1 ? centreOffset + card.w * 0.9 : 0;
    radius[gen] = Math.max(radius[gen - 1] + cfg.ringGap, (count * needed) / sweepRad, minimum);
  }
  const positions = {};
  const result = [];
  const placed = new Set();
  const addPerson = (slot, point) => {
    const key = `person:${slot.pid}`;
    if (placed.has(key)) return;
    placed.add(key);
    positions[key] = point;
    const lineColor = slot.gen > 0 ? FAN_LINE_COLORS[slot.line % FAN_LINE_COLORS.length] : undefined;
    result.push({ data: { ...slot.person, id: key, w: card.w, h: card.h, fs: card.fs, tw: card.w - 18, ...(lineColor ? { line_color: lineColor } : {}),
      display_label: [slot.person.label, shortDates(slot.person.dates)].filter(Boolean).join("\n") } });
  };
  roots.forEach((rootId, index) => {
    const slot = slots.find((item) => item.pid === rootId && item.gen === 0);
    addPerson(slot, { x: couple ? (index === 0 ? -centreOffset : centreOffset) : 0, y: 0 });
  });
  for (const slot of slots) {
    if (slot.gen === 0) continue;
    addPerson(slot, polar(radius[slot.gen], (slot.a + slot.b) / 2));
    const id = `star:${slot.pid}->${slot.childId}`;
    if (!result.some((item) => item.data.id === id)) {
      result.push({ data: { id, source: `person:${slot.pid}`, target: `person:${slot.childId}`, kind: "star", path: "false" } });
    }
  }
  if (couple) {
    const rootKeys = roots.map((id) => `person:${id}`);
    const family = elements.find((element) => element.data.kind === "family" && rootKeys.every((key) =>
      elements.some((edge) => edge.data.source === key && edge.data.target === element.data.id)));
    if (family) {
      result.push({ data: { ...family.data, path: "false" } });
      positions[family.data.id] = { x: 0, y: 0 };
      rootKeys.forEach((key) => result.push({ data: { id: `star:${key}->${family.data.id}`, source: key, target: family.data.id, kind: "spouse", path: "false" } }));
    } else {
      result.push({ data: { id: "star:couple", source: rootKeys[0], target: rootKeys[1], kind: "spouse", path: "false" } });
    }
  }
  return { elements: result, positions };
}

// --- fan chart (SVG) ---------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(name, attrs = {}, parent = null) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (parent) parent.appendChild(element);
  return element;
}

function wedgePath(inner, outer, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo >= 359.999) {
    return `${wedgePath(inner, outer, lo, lo + 180)} ${wedgePath(inner, outer, lo + 180, hi)}`;
  }
  const large = hi - lo > 180 ? 1 : 0;
  const p1 = polar(outer, lo);
  const p2 = polar(outer, hi);
  if (inner <= 0) {
    return `M0 0 L${p1.x} ${p1.y} A${outer} ${outer} 0 ${large} 1 ${p2.x} ${p2.y} Z`;
  }
  const p3 = polar(inner, hi);
  const p4 = polar(inner, lo);
  return `M${p1.x} ${p1.y} A${outer} ${outer} 0 ${large} 1 ${p2.x} ${p2.y} L${p3.x} ${p3.y} A${inner} ${inner} 0 ${large} 0 ${p4.x} ${p4.y} Z`;
}

function readableRotation(degrees) {
  let rotation = ((degrees % 360) + 540) % 360 - 180;
  if (rotation > 90) rotation -= 180;
  if (rotation < -90) rotation += 180;
  return rotation;
}

function fanFill(slot, cfg) {
  if (!slot.known) return "#faf6ee";
  if (slot.gen === 0) return "#fff2cc";
  if (cfg.colorBy === "confidence") return FAN_CONFIDENCE_COLORS[slot.person.confidence] || "#e3dccf";
  if (cfg.colorBy === "generation") return slot.gen % 2 ? "#ecd6b0" : "#f6e9d2";
  return tint(FAN_LINE_COLORS[slot.line % FAN_LINE_COLORS.length], Math.min(0.12 * (slot.gen - 1), 0.66));
}

function renderFan() {
  const cfg = state.layout.fan;
  const people = ancestorPeople(state.graphElements);
  const { slots } = ancestorSlots(people, cfg.generations, cfg.sweep, cfg.showEmpty);
  const centre = 112;
  fanChart.replaceChildren();
  const root = svgEl("g", { class: "fan-root" }, fanChart);
  for (const slot of slots) {
    const inner = slot.gen === 0 ? 0 : centre + (slot.gen - 1) * cfg.ringWidth;
    const outer = slot.gen === 0 ? centre : inner + cfg.ringWidth;
    const group = svgEl("g", { class: `fan-slot${slot.known ? "" : " fan-empty"}`, ...(slot.pid ? { "data-pid": slot.pid } : {}) }, root);
    svgEl("path", { d: wedgePath(inner, outer, slot.a, slot.b), fill: fanFill(slot, cfg) }, group);
    if (!slot.known) continue;
    const title = svgEl("title", {}, group);
    title.textContent = [slot.person.label, cleanDates(slot.person.dates), slot.person.confidence].filter(Boolean).join(" · ");
    const mid = (slot.a + slot.b) / 2;
    const span = (Math.abs(slot.b - slot.a) * Math.PI) / 180;
    const dates = cfg.showDates ? shortDates(slot.person.dates) : "";
    let anchor;
    let rotation;
    let length;
    let thickness;
    if (slot.gen === 0) {
      anchor = polar(centre * 0.5, mid);
      rotation = 0;
      length = centre * 0.9;
      thickness = centre * 1.1;
    } else {
      const radius = (inner + outer) / 2;
      anchor = polar(radius, mid);
      const arc = radius * span;
      const tangential = slot.gen <= 2 && arc > cfg.ringWidth;
      rotation = tangential ? readableRotation(mid + 90) : readableRotation(mid);
      length = tangential ? arc * 0.88 : cfg.ringWidth - 10;
      thickness = tangential ? cfg.ringWidth - 10 : arc * 0.86;
    }
    const lines = dates ? 2.5 : 1.3;
    const fontSize = Math.max(5, Math.min(13 - Math.max(0, slot.gen - 2), thickness / lines));
    if (fontSize < 5.5 || length < 14) continue;
    const maxChars = Math.max(3, Math.floor(length / (fontSize * 0.56)));
    const fit = (text) => (text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text);
    const text = svgEl("text", { transform: `translate(${anchor.x} ${anchor.y}) rotate(${rotation})`, "font-size": fontSize.toFixed(1), "text-anchor": "middle" }, group);
    const label = slot.person.label || "";
    const nameLines = slot.gen === 0 && label.includes(" ") ? [label.slice(0, label.lastIndexOf(" ")), label.slice(label.lastIndexOf(" ") + 1)] : [label];
    const totalLines = nameLines.length + (dates ? 1 : 0);
    nameLines.forEach((line, index) => {
      const dy = index === 0 ? `${(-(totalLines - 1) * 0.6 + 0.35).toFixed(2)}em` : "1.2em";
      const name = svgEl("tspan", { x: 0, dy, class: "fan-name" }, text);
      name.textContent = fit(line);
    });
    if (dates) {
      const dateLine = svgEl("tspan", { x: 0, dy: "1.2em", class: "fan-dates" }, text);
      dateLine.textContent = fit(dates);
    }
  }
  const deepest = slots.reduce((max, slot) => Math.max(max, slot.gen), 0);
  state.fanRadius = centre + Math.max(1, deepest) * cfg.ringWidth + 40;
  highlightFanSelection(state.selectedPersonId);
}

function highlightFanSelection(personId) {
  for (const group of fanChart.querySelectorAll(".fan-slot")) {
    group.classList.toggle("selected", Boolean(personId) && group.dataset.pid === personId);
  }
}

function setFanView(view) {
  state.fanView = view;
  fanChart.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
}

function fanFit() {
  const radius = state.fanRadius || 400;
  setFanView({ x: -radius, y: -radius, w: radius * 2, h: radius * 2 });
}

function fanScale() {
  const view = state.fanView;
  return Math.max(view.w / Math.max(fanChart.clientWidth, 1), view.h / Math.max(fanChart.clientHeight, 1));
}

function fanZoom(factor, clientX = null, clientY = null) {
  const view = state.fanView;
  if (!view) return;
  const rect = fanChart.getBoundingClientRect();
  const scale = fanScale();
  const cx = clientX === null ? view.x + view.w / 2 : view.x + view.w / 2 + (clientX - rect.left - rect.width / 2) * scale;
  const cy = clientY === null ? view.y + view.h / 2 : view.y + view.h / 2 + (clientY - rect.top - rect.height / 2) * scale;
  const w = view.w / factor;
  const h = view.h / factor;
  setFanView({ x: cx - (cx - view.x) / factor, y: cy - (cy - view.y) / factor, w, h });
}

(() => {
  let drag = null;
  fanChart.addEventListener("wheel", (event) => {
    event.preventDefault();
    fanZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
  }, { passive: false });
  fanChart.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY, view: { ...state.fanView }, moved: false };
  });
  window.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const scale = fanScale();
    setFanView({ ...drag.view, x: drag.view.x - dx * scale, y: drag.view.y - dy * scale });
  });
  window.addEventListener("pointerup", () => {
    if (drag?.moved) fanChart.dataset.justDragged = "1";
    drag = null;
  });
  let clickTimer = null;
  fanChart.addEventListener("click", (event) => {
    if (fanChart.dataset.justDragged) { delete fanChart.dataset.justDragged; return; }
    const pid = event.target.closest(".fan-slot")?.dataset.pid;
    if (!pid) return;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => selectPersonFromView(pid), 240);
  });
  fanChart.addEventListener("dblclick", (event) => {
    clearTimeout(clickTimer);
    const pid = event.target.closest(".fan-slot")?.dataset.pid;
    if (pid) focusPersonFromView(pid);
  });
})();

// --- layout settings popover --------------------------------------------------

const LAYOUT_CONTROLS = {
  tree: [
    { key: "engine", label: "Layout", type: "segmented", options: [["dagre", "Generations"], ["force", "Force"]] },
    { key: "rankDir", label: "Direction", type: "segmented", when: (cfg) => cfg.engine === "dagre", options: [["TB", "↓ Top"], ["LR", "→ Left"], ["BT", "↑ Bottom"], ["RL", "← Right"]] },
    { key: "rankSep", label: "Generation spacing", type: "range", min: 50, max: 320, step: 10, when: (cfg) => cfg.engine === "dagre" },
    { key: "nodeSep", label: "Family spacing", type: "range", min: 10, max: 220, step: 5, when: (cfg) => cfg.engine === "dagre" },
    { key: "coupleGap", label: "Spouse gap", type: "range", min: 28, max: 140, step: 2, when: (cfg) => cfg.engine === "dagre" },
    { key: "ranker", label: "Generation ranking", type: "select", when: (cfg) => cfg.engine === "dagre", options: [["network-simplex", "Balanced"], ["tight-tree", "Compact"], ["longest-path", "Longest path"]] },
    { key: "edgeStyle", label: "Lines", type: "segmented", when: (cfg) => cfg.engine === "dagre", options: [["taxi", "Elbow"], ["bezier", "Curved"], ["straight", "Straight"]] },
    { key: "repulsion", label: "Repelling power", type: "range", min: 1000, max: 60000, step: 1000, when: (cfg) => cfg.engine === "force" },
    { key: "edgeLength", label: "Link length", type: "range", min: 40, max: 400, step: 10, when: (cfg) => cfg.engine === "force" },
    { key: "gravity", label: "Gravity", type: "range", min: 0, max: 1.5, step: 0.05, when: (cfg) => cfg.engine === "force" },
  ],
  "couple-star": [
    { key: "generations", label: "Generations back", type: "range", min: 1, max: 10, step: 1 },
    { key: "spread", label: "Spread (degrees)", type: "range", min: 120, max: 360, step: 10 },
    { key: "ringGap", label: "Ring spacing", type: "range", min: 100, max: 600, step: 10 },
    { key: "cardSize", label: "Cards", type: "segmented", options: [["normal", "Normal"], ["compact", "Compact"]] },
  ],
  "two-way-fan": [
    { key: "generations", label: "Generations back", type: "range", min: 1, max: 10, step: 1 },
    { key: "sweep", label: "Shape", type: "segmented", options: [[360, "Full circle"], [270, "¾"], [180, "Half"]] },
    { key: "ringWidth", label: "Ring width", type: "range", min: 50, max: 180, step: 5 },
    { key: "colorBy", label: "Colour by", type: "segmented", options: [["line", "Line"], ["confidence", "Evidence"], ["generation", "Generation"]] },
    { key: "showDates", label: "Show dates", type: "toggle" },
    { key: "showEmpty", label: "Show missing ancestors", type: "toggle" },
  ],
};

const LAYOUT_VIEW_KEY = { tree: "tree", "couple-star": "star", "two-way-fan": "fan" };
const LAYOUT_TITLES = { tree: "Tree layout", "couple-star": "Couple star", "two-way-fan": "Fan chart" };

function saveLayoutSettings() {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state.layout)); } catch { /* storage unavailable */ }
}

function formatControlValue(control, value) {
  if (control.key === "gravity") return Number(value).toFixed(2);
  if (control.key === "repulsion") return `${Math.round(value / 1000)}k`;
  return String(value);
}

function renderLayoutSettings() {
  const viewKey = LAYOUT_VIEW_KEY[state.viewMode];
  const cfg = state.layout[viewKey];
  const rows = LAYOUT_CONTROLS[state.viewMode].filter((control) => !control.when || control.when(cfg)).map((control) => {
    const value = cfg[control.key];
    if (control.type === "range") {
      return `<label class="ls-row"><span class="ls-label">${control.label}<output>${formatControlValue(control, value)}</output></span>
        <input type="range" data-key="${control.key}" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}" /></label>`;
    }
    if (control.type === "toggle") {
      return `<label class="ls-row ls-toggle"><input type="checkbox" data-key="${control.key}" ${value ? "checked" : ""} /><span>${control.label}</span></label>`;
    }
    if (control.type === "select") {
      return `<label class="ls-row"><span class="ls-label">${control.label}</span><select data-key="${control.key}">${control.options.map(([optionValue, text]) =>
        `<option value="${optionValue}" ${String(optionValue) === String(value) ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
    }
    return `<div class="ls-row"><span class="ls-label">${control.label}</span><div class="ls-segmented" role="group" aria-label="${control.label}">${control.options.map(([optionValue, text]) =>
      `<button type="button" data-key="${control.key}" data-value="${optionValue}" aria-pressed="${String(optionValue) === String(value)}">${text}</button>`).join("")}</div></div>`;
  }).join("");
  layoutSettings.innerHTML = `<header class="ls-head"><strong>${LAYOUT_TITLES[state.viewMode]}</strong>
      <button type="button" class="ls-reset" data-action="reset">Reset</button></header>${rows}`;
}

let layoutApplyTimer = null;
function applyLayoutSettings(immediate = false) {
  clearTimeout(layoutApplyTimer);
  const run = () => {
    if (state.viewMode === "tree") runTreeLayout();
    else if (state.viewMode === "couple-star") renderGraphView();
    else { renderFan(); fanFit(); }
  };
  if (immediate) run();
  else layoutApplyTimer = setTimeout(run, 140);
}

function updateLayoutSetting(key, rawValue) {
  const viewKey = LAYOUT_VIEW_KEY[state.viewMode];
  const current = state.layout[viewKey][key];
  const value = typeof current === "number" ? Number(rawValue) : typeof current === "boolean" ? Boolean(rawValue) : rawValue;
  state.layout[viewKey][key] = value;
  saveLayoutSettings();
}

function openLayoutSettings() {
  renderLayoutSettings();
  const toolbar = document.querySelector(".canvas-toolbar");
  layoutSettings.style.top = !isMobileLayout() && toolbar ? `${toolbar.offsetHeight + 4}px` : "";
  layoutSettings.classList.remove("hidden");
  layoutSettingsBtn.setAttribute("aria-expanded", "true");
  layoutSettingsBtn.classList.add("active");
}

function closeLayoutSettings() {
  layoutSettings.classList.add("hidden");
  layoutSettingsBtn.setAttribute("aria-expanded", "false");
  layoutSettingsBtn.classList.remove("active");
}

layoutSettingsBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  if (layoutSettings.classList.contains("hidden")) openLayoutSettings();
  else closeLayoutSettings();
});

layoutSettings.addEventListener("input", (event) => {
  const input = event.target;
  if (!input.dataset.key || input.type !== "range") return;
  updateLayoutSetting(input.dataset.key, input.value);
  const control = LAYOUT_CONTROLS[state.viewMode].find((item) => item.key === input.dataset.key);
  input.closest(".ls-row").querySelector("output").textContent = formatControlValue(control, input.value);
  applyLayoutSettings();
});

layoutSettings.addEventListener("change", (event) => {
  const input = event.target;
  if (!input.dataset.key || input.type === "range") return;
  updateLayoutSetting(input.dataset.key, input.type === "checkbox" ? input.checked : input.value);
  applyLayoutSettings(true);
});

layoutSettings.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action === "reset") {
    const viewKey = LAYOUT_VIEW_KEY[state.viewMode];
    state.layout[viewKey] = { ...LAYOUT_DEFAULTS[viewKey] };
    saveLayoutSettings();
    renderLayoutSettings();
    applyLayoutSettings(true);
    return;
  }
  if (!button.dataset.key) return;
  updateLayoutSetting(button.dataset.key, button.dataset.value);
  renderLayoutSettings();
  applyLayoutSettings(true);
});

document.addEventListener("click", (event) => {
  if (layoutSettings.classList.contains("hidden")) return;
  // The popover re-renders on option clicks, so check the original event path.
  const path = event.composedPath();
  if (path.includes(layoutSettings) || path.includes(layoutSettingsBtn)) return;
  closeLayoutSettings();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !layoutSettings.classList.contains("hidden")) {
    closeLayoutSettings();
    layoutSettingsBtn.focus();
  }
});

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.view === state.viewMode) return;
    viewModeSelect.value = button.dataset.view;
    viewModeSelect.dispatchEvent(new Event("change"));
  });
}

async function refreshGraph() {
  const params = new URLSearchParams({
    focus_id: state.focusId,
    branch_target_id: state.branchTargetId,
    trace_target_id: state.traceTargetId,
    view_mode: state.viewMode,
    branch_only: String(state.branchOnly),
    display_all: String(state.displayAll),
  });
  const { payload } = await fetchJson(`/api/graph?${params.toString()}`);
  const elements = payload.elements.map((element) => {
    if (element.data.kind !== "person") return element;
    return { ...element, data: { ...element.data, display_label: [element.data.label, shortDates(element.data.dates), element.data.meta].filter(Boolean).join("\n") } };
  });
  state.viewPartnerId = payload.view_partner_id || "";

  setOptions(branchSelect, payload.branch_options || [], state.branchTargetId, true);
  setOptions(traceSelect, state.people, state.traceTargetId, true);
  branchSelect.disabled = state.displayAll;
  traceSelect.disabled = state.displayAll;
  branchOnlyToggle.disabled = state.displayAll || !(state.branchTargetId || state.traceTargetId);
  branchHint.textContent = state.displayAll
    ? "Display all shows the full connected structure."
    : (payload.branch_found ? "" : (state.branchTargetId || state.traceTargetId) ? "No relationship route was found." : "");

  clearCoupleHighlight();
  state.graphElements = classifyEdges(elements);
  renderGraphView();
  renderDetails(payload.focus_person);
  renderPersonCard(payload.focus_person);
  const focusPerson = payload.focus_person?.person || {};
  focusContextName.textContent = focusPerson.name || focusPerson.id || "Family tree";
  state.selectedPersonId = state.focusId;
  markSelected(state.focusId);
  showPersonPanel(false);
  focusSelect.value = state.focusId;
}

async function bootstrap(preserveFocus = false) {
  const { payload } = await fetchJson("/api/bootstrap");
  state.people = payload.people;
  state.dataFile = payload.active_data_file || state.dataFile;
  setOptions(dataFileSelect, (payload.data_files || []).map((name) => ({ id: name, label: name })), state.dataFile);
  state.reviewTotal = payload.review_total || 0;
  reviewModeCount.textContent = state.reviewTotal ? String(state.reviewTotal) : "";
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
  if (state.reviewOnly) {
    const reviewPeople = visiblePeople();
    if (!reviewPeople.some((person) => person.id === state.selectedPersonId)) {
      state.selectedPersonId = reviewPeople[0]?.id || "";
    }
    renderReviewPeopleList();
    if (state.selectedPersonId) await loadPersonCard(state.selectedPersonId);
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
  refreshFocusOptions();
  if (state.reviewOnly) renderReviewPeopleList();
});

dataFileSelect.addEventListener("change", async () => {
  if (!canDiscardPersonEdits()) {
    dataFileSelect.value = state.dataFile;
    return;
  }
  state.dataFile = dataFileSelect.value || "genealogy.json";
  state.focusId = "";
  state.selectedPersonId = "";
  state.branchTargetId = "";
  state.selectedEventId = "";
  window.history.replaceState({}, "", `${window.location.pathname}?data=${encodeURIComponent(state.dataFile)}`);
  await bootstrap(false);
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
  if (!canDiscardPersonEdits()) {
    focusSelect.value = state.focusId;
    return;
  }
  state.focusId = focusSelect.value;
  state.branchTargetId = "";
  state.traceTargetId = "";
  branchOnlyToggle.checked = false;
  state.branchOnly = false;
  await refreshGraph();
});

displayAllToggle.addEventListener("change", async () => {
  if (state.linkedEventsView) return;
  if (!canDiscardPersonEdits()) {
    displayAllToggle.checked = state.displayAll;
    return;
  }
  state.displayAll = displayAllToggle.checked;
  state.branchTargetId = "";
  state.traceTargetId = "";
  branchOnlyToggle.checked = false;
  state.branchOnly = false;
  await refreshGraph();
});

branchSelect.addEventListener("change", async () => {
  if (state.linkedEventsView) return;
  if (!canDiscardPersonEdits()) {
    branchSelect.value = state.branchTargetId;
    return;
  }
  state.branchTargetId = branchSelect.value;
  state.traceTargetId = "";
  // Choosing a branch highlights its route. Isolation is deliberately a
  // separate, opt-in action controlled by the checkbox.
  state.branchOnly = false;
  branchOnlyToggle.checked = false;
  await refreshGraph();
});

traceSelect.addEventListener("change", async () => {
  if (state.linkedEventsView || !canDiscardPersonEdits()) return;
  state.traceTargetId = traceSelect.value;
  state.branchTargetId = "";
  state.branchOnly = false;
  branchOnlyToggle.checked = false;
  await refreshGraph();
});

viewModeSelect.addEventListener("change", async () => {
  state.viewMode = viewModeSelect.value;
  state.branchTargetId = "";
  state.traceTargetId = "";
  state.branchOnly = false;
  branchOnlyToggle.checked = false;
  await refreshGraph();
});

branchOnlyToggle.addEventListener("change", async () => {
  if (state.linkedEventsView) return;
  if (!canDiscardPersonEdits()) {
    branchOnlyToggle.checked = state.branchOnly;
    return;
  }
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

async function switchMode(mode) {
  if (mode === state.mode || !canDiscardPersonEdits()) return;
  state.mode = mode;
  const nextUrl = new URL(window.location.href);
  if (mode === "explore") nextUrl.searchParams.delete("mode");
  else nextUrl.searchParams.set("mode", mode);
  window.history.replaceState({}, "", nextUrl);
  state.editPanelOpen = false;
  setPersonFormClean();
  setViewMode();
  if (isMobileLayout()) {
    toggleSidebar(leftSidebar, true);
    toggleSidebar(rightSidebar, true);
  }
  if (mode === "sources") {
    renderLinkedEventsList();
    await loadEventDetails(state.selectedEventId);
    return;
  }
  if (mode === "review") {
    const reviewPeople = visiblePeople();
    state.selectedPersonId = reviewPeople[0]?.id || "";
    renderReviewPeopleList();
    if (state.selectedPersonId) await loadPersonCard(state.selectedPersonId);
    return;
  }
  await refreshGraph();
}

exploreModeBtn.addEventListener("click", () => switchMode("explore"));
reviewModeBtn.addEventListener("click", () => switchMode("review"));
sourcesModeBtn.addEventListener("click", () => switchMode("sources"));

sourceForm.elements.event_id.addEventListener("change", updateSourceFormHint);

leftToggle?.addEventListener("click", () => {
  if (!canDiscardPersonEdits()) return;
  toggleSidebar(leftSidebar, true);
});
rightToggle.addEventListener("click", () => {
  if (!canDiscardPersonEdits()) return;
  state.editPanelOpen = false;
  setPersonFormClean();
  toggleSidebar(rightSidebar, true);
});
leftExpand.addEventListener("click", () => toggleSidebar(leftSidebar, false));
rightExpand.addEventListener("click", () => toggleSidebar(rightSidebar, false));
if (helpBtn && helpModal) {
  const closeHelp = () => {
    helpModal.classList.add("hidden");
    helpBtn.focus();
  };
  helpBtn.addEventListener("click", () => {
    helpModal.classList.remove("hidden");
    helpCloseBtn?.focus();
  });
  helpCloseBtn?.addEventListener("click", closeHelp);
  helpModal.addEventListener("click", (e) => { if (e.target === helpModal) closeHelp(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !helpModal.classList.contains("hidden")) closeHelp(); });
}

if (closeEditBtn) {
  closeEditBtn.addEventListener("click", () => {
    if (!canDiscardPersonEdits()) return;
    setPersonFormClean();
    showPersonPanel(false);
  });
}

if (fullTreeBtn) {
  fullTreeBtn.addEventListener("click", async () => {
    if (!canDiscardPersonEdits()) return;
    state.displayAll = !state.displayAll;
    displayAllToggle.checked = state.displayAll;
    fullTreeBtn.classList.toggle("active", state.displayAll);
    if (state.displayAll) {
      state.branchTargetId = "";
      state.traceTargetId = "";
      branchOnlyToggle.checked = false;
      state.branchOnly = false;
    }
    await refreshGraph();
  });
}
leftResizer.addEventListener("pointerdown", () => beginResize("left"));
rightResizer.addEventListener("pointerdown", () => beginResize("right"));
for (const [resizer, side, direction] of [[leftResizer, "left", 1], [rightResizer, "right", -1]]) {
  resizer.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 20 : -20;
    setSidebarWidth(side, (side === "left" ? state.leftSidebarWidth : state.rightSidebarWidth) + delta * direction);
    fitGraphToState();
  });
}
drawerBackdrop.addEventListener("click", () => {
  if (!canDiscardPersonEdits()) return;
  toggleSidebar(leftSidebar, true);
  toggleSidebar(rightSidebar, true);
});
function zoomView(factor) {
  if (state.viewMode === "two-way-fan") {
    fanZoom(factor);
    return;
  }
  state.cy?.zoom({ level: state.cy.zoom() * factor, renderedPosition: { x: state.cy.width() / 2, y: state.cy.height() / 2 } });
}
zoomOutBtn.addEventListener("click", () => zoomView(1 / 1.2));
zoomInBtn.addEventListener("click", () => zoomView(1.2));
fitGraphBtn.addEventListener("click", fitGraphToState);
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
  setPersonFormClean();
  await refreshAfterMutation();
});
personForm.addEventListener("input", () => {
  if (!state.editPanelOpen) return;
  state.personFormDirty = true;
  personForm.classList.add("has-unsaved-changes");
  saveStatus.textContent = "Unsaved changes";
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
  await refreshAfterMutation();
  sourceStatus.textContent = "Source added.";
});

sourcesList.addEventListener("submit", async (event) => {
  const form = event.target.closest(".source-edit-form");
  if (!form) return;
  event.preventDefault();
  const sourceId = form.dataset.sourceId;
  if (!sourceId) return;
  const status = form.querySelector(".source-edit-status");
  status.textContent = "Saving...";
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  const { response, payload: savePayload } = await fetchJson(`/api/source/${encodeURIComponent(sourceId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    status.textContent = savePayload.error || "Save failed.";
    return;
  }
  status.textContent = "Saved.";
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
  const sourceLabel = personCard.querySelector(".person-card-name")?.textContent || personId;
  const targetLabel = mergeTargetSelect.selectedOptions[0]?.textContent || targetId;
  if (!window.confirm(`Merge ${sourceLabel} into ${targetLabel}?\n\nThis changes relationships and cannot be undone in the app.`)) return;
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

window.addEventListener("beforeunload", (event) => {
  if (!state.personFormDirty) return;
  event.preventDefault();
  event.returnValue = "";
});

if (isMobileLayout()) {
  leftSidebar.classList.add("collapsed");
  rightSidebar.classList.add("collapsed");
}
syncWorkspaceWidths();
updateSidebarButtons();
bootstrap();
