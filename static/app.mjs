import { STANDARD, GUITAR_TUNINGS, OCARINA_KEYS, FINGERS, pitch, noteName, blankTab, guitarMap, ocarinaMap } from "./notation.mjs";

const $ = selector => document.querySelector(selector);
const workspace = $("#workspace");
const csrf = $('meta[name="csrf-token"]').content;
const instruments = { guitar: "Guitar", ocarina: "Ocarina" };
const stages = { draft: "Draft", practicing: "Practicing", learned: "Learned" };
const sectionLimit = 16;
const state = { library: [], selected: null, draft: null, dirty: false, section: 0, index: 0,
  map: null, filter: "all", query: "", request: 0, timer: null, playing: false, busy: false };
const safe = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const icon = instrument => `<span class="instrument-icon ${instrument === "ocarina" ? "ocarina" : "guitar"}" aria-hidden="true"></span>`;

const samples = {
  guitar: { demo: true, title: "Evening arpeggio", artist: "Practice study", instrument: "guitar", tuning: STANDARD, tempo: 84, stage: "practicing",
    notes: "Let each string ring. Keep the picking pattern even before increasing the tempo.", sections: [
      { name: "Opening pattern", done: false, source: "e|----------0-----|----------0-----|\nB|--------1---1---|--------3---3---|\nG|------0-------0-|------0-------0-|\nD|----2-----------|----0-----------|\nA|--3-------------|--2-------------|\nE|----------------|----------------|" },
      { name: "Return", done: false, source: "e|--------0-------|------------0---|\nB|------1---1-----|----------1-----|\nG|----2-------2---|--------0-------|\nD|--2-----------2-|------2---------|\nA|----------------|----3-----------|\nE|----------------|----------------|" },
    ] },
  ocarina: { demo: true, title: "River steps", artist: "Practice study", instrument: "ocarina", tuning: "C5", tempo: 92, stage: "practicing",
    notes: "Use a gentle breath for the lower notes. Leave space at the rests.", sections: [
      { name: "Upstream", done: false, source: "C5 D5 E5 G5 | A5:2 G5 E5 | D5 E5 G5 D5 | C5:3 R" },
      { name: "Downstream", done: false, source: "G5 E5 F5 D5 | C5 D5 E5:2 | B4 C5 D5 G5 | C5:4" },
    ] },
};

async function api(path, method = "GET", data) {
  const request = { method, headers: { "x-csrf-token": csrf, accept: "application/json" }, redirect: "manual", cache: "no-store" };
  if (data !== undefined) {
    request.headers["content-type"] = "application/json";
    request.body = JSON.stringify(data);
  }
  const response = await fetch(path, request);
  if (response.type === "opaqueredirect" || response.status === 401) throw new Error("Your LOKI session expired. Refresh to sign in again.");
  if (!response.ok) {
    const message = await (response.headers.get("content-type")?.includes("application/json")
      ? response.json().then(body => body.error) : response.text());
    throw new Error(message || "The request could not be completed.");
  }
  return response.status === 204 ? null : response.json();
}

let notification;
function notice(message, error = false) {
  const output = $("#notice");
  clearTimeout(notification);
  output.textContent = message;
  output.classList.toggle("error", error);
  output.hidden = false;
  notification = setTimeout(() => { output.hidden = true; }, error ? 8000 : 3500);
}

function confirmAction(title, message, label) {
  const dialog = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-message").textContent = message;
  $("#confirm-action").textContent = label;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true }));
}

function canLeave() {
  return !state.dirty || confirmAction("Discard unsaved changes?", "Your edits to this arrangement will be lost.", "Discard changes");
}

function renderLibrary() {
  const phrase = state.query.trim().toLowerCase();
  const matches = state.library.filter(item => (state.filter === "all" || item.instrument === state.filter)
    && `${item.title} ${item.artist}`.toLowerCase().includes(phrase));
  $("#library-count").textContent = `${state.library.length} ${state.library.length === 1 ? "arrangement" : "arrangements"}`;
  $("#library-list").innerHTML = matches.length ? matches.map(item => `<button type="button" class="library-entry ${safe(item.instrument)}" data-id="${safe(item.id)}"
    aria-current="${state.selected?.id === item.id}">${icon(item.instrument)}<span><strong>${safe(item.title)}</strong>
    <small>${instruments[item.instrument]} · ${item.done_count}/${item.section_count} ready</small></span></button>`).join("")
    : `<p class="library-empty">${state.library.length ? "No arrangements match." : "No saved arrangements yet."}</p>`;
}

function practice(item, focus = true) {
  state.request++;
  stop();
  state.selected = item;
  state.draft = null;
  state.dirty = false;
  state.section = 0;
  state.index = 0;
  renderLibrary();
  renderPractice();
  if (focus) workspace.focus();
}

async function openSaved(id) {
  if (state.busy || !await canLeave()) return;
  const request = ++state.request;
  stop();
  try {
    const item = await api(`/api/arrangements/${encodeURIComponent(id)}`);
    if (state.request === request) practice(item);
  } catch (error) { notice(error.message, true); }
}

function tuningLabel(item) {
  if (item.instrument === "guitar") return GUITAR_TUNINGS[item.tuning] ?? item.tuning;
  return `12-hole ${OCARINA_KEYS[item.tuning] ?? item.tuning}`;
}

function sourceFor(item, section) {
  return item.instrument === "guitar" ? guitarMap(section.source, item.tuning) : ocarinaMap(section.source, item.tuning);
}

function warnings(map) {
  return map.warnings.length ? `<div class="warnings"><ul>${map.warnings.map(message => `<li>${safe(message)}</li>`).join("")}</ul></div>` : "";
}

function progressSection(item) {
  const done = item.sections.filter(section => section.done).length;
  return `<section class="card"><h2>Practice progress</h2>
    <div class="progress-label"><span>Sections ready</span><span>${done} of ${item.sections.length}</span></div>
    <progress value="${done}" max="${item.sections.length}" aria-label="Sections ready"></progress>
    <div class="section-list">${item.sections.map((section, index) => `<div class="section-row">
      <button type="button" data-section="${index}" aria-pressed="${state.section === index}">${safe(section.name)}</button>
      <button type="button" class="complete ${section.done ? "done" : ""}" data-complete="${index}" aria-pressed="${section.done}" title="${section.done ? "Mark in progress" : "Mark ready"}" aria-label="${section.done ? "Mark in progress" : "Mark ready"}: ${safe(section.name)}">${section.done ? "✓" : "○"}</button></div>`).join("")}</div></section>`;
}

function measureButtons(events, instrument) {
  return events.map((event, index) => {
    let label;
    if (instrument === "guitar") label = event.positions.map(note => note.fret ?? "×").join("·");
    else label = event.rest ? "Rest" : noteName(event.midi);
    const bar = index === 0 || events[index - 1].measure !== event.measure;
    return `<button type="button" class="${bar ? "measure-start" : ""}" data-event="${index}" aria-pressed="${index === state.index}"
      aria-label="Event ${index + 1}, measure ${event.measure}: ${label}">${label}</button>`;
  }).join("");
}

function renderPractice() {
  const item = state.selected;
  const guitar = item.instrument === "guitar";
  const section = item.sections[state.section];
  const map = state.map = sourceFor(item, section);
  state.index = Math.min(state.index, Math.max(0, map.events.length - 1));
  const active = map.events.length > 0;
  workspace.innerHTML = `<header class="hero"><div>
    <div class="row wrap hero-meta"><span class="pill ${item.instrument}">${instruments[item.instrument]}</span><span class="pill ${item.stage}">${stages[item.stage]}</span>${item.demo ? '<span class="pill">Sample</span>' : ""}</div>
    <h1>${safe(item.title)}</h1><p class="hero-info">${item.artist ? `${safe(item.artist)} · ` : ""}${safe(tuningLabel(item))} · ${item.tempo} BPM</p></div>
    <div class="row wrap">${item.demo ? '<button type="button" class="accent" data-action="copy">Save a copy</button>' : '<button type="button" class="accent" data-action="edit">Edit arrangement</button>'}<button type="button" data-action="export">Download text</button></div>
    </header><div class="workspace-grid"><div class="main-stack">
    <section class="card"><div class="card-heading"><h2>${guitar ? "Fretboard" : "Fingering map"}</h2><p class="subtle">${safe(section.name)} · ${guitar ? "Select a tab event to see where to play it." : "Select a note to see which holes to cover."}</p></div>
    <div class="row controls"><button type="button" class="small accent" data-action="play" ${active ? "" : "disabled"}>▶ Play</button>
    <button type="button" class="small" data-action="previous" aria-label="Previous event" ${active ? "" : "disabled"}>← Previous</button>
    <button type="button" class="small" data-action="next" aria-label="Next event" ${active ? "" : "disabled"}>Next →</button>
    <span class="step-count" id="step-count"></span></div>
    <div id="instrument-map"></div>${warnings(map)}
    ${active ? `<div class="events ${item.instrument}" id="events" aria-label="Practice events">${measureButtons(map.events, item.instrument)}</div>` : ""}
    ${guitar && active ? '<p class="subtle">Playback spaces tab events evenly.</p>' : ""}</section>
    <section class="card"><h2>${guitar ? "Tab source" : "Note sequence"}</h2><pre class="source">${safe(section.source || "No notation entered yet.")}</pre></section></div>
    <div class="side-stack">${progressSection(item)}<section class="card"><h2>Practice notes</h2><p class="practice-notes">${safe(item.notes || "No practice notes yet.")}</p>
    ${item.demo ? "" : '<button type="button" class="small" data-action="notes">Edit notes</button>'}</section></div></div>`;
  showEvent(false);
}

function guitarDiagram(map, event) {
  if (!map.strings) return '<div class="empty-map">Set the guitar tuning to see the fretboard.</div>';
  const activeFrets = event?.positions.map(note => note.fret).filter(fret => fret !== null) ?? [];
  const highest = activeFrets.length ? Math.max(...activeFrets) : 0;
  const lowest = activeFrets.length ? Math.min(...activeFrets) : 0;
  const left = highest <= 12 ? 0 : Math.min(12, lowest);
  const right = Math.max(left + 12, highest);
  const frets = Array.from({ length: right - left + 1 }, (_, index) => left + index);
  const inlays = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
  const board = `<div class="fret-scroll"><table class="fretboard${frets.length > 13 ? " wide" : ""}" aria-label="Guitar fretboard"><thead><tr><th scope="col">String</th>${frets.map(fret => `<th scope="col">${fret}</th>`).join("")}</tr></thead><tbody>
    ${map.strings.map((open, string) => {
      const position = event?.positions.find(note => note.string === string);
      return `<tr><th scope="row">${noteName(open)}</th>${frets.map(fret => `<td data-fret="${fret}"${inlays.includes(fret) ? ' class="inlay"' : ""}>${position?.fret === fret ? `<span class="marker" title="${noteName(position.midi)}">${fret}</span>` : ""}</td>`).join("")}</tr>`;
    }).join("")}</tbody></table></div>`;
  const summary = event ? event.positions.map(note => `${noteName(map.strings[note.string])} string ${note.fret === null ? "muted" : note.fret === 0 ? `open (${noteName(note.midi)})` : `fret ${note.fret} (${noteName(note.midi)})`}`).join(" · ")
    : "Add notes to this section to place them on the fretboard.";
  return `${board}<p class="positions">${summary}</p>`;
}

function ocarinaDiagram(event) {
  if (!event || event.covered === null) return `<div class="empty-map">${event?.rest ? "Rest" : event ? `${noteName(event.midi)} is outside this instrument’s range.` : "Add a note sequence to see fingerings."}</div>`;
  const hole = (name, type = "") => `<span class="hole ${type} ${event.covered.includes(name) ? "covered" : ""}" title="${FINGERS[name]}"></span>`;
  const covered = event.covered.map(name => FINGERS[name]).join(", ");
  return `<div class="ocarina-view"><div class="ocarina-tone">${noteName(event.midi)}</div>
    <div class="ocarina-shape" role="img" aria-label="${covered ? `Cover ${covered}` : "Open all holes"}">
      <div class="hole-row">${["LP", "LR", "LM", "LI", "RI", "RM", "RR", "RP"].map(name => hole(name)).join("")}</div>
      <div class="hole-row extras">${hole("LS", "subhole")}${hole("RS", "subhole")}</div>
    </div><div class="hole-row thumbs"><span class="thumb-label">${hole("LT")} Left thumb</span><span class="thumb-label">${hole("RT")} Right thumb</span></div></div>
    <div class="legend"><span><i class="hole covered" aria-hidden="true"></i> Covered</span><span><i class="hole" aria-hidden="true"></i> Open</span></div>`;
}

function showEvent(scroll = true) {
  const events = state.map.events;
  const event = events[state.index];
  $("#instrument-map").innerHTML = state.selected.instrument === "guitar" ? guitarDiagram(state.map, event) : ocarinaDiagram(event);
  $("#step-count").textContent = event ? `Measure ${event.measure} · ${state.index + 1} / ${events.length}` : "No events";
  const old = $("#events [aria-pressed=true]");
  const current = $(`#events [data-event="${state.index}"]`);
  if (old && old !== current) old.setAttribute("aria-pressed", "false");
  if (current) {
    current.setAttribute("aria-pressed", "true");
    if (scroll) {
      const container = $("#events");
      const item = current.getBoundingClientRect(), area = container.getBoundingClientRect();
      if (item.left < area.left) container.scrollLeft -= area.left - item.left + 4;
      else if (item.right > area.right) container.scrollLeft += item.right - area.right + 4;
    }
  }
  const previous = $('[data-action="previous"]'), next = $('[data-action="next"]');
  previous.disabled = !event || state.index === 0;
  next.disabled = !event || state.index >= events.length - 1;
}

let audio;
let playback = 0;
const activeTones = new Set();
function sound(event, duration) {
  if (!audio || audio.state !== "running") return;
  const guitar = state.selected.instrument === "guitar";
  const notes = guitar ? event.positions.map(note => note.midi).filter(midi => midi !== null) : event.midi === null ? [] : [event.midi];
  const length = Math.max(.09, Math.min(1.6, duration / 1000 * .8));
  for (const midi of notes) {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.type = guitar ? "triangle" : "sine";
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    const start = audio.currentTime;
    envelope.gain.setValueAtTime(.001, start);
    envelope.gain.linearRampToValueAtTime(.14 / notes.length, start + .023);
    envelope.gain.exponentialRampToValueAtTime(.001, start + length);
    oscillator.connect(envelope).connect(audio.destination);
    activeTones.add(oscillator);
    oscillator.onended = () => { activeTones.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + length);
  }
}

function stop() {
  playback++;
  clearTimeout(state.timer);
  state.playing = false;
  for (const tone of activeTones) tone.stop();
  activeTones.clear();
  const button = $('[data-action="play"]');
  if (button) button.textContent = "▶ Play";
}

function playCurrent() {
  if (!state.playing) return;
  const event = state.map.events[state.index];
  showEvent();
  const duration = 60000 / state.selected.tempo * event.beats;
  sound(event, duration);
  state.timer = setTimeout(() => {
    if (state.index + 1 === state.map.events.length) return stop();
    state.index++;
    playCurrent();
  }, duration);
}

async function togglePlayback() {
  if (state.playing) return stop();
  if (!state.map?.events.length) return;
  const run = ++playback;
  state.playing = true;
  $('[data-action="play"]').textContent = "Ⅱ Pause";
  if (window.AudioContext) {
    try {
      audio ??= new AudioContext();
      await audio.resume();
    } catch { /* Keep the visual playback available when audio is disabled. */ }
  }
  if (run === playback) playCurrent();
}

function blankDraft() {
  return { title: "", artist: "", instrument: "guitar", tuning: STANDARD, tempo: 90, notes: "", stage: "draft", sections: [{ name: "Main", source: "", done: false }] };
}

function edit(item = null, copy = false, notes = false) {
  state.request++;
  stop();
  state.draft = item ? structuredClone(item) : blankDraft();
  if (copy) {
    delete state.draft.id;
    delete state.draft.revision;
    state.draft.stage = "draft";
    state.draft.sections.forEach(section => { section.done = false; });
  }
  state.dirty = false;
  renderEditor();
  $(notes ? '[name="notes"]' : '[name="title"]').focus();
}

const options = (values, active) => Object.entries(values).map(([value, label]) => `<option value="${safe(value)}"${value === active ? " selected" : ""}>${safe(label)}</option>`).join("");

function renderEditor() {
  const item = state.draft;
  const guitar = item.instrument === "guitar";
  const tunings = guitar ? GUITAR_TUNINGS : OCARINA_KEYS;
  const picked = Object.hasOwn(tunings, item.tuning) ? item.tuning : "custom";
  workspace.innerHTML = `<form id="editor" class="editor"><header class="hero"><div><h1>${item.id ? "Edit arrangement" : "New arrangement"}</h1></div>
    <div class="row wrap"><button type="button" data-action="cancel-edit">Cancel</button><button class="accent" type="submit">Save arrangement</button></div></header>
    <section class="card field-grid" aria-label="Arrangement details">
      <label class="span-two">Title<input name="title" required maxlength="100" value="${safe(item.title)}"></label>
      <label>Artist or composer<input name="artist" maxlength="100" value="${safe(item.artist)}"></label>
      <label>Instrument<select name="instrument">${options(instruments, item.instrument)}</select></label>
      <label>${guitar ? "Tuning preset" : "12-hole tuning"}<select name="preset">${options({ ...tunings, custom: "Custom" }, picked)}</select></label>
      <label>${guitar ? "Open strings, low to high" : "Sounding tonic"}<input name="tuning" required maxlength="40" value="${safe(item.tuning)}"></label>
      <label>Tempo (BPM)<input name="tempo" type="number" min="30" max="300" required value="${item.tempo}"></label>
      <label>Practice status<select name="stage">${options(stages, item.stage)}</select></label>
    </section>
    ${item.sections.map((section, index) => `<section class="card editor-section" data-editor-section="${index}">
      <div class="row wrap"><label class="field grow">Section ${index + 1}<input data-field="name" required maxlength="60" value="${safe(section.name)}"></label>
        <button class="small" type="button" data-action="move-up" aria-label="Move section ${index + 1} up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="small" type="button" data-action="move-down" aria-label="Move section ${index + 1} down" ${index === item.sections.length - 1 ? "disabled" : ""}>↓</button>
        <button class="small danger" type="button" data-action="remove-section" ${item.sections.length === 1 ? "disabled" : ""}>Remove</button></div>
      <label class="field">${guitar ? "ASCII tab" : "Notes"}<textarea class="notation-input" data-field="source" maxlength="12288" spellcheck="false" aria-describedby="help-${index}">${safe(section.source)}</textarea></label>
      <p class="subtle" id="help-${index}">${guitar ? "Use six lines per staff, highest string first. Line up notes that sound together, using the last digit of two-digit frets. Use x for a mute." : "Enter notes like C5 D5 E5:2. Use R for a rest and | to start a measure. A note without an octave uses the tonic’s octave."}</p>
      ${guitar ? `<div><button type="button" class="small" data-action="insert-staff">Insert blank staff</button></div>` : `<div class="palette" aria-label="Insert a note">${notePalette(item.tuning)}</div>`}
      <div data-feedback="${index}"></div></section>`).join("")}
    <div><button type="button" data-action="add-section" ${item.sections.length >= sectionLimit ? "disabled" : ""}>+ Add section</button></div>
    <section class="card"><label class="field">Practice notes<textarea name="notes" maxlength="4096">${safe(item.notes)}</textarea></label></section>
    <p class="form-error" id="form-error" role="alert" hidden></p><div class="editor-foot">${item.id ? '<button type="button" class="danger" data-action="delete">Delete arrangement</button>' : "<span></span>"}<button type="submit" class="accent">Save arrangement</button></div></form>`;
  showFeedback();
}

function notePalette(tuning) {
  const tonic = pitch(tuning);
  const naturalSteps = [-3, -1, 0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17];
  const choices = tonic === null ? [] : naturalSteps.map(offset => noteName(tonic + offset));
  return [...choices, "R", "|"].map(note => `<button type="button" data-token="${note}">${note}</button>`).join("");
}

function showFeedback() {
  for (const [index, section] of state.draft.sections.entries()) {
    const map = sourceFor(state.draft, section);
    $(`[data-feedback="${index}"]`).innerHTML = (map.events.length ? `<p class="subtle">${map.events.length} mapped ${map.events.length === 1 ? "event" : "events"}</p>` : "") + warnings(map);
  }
}

function editorInput(event) {
  const item = state.draft;
  if (!item) return;
  const { name, value, dataset } = event.target;
  const section = event.target.closest("[data-editor-section]");
  if (section && dataset.field) item.sections[Number(section.dataset.editorSection)][dataset.field] = value;
  else if (name === "tempo") item.tempo = Number(value);
  else if (["title", "artist", "stage", "notes", "tuning"].includes(name)) item[name] = value;
  else return;
  state.dirty = true;
  if (dataset.field === "source" || name === "tuning") showFeedback();
  if (name === "tuning") {
    const tunings = item.instrument === "guitar" ? GUITAR_TUNINGS : OCARINA_KEYS;
    $('[name="preset"]').value = Object.hasOwn(tunings, value) ? value : "custom";
    workspace.querySelectorAll(".palette").forEach(palette => { palette.innerHTML = notePalette(value); });
  }
}

function editorChange(event) {
  if (!state.draft) return;
  const { name, value } = event.target;
  if (name === "instrument") {
    state.draft.instrument = value;
    state.draft.tuning = value === "guitar" ? STANDARD : "C5";
    state.dirty = true;
    renderEditor();
    $('[name="instrument"]').focus();
  } else if (name === "preset" && value !== "custom") {
    const tuning = $('[name="tuning"]');
    tuning.value = value;
    editorInput({ target: tuning });
  } else if (name === "preset" && value === "custom") $('[name="tuning"]').focus();
}

function insertText(section, token, newline = false) {
  const area = section.querySelector('[data-field="source"]');
  const before = area.value.slice(0, area.selectionStart), after = area.value.slice(area.selectionEnd);
  const padding = newline ? "\n" : " ";
  const inserted = (before && !/\s$/.test(before) ? padding : "") + token + (after && !/^\s/.test(after) ? padding : "");
  if (before.length + inserted.length + after.length > area.maxLength) return notice("This section is full. Add another section to continue.", true);
  area.setRangeText(inserted, area.selectionStart, area.selectionEnd, "end");
  editorInput({ target: area });
  area.focus();
}

function mutationData(item) {
  const { title, artist, instrument, tuning, tempo, stage, notes, sections, revision } = item;
  return { title, artist, instrument, tuning: tuning.trim().replaceAll("♯", "#").replaceAll("♭", "b"), tempo, stage, notes, sections, revision };
}

function remember(item) {
  const { notes, sections, ...metadata } = item;
  state.library = [metadata, ...state.library.filter(entry => entry.id !== item.id)];
}

async function saveEdit(form) {
  if (state.busy || !state.draft) return;
  state.busy = true;
  const item = state.draft;
  form.inert = true;
  for (const button of form.querySelectorAll('[type="submit"]')) button.disabled = true;
  try {
    const updated = item.id ? await api(`/api/arrangements/${encodeURIComponent(item.id)}`, "PUT", mutationData(item))
      : await api("/api/arrangements", "POST", mutationData(item));
    remember(updated);
    practice(updated);
    notice("Arrangement saved.");
  } catch (error) {
    const output = $("#form-error");
    output.textContent = error.message;
    output.hidden = false;
    form.inert = false;
    output.scrollIntoView({ block: "nearest" });
    for (const button of form.querySelectorAll('[type="submit"]')) button.disabled = false;
  } finally { state.busy = false; }
}

async function toggleComplete(index) {
  if (state.busy) return;
  const item = structuredClone(state.selected);
  item.sections[index].done = !item.sections[index].done;
  if (item.demo) { state.selected = item; stop(); renderPractice(); return; }
  state.busy = true;
  try {
    const updated = await api(`/api/arrangements/${encodeURIComponent(item.id)}`, "PUT", mutationData(item));
    remember(updated);
    state.selected = updated;
    stop(); renderLibrary(); renderPractice();
    $(`[data-complete="${index}"]`).focus({ preventScroll: true });
  } catch (error) { notice(error.message, true); }
  finally { state.busy = false; }
}

async function removeDraft() {
  const item = state.draft;
  if (state.busy || !await confirmAction("Delete arrangement?", `“${item.title}” and its practice progress will be deleted.`, "Delete arrangement")) return;
  state.busy = true;
  try {
    await api(`/api/arrangements/${encodeURIComponent(item.id)}`, "DELETE", { revision: item.revision });
    state.library = state.library.filter(entry => entry.id !== item.id);
    practice(structuredClone(samples[item.instrument]));
    notice("Arrangement deleted.");
  } catch (error) { notice(error.message, true); }
  finally { state.busy = false; }
}

function downloadText(item) {
  const lines = [item.title, item.artist, `${instruments[item.instrument]} · ${tuningLabel(item)} · ${item.tempo} BPM`, "",
    ...item.sections.flatMap(section => [`[${section.name}]`, section.source, ""])];
  if (item.notes) lines.push("[Practice notes]", item.notes);
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.title.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 70) || "arrangement"}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleWorkspace(event) {
  const button = event.target.closest("button");
  if (!button || state.busy) return;
  const { action, section, complete, event: note, token } = button.dataset;
  if (state.draft) {
    const row = button.closest("[data-editor-section]");
    const index = row ? Number(row.dataset.editorSection) : -1;
    const sections = state.draft.sections;
    if (token !== undefined) insertText(row, token);
    if (action === "insert-staff") insertText(row, blankTab(state.draft.tuning), true);
    if (action === "cancel-edit" && await canLeave()) practice(state.selected ?? structuredClone(samples.guitar));
    if (action === "delete") await removeDraft();
    if (action === "add-section" && sections.length < sectionLimit) {
      sections.push({ name: `Section ${sections.length + 1}`, source: "", done: false });
      state.dirty = true; renderEditor();
      $(`[data-editor-section="${sections.length - 1}"] [data-field="name"]`)?.focus();
    }
    if (action === "remove-section" && sections.length > 1) {
      if (sections[index].source.trim() && !await confirmAction("Remove section?", `“${sections[index].name}” will be removed when you save.`, "Remove section")) return;
      sections.splice(index, 1);
      state.dirty = true; renderEditor();
    }
    if (action === "move-up" || action === "move-down") {
      const destination = index + (action === "move-up" ? -1 : 1);
      if (destination >= 0 && destination < sections.length) {
        [sections[index], sections[destination]] = [sections[destination], sections[index]];
        state.dirty = true; renderEditor();
        $(`[data-editor-section="${destination}"] [data-field="name"]`)?.focus();
      }
    }
    return;
  }
  if (section !== undefined) { stop(); state.section = Number(section); state.index = 0; renderPractice(); $(`[data-section="${section}"]`).focus({ preventScroll: true }); }
  if (complete !== undefined) await toggleComplete(Number(complete));
  if (note !== undefined) { stop(); state.index = Number(note); showEvent(); }
  if (action === "play") togglePlayback();
  if (action === "next" || action === "previous") { stop(); state.index += action === "next" ? 1 : -1; showEvent(); }
  if (action === "edit" || action === "copy" || action === "notes") edit(state.selected, action === "copy", action === "notes");
  if (action === "export") downloadText(state.selected);
}

workspace.addEventListener("click", handleWorkspace);
workspace.addEventListener("input", editorInput);
workspace.addEventListener("change", editorChange);
workspace.addEventListener("submit", event => { event.preventDefault(); saveEdit(event.target); });
$("#library-list").addEventListener("click", event => {
  const button = event.target.closest("[data-id]");
  if (button) openSaved(button.dataset.id);
});
$("#filters").addEventListener("click", event => {
  if (!event.target.dataset.filter) return;
  state.filter = event.target.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(button => button.setAttribute("aria-pressed", button === event.target));
  renderLibrary();
});
$("#search").addEventListener("input", event => { state.query = event.target.value; renderLibrary(); });
$(".samples").addEventListener("click", async event => {
  const sample = event.target.closest("[data-sample]");
  if (sample && !state.busy && await canLeave()) practice(structuredClone(samples[sample.dataset.sample]));
});
$("#new").addEventListener("click", async () => { if (!state.busy && await canLeave()) edit(); });
$("#logout").addEventListener("click", async () => {
  if (state.busy || !await canLeave()) return;
  try {
    const result = await fetch("/logout", { method: "POST", headers: { "x-csrf-token": csrf }, redirect: "manual" });
    if (result.type !== "opaqueredirect" && !result.ok) throw new Error("Could not sign out.");
    state.dirty = false; location.replace("/_loki/signed-out");
  } catch (error) { notice(error.message, true); }
});
window.addEventListener("beforeunload", event => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });

try {
  state.library = await api("/api/arrangements");
  renderLibrary();
  if (state.library.length) {
    const item = await api(`/api/arrangements/${encodeURIComponent(state.library[0].id)}`);
    if (state.request === 0) practice(item, false);
  } else if (state.request === 0) practice(structuredClone(samples.guitar), false);
} catch (error) {
  if (state.request === 0) practice(structuredClone(samples.guitar), false);
  notice(error.message, true);
}
