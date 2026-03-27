const SIDEBAR_LIMITS = {
  left: { min: 220, max: 620, default: 320 },
  right: { min: 280, max: 720, default: 380 },
};

const state = {
  people: [],
  focusId: "",
  branchTargetId: "",
  branchOnly: false,
  displayAll: false,
  reviewOnly: false,
  reviewTotal: 0,
  leftSidebarWidth: SIDEBAR_LIMITS.left.default,
  rightSidebarWidth: SIDEBAR_LIMITS.right.default,
  cy: null,
};

const searchInput = document.getElementById("searchInput");
const focusSelect = document.getElementById("focusSelect");
const branchSelect = document.getElementById("branchSelect");
const branchOnlyToggle = document.getElementById("branchOnlyToggle");
const displayAllToggle = document.getElementById("displayAllToggle");
const reviewOnlyToggle = document.getElementById("reviewOnlyToggle");
const branchHint = document.getElementById("branchHint");
const reviewQueueHint = document.getElementById("reviewQueueHint");
const treeTitle = document.getElementById("treeTitle");
const personForm = document.getElementById("personForm");
const sourceForm = document.getElementById("sourceForm");
const saveStatus = document.getElementById("saveStatus");
const sourceStatus = document.getElementById("sourceStatus");
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

function mediaUrl(path) {
  if (!path) return "";
  return `/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function personMatches(person, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return person.label.toLowerCase().includes(q) || person.id.toLowerCase().includes(q) || person.name.toLowerCase().includes(q);
}

function visiblePeople() {
  return state.people.filter((person) => {
    if (state.reviewOnly && !person.needs_review) return false;
    return personMatches(person, searchInput.value);
  });
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
  sidebar.classList.toggle("collapsed", collapsed);
  if (sidebar === leftSidebar) {
    workspace.style.setProperty("--left-sidebar-width", collapsed ? "0px" : `${state.leftSidebarWidth || SIDEBAR_LIMITS.left.default}px`);
  }
  if (sidebar === rightSidebar) {
    workspace.style.setProperty("--right-sidebar-width", collapsed ? "0px" : `${state.rightSidebarWidth || SIDEBAR_LIMITS.right.default}px`);
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
    return;
  }
  workspace.style.setProperty("--left-sidebar-width", leftSidebar.classList.contains("collapsed") ? "0px" : `${state.leftSidebarWidth}px`);
  workspace.style.setProperty("--right-sidebar-width", rightSidebar.classList.contains("collapsed") ? "0px" : `${state.rightSidebarWidth}px`);
}

function updateSourceFormHint() {
  const createMode = (sourceForm.elements.event_id.value || "").startsWith("__new_");
  sourceStatus.textContent = createMode ? "Choose date/place below to create the missing event and attach the source." : "";
}

function renderSources(sources) {
  sourcesList.innerHTML = "";
  if (!sources.length) {
    sourcesList.innerHTML = '<p class="hint">No source links for this person.</p>';
    return;
  }
  for (const source of sources) {
    const card = document.createElement("article");
    card.className = "source-card";
    const events = (source.linked_events || [])
      .map((event) => `<span class="link-chip">${event.type}${event.date ? `, ${event.date}` : ""}</span>`)
      .join("");
    const imageUrl = mediaUrl(source.local_image);
    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(source.local_image || "");
    card.innerHTML = `
      <h4>${source.title || source.id}</h4>
      <div class="source-meta">${[source.id, source.type, source.date, source.priority].filter(Boolean).join(" | ")}</div>
      ${events ? `<div>${events}</div>` : ""}
      <div class="source-actions">
        ${source.archive_url ? `<a class="link-chip" href="${source.archive_url}" target="_blank" rel="noreferrer">Open website</a>` : ""}
        ${imageUrl ? `<a class="link-chip" href="${imageUrl}" target="_blank" rel="noreferrer">${isImage ? "Open image" : "Open local file"}</a>` : ""}
      </div>
      ${imageUrl && isImage ? `<img class="image-thumb" src="${imageUrl}" alt="${source.title || source.id}" />` : ""}
    `;
    sourcesList.appendChild(card);
  }
}

function renderDetails(payload) {
  const person = payload.person || {};
  treeTitle.textContent = person.name || "Family tree";
  personForm.dataset.personId = person.id || "";
  sourceForm.dataset.personId = person.id || "";
  for (const name of ["name", "sex", "confidence", "birth_date", "birth_place", "death_date", "death_place", "provenance", "notes"]) {
    personForm.elements[name].value = person[name] || "";
  }
  fillParentSelect("father", payload.parent_options || [], person.father);
  fillParentSelect("mother", payload.parent_options || [], person.mother);
  fillSourceEventOptions(payload.event_options || []);
  updateSourceFormHint();
  renderSources(payload.sources || []);
  renderReview(payload.review || {}, person);
}

function renderReview(review, person) {
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
    nodeSep: 30,
    rankSep: 78,
    edgeSep: 10,
    fit: true,
    padding: 32,
    animate: false,
    spacingFactor: 0.95,
    minLen: (edge) => (edge.data("kind") === "order" ? 0 : 1),
    edgeWeight: (edge) => {
      if (edge.data("kind") === "order") return 20;
      if (edge.data("path") === "true") return 8;
      return 4;
    },
  };
}

function buildCy(elements) {
  if (!state.cy) {
    cytoscape.use(cytoscapeDagre);
    state.cy = cytoscape({
      container: document.getElementById("cy"),
      elements,
      wheelSensitivity: 0.18,
      minZoom: 0.1,
      maxZoom: 3,
      style: [
        {
          selector: 'node[kind = "person"]',
          style: {
            shape: "round-rectangle",
            width: 175,
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
        { selector: "edge", style: { width: 2, "line-color": "#a08f73", "curve-style": "taxi", "taxi-direction": "vertical", "taxi-turn": 22 } },
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
  const response = await fetch(`/api/graph?${params.toString()}`);
  const payload = await response.json();
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
  const response = await fetch("/api/bootstrap");
  const payload = await response.json();
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
  await refreshGraph();
}

searchInput.addEventListener("input", () => {
  const filtered = refreshFocusOptions();
  if (!filtered.some((person) => person.id === state.focusId) && filtered[0]) {
    state.focusId = filtered[0].id;
    refreshGraph();
  }
});

reviewOnlyToggle.addEventListener("change", () => {
  state.reviewOnly = reviewOnlyToggle.checked;
  const filtered = refreshFocusOptions();
  if (!filtered.some((person) => person.id === state.focusId) && filtered[0]) {
    state.focusId = filtered[0].id;
    refreshGraph();
  }
});

focusSelect.addEventListener("change", async () => {
  state.focusId = focusSelect.value;
  state.branchTargetId = "";
  branchOnlyToggle.checked = false;
  state.branchOnly = false;
  await refreshGraph();
});

displayAllToggle.addEventListener("change", async () => {
  state.displayAll = displayAllToggle.checked;
  state.branchTargetId = "";
  branchOnlyToggle.checked = false;
  state.branchOnly = false;
  await refreshGraph();
});

branchSelect.addEventListener("change", async () => {
  state.branchTargetId = branchSelect.value;
  state.branchOnly = Boolean(state.branchTargetId);
  branchOnlyToggle.checked = state.branchOnly;
  await refreshGraph();
});

branchOnlyToggle.addEventListener("change", async () => {
  state.branchOnly = branchOnlyToggle.checked;
  await refreshGraph();
});

sourceForm.elements.event_id.addEventListener("change", updateSourceFormHint);

leftToggle.addEventListener("click", () => toggleSidebar(leftSidebar, true));
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
  const response = await fetch(`/api/person/${encodeURIComponent(personForm.dataset.personId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    saveStatus.textContent = "Save failed.";
    return;
  }
  saveStatus.textContent = "Saved.";
  await bootstrap(true);
});

sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sourceStatus.textContent = "Adding source...";
  const formData = new FormData(sourceForm);
  const response = await fetch(`/api/person/${encodeURIComponent(sourceForm.dataset.personId)}/sources`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    sourceStatus.textContent = errorPayload.error || "Add source failed.";
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
  const response = await fetch(`/api/person/${personId}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provenance: promoteProvenance.value,
      confidence: promoteConfidence.value,
      note: reviewNote.value,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    reviewStatus.textContent = payload.error || "Review update failed.";
    return;
  }
  reviewStatus.textContent = "Person marked as reviewed.";
  reviewNote.value = "";
  await bootstrap(true);
});

mergeButton.addEventListener("click", async () => {
  const personId = personForm.dataset.personId;
  const targetId = mergeTargetSelect.value;
  if (!personId || !targetId) return;
  reviewStatus.textContent = "Merging duplicate...";
  const response = await fetch(`/api/person/${personId}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_id: targetId }),
  });
  const payload = await response.json().catch(() => ({}));
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
