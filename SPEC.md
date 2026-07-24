# theory-pal shared interface spec

Authoritative contract between modules. Agents building `theory/`, `model/`, `audio/`,
`midi/`, `ui/`, and `data/` must conform to this file. If a module needs a change here,
change SPEC.md in the same commit and keep every consumer compiling.

See PLAN.md for scope and rationale. This file is only about types and boundaries.

## Core principle: relative, not absolute

The corpus model and the suggestion engine work entirely in **roman-numeral space**
(scale degree relative to tonic + quality). `I -> IV`, never `Cmaj -> Fmaj`. Absolute
note names exist only at the display and audio/MIDI boundaries.

## Canonical chord state key

A model state is a string, used as a JSON object key in the trained model file:

```
`${semitonesAboveTonic}:${quality}`   // "0:maj" = I, "10:maj" = bVII, "9:min7" = vi7
```

- `semitonesAboveTonic`: integer 0-11, pitch-class distance of the chord root above the
  tonic. Chromatic, so non-diatonic roots (bVII, bII, #IV) need no special case.
- `quality`: one of the `ChordQuality` strings below.

Roman-numeral rendering (`bVII`, `iv`, `V7`) is a display concern derived from
(semitone offset, quality, mode) in `theory/`. Never parse roman numeral strings as data.

## `src/theory/` — pure TS, no DOM, no React

```ts
export type PitchClass = number; // 0-11, 0 = C

export type ChordQuality =
  | 'maj' | 'min' | 'dim' | 'aug'
  | 'maj7' | 'min7' | 'dom7' | 'm7b5' | 'dim7' | 'minMaj7'
  | 'sus2' | 'sus4' | 'dom7sus4';
// v1 vocabulary. Extensions (9/11/13/add9) land post-MVP as ADDITIONAL members;
// the model collapses them onto these bases, so do not renumber or repurpose.

export type ScaleId =
  | 'ionian' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'aeolian' | 'locrian'
  | 'harmonicMinor' | 'melodicMinor'
  | ... // plus modes of harmonic/melodic minor, data-driven

export interface Scale {
  id: ScaleId;
  name: string;          // display, e.g. "Harmonic Minor"
  intervals: number[];   // semitones above tonic, ascending, length 7, starts at 0
}

export interface Key { tonic: PitchClass; scale: ScaleId; }

/** Chord in relative (roman) space — the model's currency. */
export interface RelChord { degree: number; quality: ChordQuality; } // degree = 0-11 semitones above tonic

/** Chord in absolute space — display and sound. */
export interface AbsChord { root: PitchClass; quality: ChordQuality; inversion?: number; }

export function stateKey(c: RelChord): string;              // "10:maj"
export function parseStateKey(k: string): RelChord;
export function toAbsolute(c: RelChord, key: Key): AbsChord;
export function toRelative(c: AbsChord, key: Key): RelChord;
export function chordName(c: AbsChord): string;             // "C#m7", spelling-aware
export function romanNumeral(c: RelChord, key: Key): string; // "bVII", "iv", "V7"
export function isDiatonic(c: RelChord, key: Key): boolean;  // UI marks false with accent color
export function diatonicChords(key: Key, sevenths?: boolean): RelChord[]; // 7 chords, top strip
export function chordPitches(c: AbsChord): PitchClass[];

/** Voicing: sequence of chords -> concrete MIDI notes, minimizing voice movement. */
export interface VoicedChord { notes: number[]; }            // MIDI note numbers, sorted
export function voiceProgression(
  chords: AbsChord[],
  opts?: { center?: number; low?: number; high?: number }    // defaults: center 60, low 48, high 84
): VoicedChord[];
export function voiceChord(c: AbsChord, prev?: VoicedChord, opts?): VoicedChord;
```

Fully unit-tested with vitest. No imports outside `theory/` except node builtins.

## Trained model file — `public/model/transitions.json`

Emitted by `data/`, fetched by `model/`. Gzip-served static asset.

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-23T00:00:00Z",
  "source": "Chordonomicon v2 (CC-BY-NC-4.0)",
  "songCount": 12345,
  "modes": {
    "ionian": {
      "order1": { "0:maj": { "5:maj": 1203, "7:maj": 980 } },   // raw counts, not probs
      "order2": { "0:maj>5:maj": { "7:maj": 410 } },            // prior states joined by ">"
      "totals1": { "0:maj": 4210 },
      "totals2": { "0:maj>5:maj": 900 }
    }
  }
}
```

Counts, not probabilities: `model/` applies its own smoothing and blending. Modes the
pipeline could not populate are simply absent, and `model/` falls back to the theory
prior for them.

## `src/model/` — pure TS, no DOM

```ts
export interface Suggestion {
  chord: RelChord;
  probability: number;   // 0-1, normalized over the returned list
  diatonic: boolean;
  fromCorpus: boolean;   // false = theory prior carried it
}

export interface SuggestParams { context: RelChord[]; key: Key; limit?: number; }

export async function loadModel(url?: string): Promise<TransitionModel>;
export function suggest(model: TransitionModel | null, p: SuggestParams): Suggestion[];
export function surprise(model: TransitionModel | null, p: SuggestParams, rng?: () => number): Suggestion | null;
export function theoryPrior(key: Key, context: RelChord[]): Map<string, number>;
```

- Order-2 with backoff to order-1 then to the theory prior.
- `score = corpusProb^a * priorProb^b`, corpus-confidence weighted; constants exported
  and tunable in one place.
- **Never** filter to diatonic chords. Borrowed chords, bVII, secondary dominants and
  modal mixture must be reachable.
- Works with `model === null` (prior only), so the UI functions before the model loads.

## `src/audio/`

```ts
export interface AudioEngine {
  init(): Promise<void>;                 // lazy; loads soundfont on first use
  playChord(notes: number[], durationSec?: number, velocity?: number): void;
  playAt(notes: number[], whenSec: number, durationSec: number, velocity?: number): void;
  stopAll(): void;
  setEnabled(on: boolean): void;         // internal-piano bypass toggle
  readonly currentTime: number;          // AudioContext.currentTime
}
```
Lookahead scheduler (25ms timer tick, 100ms schedule-ahead window) for playback; never
`setTimeout` alone for note timing.

## `src/midi/`

```ts
export interface MidiOut {
  requestAccess(): Promise<MidiPort[]>;  // called on user action ONLY, never on page load
  selectPort(id: string): void;
  sendChord(notes: number[], durationMs: number, velocity?: number): void;
  readonly available: boolean;
}
export function exportMidiFile(bars: (AbsChord|null)[], bpm: number): Blob; // SMF format 0
```
App must stay fully usable when MIDI access is denied.

## `src/ui/` — React

Consumes the above. No music theory logic in components; if a component needs a rule,
it belongs in `theory/`.

## `data/` — uv-managed Python, not shipped

Input: Chordonomicon. Output: `public/model/transitions.json`. Validate end-to-end on a
handful of songs before scaling.

### Key/mode estimation (the pipeline's hard part)

Chordonomicon ships chord symbols with no key annotation — confirm this against the real
HF dataset schema before assuming it. Estimation procedure:

1. **Chord-content profile matching.** Weight vector over the 12 pitch classes built from
   chord symbols: root weighted heaviest, other chord tones lower, scaled by occurrence
   count. Score all 12 tonics x each supported mode for fit.
2. **Tonic-disambiguation features**, since profile matching alone cannot separate
   relative keys (C ionian and A aeolian share a pitch-class set). Score contributions
   from: first and last chord, most frequent chord, section-final chords, presence of a
   major V or V7 (ionian / harmonic minor over aeolian), and mode-characteristic chords
   (major IV -> dorian vs minor iv -> aeolian; bII -> phrygian; #IV -> lydian).
3. **Soft assignment.** Keep the top 2-3 hypotheses with posterior weights and accumulate
   *fractional* transition counts across them, rather than committing to one label. Model
   counts become floats; nothing downstream cares.
4. **Per-section, not per-song.** Chordonomicon carries section tags (verse/chorus/etc.)
   and songs modulate. Estimate per section; do not count transitions across section
   boundaries.
5. **Validate against McGill Billboard** (expert key annotations) before the full run.
   Report tonic accuracy and mode accuracy. Under ~75% tonic accuracy on major/minor
   means the estimator needs work before spending a full-corpus run.
