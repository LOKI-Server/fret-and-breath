export const STANDARD = "E2 A2 D3 G3 B3 E4";
export const GUITAR_TUNINGS = {
  [STANDARD]: "Standard",
  "D2 A2 D3 G3 B3 E4": "Drop D",
  "D2 A2 D3 F#3 A3 D4": "Open D",
  "D2 A2 D3 G3 A3 D4": "DADGAD",
};
export const OCARINA_KEYS = {
  C5: "Alto C", G4: "Alto G", F4: "Alto F", C6: "Soprano C", C4: "Bass C",
};
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAX_EVENTS = 512;

export function pitch(token, defaultOctave) {
  const match = /^([A-Ga-g])([#b♯♭]?)([0-8]?)$/.exec(token);
  if (!match || (!match[3] && defaultOctave === undefined)) return null;
  const semitone = BASE[match[1].toUpperCase()];
  const offset = match[2] === "#" || match[2] === "♯" ? 1 : match[2] ? -1 : 0;
  return (Number(match[3] || defaultOctave) + 1) * 12 + semitone + offset;
}

export function noteName(midi) {
  return `${NOTE_NAMES[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function guitarTuning(value) {
  const notes = value.trim().split(/\s+/).map(token => pitch(token));
  return notes.length === 6 && notes.every(note => note !== null) ? notes.reverse() : null;
}

export function blankTab(tuning = STANDARD) {
  return tuning.trim().split(/\s+/).reverse().map(note => `${note.padStart(3)}|----------------|`).join("\n");
}

function tabRow(text) {
  const match = /^\s*([A-Ga-g](?:[#b♯♭])?[0-8]?)?\s*\|(.*)$/.exec(text);
  return match?.[2];
}

export function guitarMap(source, tuning) {
  const strings = guitarTuning(tuning);
  const events = [], warnings = [];
  if (!strings) return { strings, events, warnings: ["Enter six tuning pitches from low to high."] };

  const lines = source.split(/\r?\n/);
  let position = 0;
  let measure = 0;
  while (position < lines.length && events.length < MAX_EVENTS) {
    if (tabRow(lines[position]) === undefined) {
      position++;
      continue;
    }
    const start = position;
    const rows = [];
    while (position < lines.length && tabRow(lines[position]) !== undefined) {
      rows.push(tabRow(lines[position++]));
    }
    if (rows.length % 6 !== 0) {
      warnings.push(`Line ${start + 1}: use six string lines per tab staff, highest string first.`);
      continue;
    }
    for (let staff = 0; staff < rows.length && events.length < MAX_EVENTS; staff += 6) {
      const columns = new Map();
      const barLines = [];
      for (const [string, row] of rows.slice(staff, staff + 6).entries()) {
        if (string === 0) for (const bar of row.matchAll(/\|+/g)) barLines.push(bar.index);
        for (const token of row.matchAll(/\d+|[xX]/g)) {
          const value = token[0].toLowerCase();
          const column = token.index + value.length - 1;
          const fret = value === "x" ? null : Number(value);
          if (fret !== null && (value.length > 2 || fret > 24)) {
            if (warnings.length < 8) warnings.push(`Line ${start + staff + string + 1}: fret ${value} is outside 0–24.`);
            continue;
          }
          if (!columns.has(column)) columns.set(column, []);
          columns.get(column).push({ string, fret, midi: fret === null ? null : strings[string] + fret });
        }
      }
      let currentBar = 0;
      for (const [column, positions] of [...columns].sort(([a], [b]) => a - b)) {
        if (events.length === MAX_EVENTS) break;
        while (currentBar < barLines.length && barLines[currentBar] < column) currentBar++;
        events.push({ positions, measure: measure + currentBar + 1, beats: 1 });
      }
      const lastLine = rows[staff].trimEnd();
      measure += Math.max(1, barLines.length + (lastLine.endsWith("|") ? 0 : 1));
    }
  }
  if (source.trim() && !events.length && !warnings.length) warnings.push("No fretted notes found. Paste six-line ASCII tab or enter frets in a blank staff.");
  if (events.length === MAX_EVENTS) warnings.push("The map shows up to 512 events per section. Split longer passages into sections.");
  return { strings, events, warnings };
}

const MAIN = "LP LR LM LI RI RM RR RP LT RT";
const covering = (open, sub = "") => MAIN.split(" ").filter(hole => !open.split(" ").includes(hole)).join(" ") + (sub ? ` ${sub}` : "");
// Chromatic 12-hole transverse fingerings, indexed by semitones from the low A of an alto C.
const FINGERINGS = [
  `${MAIN} LS RS`, `${MAIN} LS`, `${MAIN} RS`, MAIN,
  covering("RP", "RS"), covering("RP"), covering("RR RP", "RS"), covering("RR RP"),
  covering("RM RR RP"), covering("RI RM RP"), covering("RI RM RR RP"), covering("LR RI RM RP"),
  "LP LM LI LT RT", "LP LI RR LT RT", "LP LI LT RT", "LP LT RT", "LP RR RT", "LP RT", "LP RR", "LP", "",
];
export const FINGERS = {
  LP: "Left pinky", LR: "Left ring", LM: "Left middle", LI: "Left index",
  RI: "Right index", RM: "Right middle", RR: "Right ring", RP: "Right pinky",
  LS: "Left subhole", RS: "Right subhole", LT: "Left thumb", RT: "Right thumb",
};

export function ocarinaMap(source, tuning) {
  const tonic = pitch(tuning);
  const events = [], warnings = [];
  if (tonic === null) return { tonic, events, warnings: ["Choose a sounding tonic for your ocarina."] };
  const octave = Math.floor(tonic / 12) - 1;
  let measure = 1;
  for (const token of source.match(/[^\s,|]+|\|/g) ?? []) {
    if (events.length === MAX_EVENTS) break;
    if (token === "|") { measure++; continue; }
    const [note, length = "1", extra] = token.split(":");
    const beats = Number(length);
    const isRest = /^(?:-|r)$/i.test(note);
    const midi = isRest ? null : pitch(note, octave);
    if (extra !== undefined || !/^[1-8]$/.test(length) || (!isRest && midi === null)) {
      if (warnings.length < 8) warnings.push(`“${token}” is invalid. Try C5, Bb5, D5:2 or R for a rest.`);
      continue;
    }
    const fingering = midi === null ? undefined : FINGERINGS[midi - tonic + 3];
    if (!isRest && fingering === undefined && warnings.length < 8) {
      warnings.push(`${noteName(midi)} is outside this ocarina’s range (${noteName(tonic - 3)}–${noteName(tonic + 17)}).`);
    }
    events.push({ midi, beats, measure, rest: isRest, covered: fingering === undefined ? null : fingering.split(" ").filter(Boolean) });
  }
  if (events.length === MAX_EVENTS) warnings.push("The map shows up to 512 events per section. Split longer passages into sections.");
  return { tonic, events, warnings };
}
