# theory-pal handoff

State as of 2026-07-24. Read this with PLAN.md (scope and rationale) and SPEC.md (the
interface contract every module builds against). The bulk of this file describes the
first build session (2026-07-23); "Session 2" below records what changed after it.

Repo: https://github.com/briannadon/theory-pal, deployed at
https://briannadon.github.io/theory-pal/ (currently still serving the Vite scaffold,
see "Where the UI left off").

## Where things stand

M0 through M3 are done except for the spikes that need the user's hardware and the UI
wiring. 190 tests pass, `npx tsc --noEmit` is clean, and the deploy pipeline is green
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

Four changes, all committed and pushed to `master`:

- **In-key modifiers replace the family selector.** Triads/7ths/Sus became four
  stackable toggles: sus2 and sus4 (mutually exclusive — both replace the third), 7,
  and 9, freely combined. The quality union stayed closed; alterations ride alongside
  it as `RelChord.mods` (`ChordMods` in SPEC.md), which `stateKey` ignores, so the
  trained model is untouched and `model/` needed no changes at all. `chordIntervals`
  is now the single source of truth for a chord's tones; `chordPitches`, `voiceChord`,
  `chordName`, and `romanNumeral` all derive from it, with an identity fast path that
  leaves unmodified chords byte-identical. The 7 toggle is deliberately *not* a mod:
  it means the degree's diatonic 7th, so it selects `diatonicChords(key, true)`.
  Modifiers exist on the strip only — a chord freezes as-is when dropped in the grid.
- **The soundfont preloads.** `AudioEngine` split into `preload()` (fetch/decode, no
  user gesture) and `init()` (preload plus the gesture-gated `resume()`).
  `useAudioEngine` fires `preload()` on mount and exposes a load status;
  `SoundOverlay` blocks the UI until it resolves, with a dismissible failure branch so
  a dead soundfont doesn't lock the user out of MIDI and export.
- **Stop is immediate.** `playProgression` hands smplr a whole bar of timestamped
  notes at once, and smplr's `stop()` only releases *started* voices, so the rest of
  the bar kept playing after Stop. `AudioEngine.stopAll` now clears smplr's scheduler
  queue first.
- **Grid drag/drop no longer double-animates.** Slot ids are positional, so dnd-kit's
  default layout animation replayed the reorder the drag preview had already shown;
  `animateLayoutChanges: () => false` on the sortable settles it in place.

- **Arpeggios, a melody lane, and a melody generator.** `theory/pattern.ts` introduces
  the `NoteEvent` IR every playing style resolves to; `playProgression` and
  `exportMidiFile` both render through `renderBar`, so audible and exported material
  can no longer diverge (export keeps its historical whole-bar chords via the
  `sustain` pattern). `theory/melody.ts` holds the lane model — pitches relative to
  the tonic, monophonic, variable-length notes on a 1/8 or 1/16 grid — and
  `theory/generate.ts` is a rule-engine melody generator with one `surprise` knob that
  unlocks liberties in stages against a per-phrase budget, hash-addressed per decision
  so the slider morphs a melody instead of rerolling it. UI: `MelodyLane` (rows tinted
  chord tone / scale tone / off-scale per bar, click to add, drag to move or lengthen,
  click to delete) and `MelodySection` (resolution, generate, surprise, clear).

Worth knowing for the next session: the melody plays through the same piano and the
same MIDI channel as the chords — there is no separate lead voice or channel yet, and
`.mid` export writes one format-0 track. Splitting them (format 1, channel 2) is the
obvious next step if the lead needs its own instrument.

Still unaddressed from the list above: vendored soundfont and self-hosted fonts,
`chordName` key context, the 15k-song model, and the M0 hardware spikes.

## Commands

```bash
npm run dev                # dev server
npx vitest run             # 190 tests
npx tsc --noEmit           # typecheck
npm run build              # production build
cd data && uv run pytest -q # 20 pipeline tests
cd data && uv run python scripts/validate_billboard.py   # key estimator accuracy
cd data && uv run python -m tp_data.pipeline --sample-size 0   # full corpus, ~37 min
```
