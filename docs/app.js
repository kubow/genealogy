const state = { data: null, people: [], peopleById: {}, childrenByParent: {}, marriages: {}, focusId: '', branchTargetId: '', branchOnly: false, displayAll: false, cy: null };
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
  const parts = (person?.name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}
function displayName(person) {
  if (!person) return 'Unnamed person';
  const name = person.name || 'Unnamed person';
  if ((person.sex || '') !== 'F') return name;
  const father = state.peopleById[person.father || ''] || null;
  const fatherSurname = surnameOf(father);
  if (!fatherSurname) return name;
  const parts = name.trim().split(/\s+/).filter(Boolean);
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
  const nodes = [...nodeDefs.values()].map((node) => ({ ...node, data: { ...node.data, path: pathNodes.has(node.data.id) ? 'true' : 'false', display_label: [node.data.label, node.data.dates, node.data.meta].filter(Boolean).join('\n') } }));
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
    nodeDefs.set(`person:${personId}`, { data: { id: `person:${personId}`, kind: 'person', person_id: personId, label: displayName(person), dates: graphDatesLine(person), meta: '', selected: personId === focusId ? 'true' : 'false', path: 'false', display_label: [displayName(person), graphDatesLine(person)].filter(Boolean).join('\n') } });
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
    sourcesList.innerHTML = '<p class="hint">No source links for this person.</p>';
    return;
  }
  sourcesList.innerHTML = sources.map((source) => {
    const imageUrl = source.local_image || '';
    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(source.local_image || '');
    const eventLabels = (source.linked_events || []).map((event) => `<span class="link-chip">${event.event_type}${event.date ? `, ${event.date}` : ''}</span>`).join('');
    return `<article class="source-card"><h4>${source.title || source.id}</h4><div class="source-meta">${[source.id, source.type, source.date, source.priority].filter(Boolean).join(' | ')}</div>${eventLabels ? `<div>${eventLabels}</div>` : ''}<div class="source-actions">${source.archive_url ? `<a class="link-chip" href="${source.archive_url}" target="_blank" rel="noreferrer">Open website</a>` : ''}${imageUrl ? `<a class="link-chip" href="${imageUrl}" target="_blank" rel="noreferrer">${isImage ? 'Open image' : 'Open local file'}</a>` : ''}</div>${imageUrl && isImage ? `<img class="image-thumb" src="${imageUrl}" alt="${source.title || source.id}" />` : ''}</article>`;
  }).join('');
}
function fitGraph() {
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
        { selector: 'node[kind = "person"]', style: { shape: 'round-rectangle', width: 175, height: 80, 'background-color': '#fffdf7', 'border-width': 2, 'border-color': '#ccb999', label: 'data(display_label)', 'text-wrap': 'wrap', 'text-max-width': 155, 'text-valign': 'center', 'text-halign': 'center', 'font-size': 13, 'font-weight': 700, color: '#3b2c18' } },
        { selector: 'node[kind = "person"][selected = "true"]', style: { 'background-color': '#fff2cc', 'border-color': '#b7791f', 'border-width': 3 } },
        { selector: 'node[path = "true"]', style: { 'border-color': '#c05621', 'border-width': 4, 'background-color': '#fff0df' } },
        { selector: 'node[kind = "family"]', style: { shape: 'diamond', width: 18, height: 18, 'background-color': '#c9b392', 'border-width': 1, 'border-color': '#987f5e', label: 'data(label)', 'font-size': 9, 'text-valign': 'bottom', 'text-margin-y': 11, color: '#6b5a43' } },
        { selector: 'node[kind = "family"][path = "true"]', style: { 'background-color': '#dd6b20', 'border-color': '#9c4221', width: 22, height: 22 } },
        { selector: 'edge[kind = "order"]', style: { width: 0, opacity: 0, 'events': 'no' } },
        { selector: 'edge', style: { width: 2, 'line-color': '#a08f73', 'curve-style': 'taxi', 'taxi-direction': 'vertical', 'taxi-turn': 22 } },
        { selector: 'edge[path = "true"]', style: { width: 4, 'line-color': '#dd6b20' } }
      ],
      layout: dagreLayoutOptions()
    });
    state.cy.on('tap', 'node[kind = "person"]', (event) => {
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
