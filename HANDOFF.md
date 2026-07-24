# theory-pal handoff

State as of 2026-07-24. Read this with PLAN.md (scope and rationale) and SPEC.md (the
interface contract every module builds against). The bulk of this file describes the
first build session (2026-07-23); "Session 2" below records what changed after it.

Repo: https://github.com/briannadon/theory-pal, deployed at
https://briannadon.github.io/theory-pal/ (currently still serving the Vite scaffold,
see "Where the UI left off").

## Where things stand

M0 through M3 are done except for the spikes that need the user's hardware and the UI
wiring. 228 tests pass, `npx tsc --noEmit` is clean, and the deploy pipeline is green
end to end.

| Milestone | State |
|---|---|
| M0 spikes | Needs the user's machine. Checklist in `docs/M0-spikes.md`, nothing run yet. |
| M1 `theory/` | Done, committed, verified. |
| M2 `data/` + `model/` | Done, committed, verified against real corpus output. |
| M3 UI | Done, wired, verified. |
| M4 grid/playback/export | Done, wired, verified. |
| Deploy | Done and green. Pages enabled via API; the site builds and publishes on push. |

## What is committed

`src/theory/` (commit 14c24b0) contains 21 scales (7 diatonic modes, harmonic minor family,
melodic minor family) from an interval table, chord/roman-numeral conversion, key-aware
note spelling, and deterministic voice-leading. 45 tests. Spot-checked by hand against
known theory rather than only against its own tests: dorian's major IV, phrygian's bII,
harmonic minor's V7 and vii°7 all render correctly.

`src/audio/` and `src/midi/` (commit 71d21ec) provide a lookahead scheduler with injectable
clock seams, an `smplr`-backed piano, Web MIDI output, and format-0 `.mid` export. One
scheduler drives both the piano and MIDI, so the two sinks cannot drift apart. Web MIDI
access is requested only from a user gesture, and every MIDI path no-ops safely when
access is denied. 83 tests, none needing a browser.

`src/model/` (commit 9ecf6ef) is an order-2 Markov chain with backoff to order-1 and then to a
hand-written functional-harmony prior. The prior derives each mode's characteristic
chord by comparing its interval set against the nearest of major/aeolian, so one
mechanism covers all 21 scales instead of a per-mode table. Non-diatonic chords are
never filtered out. 35 tests.

`data/` and `public/model/transitions.json` (commit 99c81a7) hold the offline uv/Python
pipeline and a model trained on a 15,000-song sample. 20 tests.

## Verification worth trusting

These numbers were reproduced independently of the agents that produced them.

Key estimation against McGill Billboard (886 songs with expert annotations):

```
tonic accuracy           74.2%   (657/886)
major/minor mode         89.0%   (784/881)
```

The error structure matters more than the headline. Relative-key confusion, the failure
mode that would most corrupt roman-numeral statistics, sits near 1%. Most residual error
is fifth-related, which the soft key assignment partly absorbs by giving fractional
counts to more than one hypothesis.

Suggestions from the trained model:

```
C ionian, after I:       IV 43.2%  V 35.5%  vi 9.6%  ii 5.0%
C ionian, after V:       I  73.2%  vi 16.0%  IV 6.2%
C ionian, after IV - V:  I  84.0%  vi 10.4%  IV 3.0%
A aeolian, after i - iv: bVII 41.8%  i 29.0%  v 9.7%  bVI 7.0%  V 5.8%
D dorian, after i:       IV 31.2%  bVII 24.0%  v 19.5%  bIII 15.2%
```

`I` rising from 73% to 84% once the context is `IV - V` rather than `V` alone is the
order-2 model earning its complexity. `vi` at 16% after `V` is the deceptive cadence,
learned from data rather than written down. D dorian ranking major `IV` first is the
mode's defining chord surviving the whole pipeline from key estimation to display.

Full-corpus cost, measured at 304 songs/sec and 143MB peak RSS on a 15k sample:
roughly 37 minutes and 400-700MB for all 680k songs. Run it with
`uv run python -m tp_data.pipeline --sample-size 0`.

## UI and Transport Wiring (Completed)

`src/ui/` is fully written, integrated, and verified:

- `logic/`: `grid.ts` (slot placement and reordering), `context.ts` (deriving suggestion context from grid state), `scaleGroups.ts` (grouping 21 scales for the picker), `voicing.ts`. All tested.
- `hooks/`: `useAudioEngine`, `useMidiOut`, `useModel`.
- `components/`: `KeyPicker`, `DiatonicStrip`, `SuggestionStrip`, `StripCell`, `ChordFace`, `GridSlot`, `ModelBadge`, `GridContainer`, `Transport`, and `TheoryPal`.
- `App.tsx` and `index.css`: scaffold replaced with real layout and `theme.css`.

Completed items:
1. `GridContainer`: manages 4/8/16 grid sizes, slot reordering, auditioning, and clearing.
2. `Transport`: play/stop control, BPM input, loop toggle, internal piano toggle, Web MIDI port selector, and `.mid` export button.
3. `MidiPortPicker`: integrated in Transport, requests MIDI access on user gesture only.
4. `Export .mid` button: wired to `exportMidiFile`.
5. `App.tsx`: updated to render top-level `TheoryPal` component.

## Open items and known compromises

**Two external runtime dependencies were introduced that PLAN.md did not intend.**
`smplr`'s `SplendidGrandPiano` streams samples from `smpldsnds.github.io` rather than
from a soundfont vendored into `public/`, and `index.html` pulls Space Grotesk and
JetBrains Mono from Google Fonts. Both work, and both mean the deployed app depends on
third-party hosts staying up and reachable. Vendoring a trimmed Salamander piano and
self-hosting the two fonts are contained changes worth making before this is considered
finished.

**`chordName` has no key context.** SPEC.md defines it as taking only an `AbsChord`, so
spelling comes from a pitch-class table. In Eb melodic minor it renders `F#+` where
`Gb+` is correct. Cosmetic, visible occasionally on chromatic chords in flat keys, and
fixable by threading `Key` through the signature.

**The model ships trained on 15k songs, not 680k.** This was the user's call for this
session. The full run is a single flag and about 37 minutes.

**M0 spikes are unrun.** Nothing has verified Web MIDI from Firefox into Reaper on real
hardware, and no one has listened to the piano. `docs/M0-spikes.md` is the checklist.
The riskiest unknown is Firefox's per-site Web MIDI permission add-on, which only
appears on a deployed origin, never on localhost.

## Session 2 (2026-07-24)

All committed and pushed to `master`. Ordered roughly as they were built; the later
entries revised the earlier ones, so read them in order.

**Chord vocabulary**

- **Stackable modifiers, on any chord, from one shared bar.** The in-key row's
  Triads/7ths/Sus selector and the grid tiles' quality dropdown both became
  `ModifierBar`: sus2, sus4, 6, 7, 9, 11, 13, every one independent and freely
  combined. The strip restyles all seven chords at once; each grid tile has a `mods`
  button that pops the same bar up beneath it (click away or Escape to dismiss, and
  the panel slides back inside the viewport for tiles near an edge).
- The `ChordQuality` union stayed **closed**. Alterations ride alongside it as
  `RelChord.mods`, which `stateKey` ignores, so the trained model is untouched and
  `model/` needed no changes at all — the migration path SPEC.md had sketched for
  extensions, realized. `chordIntervals` is the single source of truth for a chord's
  tones; `chordPitches`, `voiceChord`, `chordName` and `romanNumeral` all derive from
  it, with an identity fast path leaving unmodified chords byte-identical.
- **The 7 is deliberately not a mod.** Which seventh a degree takes is a fact about
  the key, so `withSeventh` consults the key's own diatonic 7th — but only when it is
  built on the same triad, or an augmented chord on degree 0 in C would silently
  become C major's maj7 and lose its fifth.
- **Naming** follows lead-sheet convention through `extensionSpelling`: an unbroken
  stack above the seventh is named by its top note with the rest implied (C13), and
  anything that doesn't continue the stack is an added tone (C7(add13)). Both
  renderers consume it, so symbols and numerals cannot disagree. Two pitch-class
  collisions are handled explicitly: a 6th over a seventh *is* the 13th, and a 6th
  sits exactly where dim7 puts its bb7 — which is why `ChordShape` reads the seventh
  from the base quality rather than from the interval set.
- `ui/logic/chordMods.ts` hides the remaining wrinkle: sus lives both in the quality
  vocabulary (sus2/sus4/dom7sus4, which the corpus counts) and in mods. It normalizes
  the first into the second so every toggle is a flag flip.

**Playback, parts and export**

- **A shared note-event IR** (`theory/pattern.ts`). `playProgression` and
  `exportMidiFile` both render bars through `renderBar`, so audible and exported
  material can no longer diverge; export keeps its historical whole-bar chords via the
  `sustain` pattern. Arpeggios (up/down/up-down/down-up/random, 1/4-1/16 plus
  triplets) ride on top of it.
- **Chords and melody are separate parts end to end.** One smplr instrument per voice
  sharing a single sample loader (so the second voice costs no download), each with
  its own output channel — which is what makes the transport's two faders true faders
  rather than velocity tricks. Live MIDI puts chords on channel 1 and melody on
  channel 2, faders send CC 7 per channel, and Stop panics both. `.mid` export stays
  format 0 for chords alone and becomes format 1 — tempo, chords, melody — once a
  melody exists.
- **The soundfont preloads.** `AudioEngine` split into `preload()` (fetch/decode, no
  user gesture) and `init()` (preload plus the gesture-gated `resume()`).
  `useAudioEngine` fires `preload()` on mount; `SoundOverlay` blocks the UI until it
  resolves, with a dismissible failure branch so a dead soundfont doesn't lock the
  user out of MIDI and export.
- **Stop is immediate.** `playProgression` hands smplr a whole bar of timestamped
  notes at once, and smplr's `stop()` only releases *started* voices, so the rest of
  the bar kept playing. `AudioEngine.stopAll` now clears smplr's scheduler queue
  first.

**Melody**

- **The lane** (`theory/melody.ts` + `ui/MelodyLane`). Pitches are stored relative to
  the tonic, so a key change transposes the melody with the progression; notes are
  monophonic and variable-length on a 1/8 or 1/16 grid. Rows are tinted by what each
  pitch means against the chord in that bar, and hovering a bar — in the lane or its
  tile above — resolves the whole lane to that chord in three tiers (its tones, other
  scale tones in grey, off-scale pushed back). Gestures: drag to draw a note as long
  as the drag, drag to move, drag the right edge to lengthen, **Alt**-click or
  Alt-drag a box to delete. Note names sit in a fixed gutter whose keys are clickable
  to audition.
- **The generator** (`theory/generate.ts`) is a rule engine, not a model — the corpus
  is chords only — but its pitch scoring is a port of Temperley's RPK model (range x
  proximity x Essen key profiles) into log space, with the harmony and rhythm rules
  RPK doesn't cover layered on top. Lines are capped near Essen's 13.6-semitone
  average span, move by step ~80% of the time, and are deliberately sparse. One
  `surprise` knob unlocks liberties in stages against a per-phrase budget, and every
  decision is hash-addressed by (seed, bar, step, class), so moving the slider morphs
  the melody rather than rerolling it. The header comment records which rules are
  deliberately *absent* and why (post-skip reversal falls out of tessitura).

**Interaction fixes**

- Grid columns are fixed-width, so slots line up with the strip tiles above.
- Grid drag/drop no longer double-animates: slot ids are positional, so dnd-kit's
  layout animation was replaying the reorder the drag preview had already shown.

**Known gaps for next time**

- The melody voice is the same sampled piano as the chords; only its channel and
  level are separate. A different instrument for the lead means a second soundfont.
- Per-slot arpeggio overrides don't exist — the pattern is global to the transport.
- `.mid` export is still one chord per bar of 4/4; the IR could express more.
- Everything from the older list below still stands: vendored soundfont and fonts,
  `chordName` key context, the 15k-song model, and the M0 hardware spikes.

## Commands

```bash
npm run dev                # dev server
npx vitest run             # 228 tests
npx tsc --noEmit           # typecheck
npm run build              # production build
cd data && uv run pytest -q # 20 pipeline tests
cd data && uv run python scripts/validate_billboard.py   # key estimator accuracy
cd data && uv run python -m tp_data.pipeline --sample-size 0   # full corpus, ~37 min
```
