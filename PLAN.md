# theory-pal: chord progression assistant (web app)

Status: partially built 2026-07-23. theory/, model/, audio/, midi/, and the data
pipeline are done and committed; the UI is written but unwired. **See HANDOFF.md for
current state, verification numbers, and what to do next.** This file remains the
scope and rationale document, and its milestone list below is annotated with status.

Direction change from earlier drafts: this was originally scoped as a Rust
nih-plug CLAP plugin. User chose a web-first, TypeScript-only build after weighing
egui's UI limitations against browser strengths. The plugin idea is retired unless
the in-DAW itch returns; see "Porting path" at the end.

## What this is

A hostable single-page web app for writing chord progressions:

1. Pick a key/scale, including modes and non-diatonic scales (major+minor, harmonic minor, melodic
   minor, all seven diatonic modes at minimum).
2. Pick a chord and see ranked next-chord suggestions with probabilities, driven by a
   Markov-style model trained on a real chord progression corpus, with a theory-rule
   fallback where corpus data is thin.
3. Drag chords into a 4/8/16-slot grid and hear the progression through a built-in
   piano sound, send it live over MIDI to hardware or a DAW, or export a .mid file.

No backend. The trained model ships as a static file. Free and open source, deployed
as a GitHub Pages project site under the user's existing briannadon.github.io (i.e.
served at briannadon.github.io/theory-pal); set Vite `base: '/theory-pal/'` and deploy
via a gh-pages GitHub Action. User runs Linux (CachyOS) with Reaper; live MIDI into
Reaper goes through a virtual ALSA/JACK port that the browser targets via Web MIDI.

## Stack

- Vite + TypeScript + React. React chosen for dnd ecosystem maturity; use `dnd-kit`
  for drag-and-drop (native HTML5 DnD is the fallback, but dnd-kit handles reordering
  and drop animation better).
- Vitest for the theory and model modules, which must stay pure and DOM-free.
- Audio: a SoundFont player over Web Audio. Candidates: `spessasynth_lib` (full SF2
  support) or `smplr` (lighter, sample-based instruments). Decide at M0 by testing
  latency and piano quality. Piano asset: piano-only extract of a free soundfont;
  prefer Salamander (public domain, lite SF2 ~24MB before trimming) for quality,
  FluidR3 piano program (MIT, whole GM is ~14MB) as the smaller fallback. Target a
  few MB after trimming; lazy-load the soundfont so first paint is not blocked.
- MIDI: Web MIDI API directly (supported in Chrome and Firefox). `.mid` export via a
  small SMF writer (the `midi-file` npm package, or hand-rolled; format 0 with one
  track is enough).
- Playback timing: standard Web Audio lookahead scheduler (timer thread queues note
  events against `AudioContext.currentTime`). Never schedule off `setTimeout` alone.

## Architecture (src modules, dependency order)

### 1. `theory/` (pure TS, no DOM, fully unit-tested — build first)

- Pitch/interval/note-spelling machinery.
- Scale definitions: 7 diatonic modes, harmonic minor + its modes, melodic minor + its
  modes. Data-driven (interval patterns), so adding scales is a table entry.
- Chord representation: root as scale degree + quality. v1 vocabulary: triads
  (maj/min/dim/aug), 7ths (maj7/min7/dom7/m7b5/dim7), sus2/sus4. Extensions (9/11/13,
  add9) were the first post-MVP priority (user specifically wants 9th chords).
  **Shipped for sus/7/9**: the quality union stayed closed and alterations ride
  alongside it as `ChordMods` (see SPEC.md), which `stateKey` ignores — so model
  states collapse onto the 7th/triad base for transition statistics while the
  voicing/audition layer renders the full extension, exactly as planned, with no
  schema break. 11ths/13ths would extend `ChordMods` the same way.
  Both absolute (C#m7) and relative (iv7 in G# minor) forms, with conversion in both
  directions given a key.
- Voicing engine: convert a chord sequence to concrete MIDI note numbers with basic
  voice-leading (minimize total semitone movement between adjacent chords, keep within
  a register window, root or specified inversion in bass). Block chords for v1;
  strum/arp patterns are a stretch goal.

### 2. `model/` (suggestion engine, pure TS)

- Loads the transition table (static fetch, cached). Sparse order-2 Markov over
  (scale-degree, quality) states per mode, with backoff to order 1 and then to a
  theory prior. Expected size: a few hundred KB to low MB as a compact JSON or binary
  blob; fine as a static asset.
- Theory prior: hand-written functional-harmony weights per mode
  (tonic/subdominant/dominant function graphs generalized to each mode's
  characteristic chords). This answers "what comes next in F# phrygian" when the
  corpus has nothing to say.
- Blend: `score = corpus_prob^a * theory_prior^b`, with a corpus-confidence term so
  sparse states lean on the prior. Exact weighting is a tuning task.
- Non-diatonic suggestions are a core requirement (user-confirmed): borrowed chords,
  bVII in major, secondary dominants, modal mixture. Never filter suggestions to the
  diatonic set. This also carries much of the modal flavor even when the corpus lacks
  mode-labeled data.
- Output contract: ranked list of next chords with probabilities suitable for
  percentage display, plus a `surprise(rng)` sampler drawing from the
  plausible-but-uncommon band (sample below the top few ranks, weighted by
  probability, with a floor to exclude nonsense).

### 3. `audio/` — SoundFont piano player + lookahead scheduler. Internal-sound toggle
so users routing MIDI out can silence the built-in piano.

### 4. `midi/` — Web MIDI output (port picker in UI, live note send on audition and
playback) and `.mid` file export of the grid.

Firefox specifics (user's browser): `requestMIDIAccess()` is gated behind a
per-site "site permission add-on" that Firefox auto-generates and prompts the user to
install on first request; localhost is exempt, which covers development. Firefox also
auto-denies MIDI access when no MIDI device is visible, so on a setup that uses only
virtual ports, the virtual ALSA/JACK port must exist before the page requests access.
UI implication: request MIDI access lazily (on user action in the port picker, not on
page load) and show a hint about creating the virtual port first. The app must remain
fully usable with MIDI denied (internal piano + .mid export).

### 5. `ui/` (React)

- Key/scale picker.
- Two-strip layout (user-confirmed, modeled loosely on Scaler 3 but simpler):
  - Top strip: the 7 diatonic chords of the selected key/mode, always visible,
    click to audition, drag to grid.
  - Bottom strip: suggested next chords given the last chord in context. Each cell
    shows absolute name + roman numeral + probability percentage. Rightmost cell is a
    "surprise me" slot showing one sampled plausible-but-uncommon chord, with a
    reroll control.
  - Non-diatonic suggestions get a visual marker (accent color) so borrowed chords
    are identifiable at a glance.
- Progression grid: N slots (4/8/16), one chord per bar-slot (user-confirmed for v1;
  half-bar harmonic rhythm is a post-MVP candidate), drag-and-drop from either strip,
  reorder within grid.
- Transport: play/stop, tempo control, loop toggle. Export .mid button.

## Data pipeline (offline, separate from the app)

A `data/` directory with a uv-managed Python project. Not shipped; its output is the
static model file the app fetches.

Corpus options, in preference order:

1. Chordonomicon: 666k progressions from real songs, on Hugging Face, with genre
   metadata and Spotify IDs (arXiv 2410.22046). Caveat: chords are absolute symbols
   with **no key annotation**, so the pipeline must estimate key/mode per song
   (Krumhansl-style profile matching over chord roots/qualities is standard and
   adequate) before converting to scale degrees. The Spotify audio-features endpoint
   (per-track key/mode) was deprecated for new apps in Nov 2024, so live lookup is
   out; public pre-2024 audio-features dumps can be joined on Spotify ID as a
   cross-check, but Spotify key/mode was major/minor only and mediocre, so chord-based
   estimation stays primary. License: CC-BY-NC-4.0 (checked 2026-07-23). Compatible
   with this project since it is free and open source; attribute Chordonomicon in the
   README and app footer. The NC term forecloses any future commercial use of the
   derived model; the app code itself can carry a normal open source license (MIT
   suggested) since NC binds the data, not the code.
2. McGill Billboard / similar annotated corpora: small (~700-1000 songs) but has expert
   key annotations. Useful to validate the key-estimation step in (1).
3. Hooktheory Trends API: next-chord probabilities over ~40k analyzed songs, in
   relative notation. Excellent as a reference oracle during development, but its
   terms very likely prohibit redistribution inside a shipped product, and coverage
   is major/minor pop. Dev-time reference only unless licensing is confirmed.

Pipeline steps: download corpus -> filter/dedupe -> estimate key+mode -> map chords to
(degree, quality) states -> count order-1 and order-2 transitions per mode -> smooth ->
emit the static model file.

Per user conventions: build and validate this pipeline on a handful of songs
end-to-end before running the full corpus.

## Milestones

- M0 (half a day). **NOT RUN, needs the user's hardware.** Checklist written up in
  `docs/M0-spikes.md`. (a) Web MIDI from Firefox into Reaper via a virtual ALSA/JACK
  port on CachyOS: create the port first, confirm the site-permission add-on prompt
  appears on a deployed origin (localhost skips it), and check latency is tolerable.
  (b) SoundFont playback: `smplr` was chosen by default and is wired up, but nobody has
  listened to it yet. (c) Smoke-test Chromium as the secondary browser.
- M1. **DONE** (commit 14c24b0). `theory/` with 45 tests, 21 scales, voice leading.
- M2. **DONE** (commits 9ecf6ef, 99c81a7). Pipeline validated at 74.2% tonic / 89.0%
  mode accuracy against McGill Billboard; model trained on a 15k-song sample; harness
  output checked by hand. Hooktheory validation was not done. The Billboard
  annotations served the same purpose.
- M3. **DONE**. Key picker, diatonic and suggestion strips, chord cells, hooks, grid container, transport, MIDI port picker, and top-level `TheoryPal` layout in `src/App.tsx`.
- M4. **DONE**. Progression grid container, drag-and-drop slot reordering, playback lookahead scheduler, Web MIDI out, and `.mid` export fully implemented and verified. Deploy pipeline is green: Pages is enabled, GitHub Actions builds and publishes on push.
- M5 (post-MVP). **MOSTLY DONE**:
  - Extended chords: stackable sus2/sus4/6/7/9/11/13 modifiers, freely combinable,
    applied either to the whole in-key row or to a single grid chord through a
    popover on its tile, and carried through naming, roman numerals, voicing,
    audition, and export. Naming follows lead-sheet convention via
    `extensionSpelling` (stack named by its top note; everything else an added
    tone).
  - Arp patterns: a shared `NoteEvent` IR (`theory/pattern.ts`) replaced the hardcoded
    "chord on every beat" in playback and the separately-derived timings in `.mid`
    export, and arpeggios ride on top of it — up/down/up-down/down-up/random at
    1/4-1/16 including triplets.
  - Melody/lead: a piano-roll lane (`theory/melody.ts` + `ui/MelodyLane`), rows tinted
    by chord tone / scale tone / off-scale against the bar's own chord, plus a
    procedural generator (`theory/generate.ts`) with one surprise slider. The
    generator is a *rule engine*, not a model: Chordonomicon carries no melodic data,
    and the UI says so. Its pitch scoring ports Temperley's RPK model (range x
    proximity x key profile, fit to the Essen Folksong Collection), with the harmony
    and rhythm rules RPK doesn't cover layered over it; melodies are capped near
    Essen's average 13.6-semitone span so they stay singable. Citations are in the
    header comment of generate.ts.

  - Parts: chords and melody are separate voices with independent levels, separate
    live MIDI channels, and separate tracks in a format-1 `.mid` export.

  Remaining: suggestion blend tuning;
  per-slot arp overrides; progression save/share (URL-encoded state is enough, still
  no backend). A corpus-trained melody model would need a second data pipeline
  (Essen or Lakh MIDI); only worth it if the rule engine proves too dull.

## Prior art (and why not just use it)

- Scaler 2/3: key selection, chord suggestions, sequence grid, MIDI drag-out. No Linux
  build, curated suggestions rather than corpus-derived probabilities.
- Hooktheory Trends (web): the Markov UX, but major/minor only, no MIDI, no grid
  playback, subscription-gated.
- Ripchord (open source, JUCE): chord-trigger mapping, no suggestion engine.

The niche: hostable and shareable, arbitrary scales/modes, corpus-driven suggestions
with probabilities, live MIDI out on Linux, open data pipeline.

## Decisions confirmed with user (2026-07-23)

- Web-first, TypeScript only. Static hosting, no backend. (Supersedes the nih-plug
  plan; Reaper integration happens via virtual MIDI port and .mid export.)
- Primary browser is Firefox; Chromium is a secondary smoke-test target.
- Free and open source; hosted on GitHub Pages under briannadon.github.io/theory-pal.
- One chord per bar-slot for v1.
- Corpus licensing resolved: Chordonomicon CC-BY-NC-4.0 with attribution (blocks
  commercial use of the model, which is fine); Hooktheory dev-time reference only.
- Piano: trimmed piano-only soundfont, Salamander (public domain) preferred,
  FluidR3 (MIT) fallback.
- Non-diatonic suggestions are core, not optional.
- Suggestion display: ranked list with percentages, plus a "surprise me" slot.
- Two-strip layout (diatonic on top, suggestions below), Scaler-like simplicity.
- Voice leading in v1; strum/arp is a stretch goal (shipped 2026-07-24).
- (2026-07-24) Melody support: hand-editable piano-roll lane with chord-aware row
  tinting, fed by a procedural rule engine rather than a trained model, tuned by a
  single "surprise" slider that stages rule violations rather than exposing one
  toggle per rule. Lane pitches are stored relative to the tonic, notes are
  variable-length and monophonic, and the lane grid is 1/8 or 1/16.
- (2026-07-24) In-key chords are built by stacking modifiers — sus2/sus4 mutually
  exclusive, 7 and 9 independent — rather than picking one prebuilt family. Modifiers
  live on the strip only; a chord is frozen as-is when dropped into the grid.
- No drag-out; `Export .mid` is sufficient.
- Built-in simple piano sound with a bypass toggle.
- Extensions (esp. 9ths) are the top post-MVP feature.

## Porting path (if a plugin is wanted later)

Keep `theory/` and `model/` free of DOM and framework imports. If in-DAW transport
sync ever matters enough, the logic ports to Rust for nih-plug, or wraps via a
webview-based plugin framework. Not planned; noted so module boundaries stay clean.

## Open questions

None blocking at plan level. The build-time calls have been made: `smplr` for audio,
MIT for the code license, blend weights set and documented in `src/model/constants.ts`.

Two compromises taken during the build that were not in this plan, both recorded in
HANDOFF.md: the piano samples and the UI fonts are fetched from third-party hosts
rather than served from this repo. PLAN.md intended a vendored, trimmed soundfont.
Worth correcting before calling the project finished.
