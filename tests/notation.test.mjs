import test from "node:test";
import assert from "node:assert/strict";
import { blankTab, guitarMap, noteName, ocarinaMap, pitch, STANDARD } from "../static/notation.mjs";

test("guitar maps a two-digit chord, mute and second bar without treating labels as frets", () => {
  const source = "e |--10--|---0|\nB |---8--|----|\nG |---x--|----|\nD |------|----|\nA |------|----|\nD2|------|---0|";
  const { events, warnings } = guitarMap(source, "D2 A2 D3 G3 B3 E4");
  assert.deepEqual(warnings, []);
  assert.deepEqual(events.map(event => [event.measure, event.positions.map(note => [note.string, note.fret, note.midi])]), [
    [1, [[0, 10, pitch("D5")], [1, 8, pitch("G4")], [2, null, null]]],
    [2, [[0, 0, pitch("E4")], [5, 0, pitch("D2")]]],
  ]);
});

test("guitar accepts consecutive staves and reports incomplete and out-of-range input", () => {
  const staff = blankTab(STANDARD).replace("----------------", "5---------------");
  assert.deepEqual(guitarMap(`${staff}\n${staff}`, STANDARD).events.map(event => event.measure), [1, 2]);
  assert.match(guitarMap("e|--3|\nB|--5|", STANDARD).warnings[0], /six string lines/);
  assert.match(guitarMap(staff.replace("5---", "25--"), STANDARD).warnings[0], /outside 0–24/);
  assert.match(guitarMap(staff, "E2 A2").warnings[0], /six tuning pitches/);
});

test("12-hole alto C handles both subholes, accidentals, rests, and the upper range", () => {
  const { events, warnings } = ocarinaMap("A4 B4 C5 Db5 E5:2 | R F6 G6", "C5");
  assert.equal(events[0].covered.length, 12);
  assert.equal(events[1].covered.includes("RS"), true);
  assert.equal(events[1].covered.includes("LS"), false);
  assert.equal(events[2].covered.length, 10);
  assert.equal(events[3].covered.includes("RP"), false);
  assert.equal(events[3].covered.includes("RS"), true);
  assert.equal(events[4].beats, 2);
  assert.equal(events[5].rest, true);
  assert.equal(events[5].measure, 2);
  assert.deepEqual(events[6].covered, []);
  assert.equal(events[7].covered, null);
  assert.match(warnings[0], /outside this ocarina’s range/);
});

test("alternate tonic shifts the same fingerings and invalid durations stay out of the map", () => {
  const { events, warnings } = ocarinaMap("G A F#4 B4:9 ???", "G4");
  assert.deepEqual(events[0].covered, ocarinaMap("C5", "C5").events[0].covered);
  assert.equal(noteName(events[1].midi), "A4");
  assert.deepEqual(events[2].covered, ocarinaMap("B4", "C5").events[0].covered);
  assert.equal(events.length, 3);
  assert.equal(warnings.length, 2);
});
