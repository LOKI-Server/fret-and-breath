# Fret & Breath

A private LOKI practice library for guitar and ocarina. Save arrangements,
split them into sections, mark sections ready, and leave practice notes. The
site uses the signed-in LOKI account for every library operation. Its browser
code, fonts, diagrams, and audio preview run locally.

## Build and install

Use LOKI 0.7.0 and its `cargo-loki` packaging tool. Run these commands from this
repository.

```text
rustup target add wasm32-wasip2
cargo update -p loki-sdk --precise 0.7.0
cargo loki package --locked
```

Import `target/loki/fret-and-breath-0.1.0.loki-app` from **Applications**, grant
access to the people or groups that should use it, and enable it. The package
asks for LOKI's SQLite capability to store each user's arrangements.

## Guitar

Paste six ASCII tab lines per staff, with the highest string first. Presets
include Standard, Drop D, Open D, and DADGAD. For custom tuning, enter six open
string pitches from lowest to highest. The map places aligned frets together.
Use the last digit of a two-digit fret for alignment. `x` marks a muted string.
Playback gives each tab event one beat.

```text
e|--------0-------|
B|------1---1-----|
G|----0-------0---|
D|--2-----------2-|
A|3---------------|
E|----------------|
```

## Ocarina

The map supports single-chamber 12-hole transverse ocarinas with Asian high-note
fingerings. Alto C defaults to sounding `C5`. Use the tonic setting for other
keys and sizes. The diagram uses Taiwanese subhole placement. Compare the
accidentals and subhole positions with your specific maker's chart.
[STL fingering charts](https://www.stlocarina.com/pages/convention-booklets-and-instructions) · [Pure Ocarinas fingering systems](https://www.pureocarinas.com/ocarina-fingering-system)

Enter pitches separated by spaces. `|` starts a measure. `R` or `-` is a rest.
Add a suffix like `:2` for a two-beat note. The note palette inserts pitches
that fit the selected instrument. A pitch without an octave uses the tonic's octave.

```text
C5 D5 E5 G5 | A5:2 G5 E5 | D5 E5 G5 D5 | C5:3 R
```

## Check

```text
node --test tests/notation.test.mjs
cargo check --locked --target wasm32-wasip2
```
