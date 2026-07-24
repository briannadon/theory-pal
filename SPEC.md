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
// Base vocabulary — closed. Extensions do NOT add members here: sus x seventh x
// ninth would be 12 spellings per degree. They ride alongside as `mods` (below),
// which `stateKey` ignores, so the trained model never sees them.

/** Alterations layered on a base quality. `sus` replaces the third; `ninth`
 * adds a 9th. Note "add the 7th" is not a mod — it means the degree's
 * *diatonic* 7th, which only the key knows, so callers pick the 7th quality
 * from `diatonicChords(key, true)` instead. */
export interface ChordMods { sus?: 2 | 4; ninth?: boolean; }

/** A chord's makeup after mods, in the terms name renderers care about. */
export interface ChordShape {
  third: 'maj' | 'min' | 'sus2' | 'sus4' | 'none';
  seventh: 'maj7' | 'b7' | 'bb7' | null;
  ninth: boolean;
}

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
export interface RelChord { degree: number; quality: ChordQuality; mods?: ChordMods; } // degree = 0-11 semitones above tonic

/** Chord in absolute space — display and sound. */
export interface AbsChord { root: PitchClass; quality: ChordQuality; inversion?: number; mods?: ChordMods; }

export function stateKey(c: RelChord): string;              // "10:maj"; IGNORES mods by design
export function parseStateKey(k: string): RelChord;
export function toAbsolute(c: RelChord, key: Key): AbsChord;   // carries mods through
export function toRelative(c: AbsChord, key: Key): RelChord;   // carries mods through
export function chordName(c: AbsChord): string;             // "C#m7", "Cmaj9", "G9sus4", spelling-aware
export function romanNumeral(c: RelChord, key: Key): string; // "bVII", "iv", "V7", "ii9", "Iadd9"
export function isDiatonic(c: RelChord, key: Key): boolean;  // base quality only; UI marks false with accent color
export function diatonicChords(key: Key, sevenths?: boolean): RelChord[]; // 7 chords, top strip
export function chordPitches(c: AbsChord): PitchClass[];

/** Semitone offsets with `mods` applied — the single source of truth for what a
 * modified chord *is*. Unmodified chords return QUALITY_INTERVALS[quality]
 * unchanged. Every consumer (pitches, voicing, both name renderers) derives
 * from this rather than reading QUALITY_INTERVALS directly. */
export function chordIntervals(quality: ChordQuality, mods?: ChordMods): number[];
/** The chord's makeup in naming terms, so name renderers don't each re-derive
 * "does this still have a third?" from raw intervals. */
export function chordShape(quality: ChordQuality, mods?: ChordMods): ChordShape;

/** Bar rendering: the shared note-event IR. Playback and .mid export both go
 * through `renderBar`, so anything audible is exportable and a new playing
 * style is added in exactly one place. Beats, not seconds — the caller owns
 * tempo; `startBeat` is relative to its own bar. */
export interface NoteEvent { note: number; startBeat: number; durationBeats: number; velocity: number; }
export type ArpPattern = 'sustain' | 'block' | 'up' | 'down' | 'updown' | 'downup' | 'random';
export type ArpRate = '1/4' | '1/8' | '1/16' | '1/8t' | '1/16t';
export interface BarStyle { pattern: ArpPattern; rate: ArpRate; octaves?: number; gate?: number; velocity?: number; }
export function renderBar(c: VoicedChord, style: BarStyle, beatsPerBar: number, rng?: () => number): NoteEvent[];

/** Melody lane. Pitches are semitones above the TONIC, like chord degrees, so
 * a key change transposes the melody with the progression; time is in lane
 * steps, and `melodyToBars` is the only place that converts to beats. */
export interface MelodyNote { pitch: number; start: number; length: number; velocity?: number; }
export interface MelodyLane { stepsPerBar: 8 | 16; notes: MelodyNote[]; }
export function melodyToBars(lane: MelodyLane, key: Key, barCount: number, beatsPerBar?: number): (NoteEvent[] | null)[];
export function melodyRowKind(pitch: number, chord: RelChord | null, key: Key): 'chord' | 'scale' | 'off';
// plus lane editing helpers: addMelodyNote (monophonic — trims overlaps),
// removeMelodyNote, setMelodyResolution, clampMelody, emptyMelody.

/** Procedural melody generation. Not a trained model — the corpus is chords
 * only — but not invented either: pitch scoring ports Temperley's RPK model
 * (Range x Proximity x Key profiles, fit to the Essen Folksong Collection) into
 * log space, so each factor is one penalty term. Harmony and rhythm sit on top,
 * since RPK models neither. Lines are capped near Essen's average 13.6-semitone
 * span. `surprise` (0-1) unlocks rule violations in stages, spending a
 * per-phrase budget; `seed` makes it reproducible, and decisions are
 * hash-addressed so moving the slider morphs the same melody rather than
 * rerolling a new one. */
export function generateMelody(opts: {
  slots: readonly (RelChord | null)[]; key: Key; stepsPerBar: 8 | 16;
  surprise?: number; seed?: number; lowPitch?: number; highPitch?: number;
}): MelodyLane;

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

export async function loadModel(url?: string): Promise<TransitionModel | null>;
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
  preload(): Promise<void>;              // fetch/decode samples; NO user gesture needed
  init(): Promise<void>;                 // preload() + the gesture-gated context resume()
  playChord(notes: number[], durationSec?: number, velocity?: number): void;
  playAt(notes: number[], whenSec: number, durationSec: number, velocity?: number): void;
  stopAll(): void;                       // silence sounding voices AND drop queued ones
  setEnabled(on: boolean): void;         // internal-piano bypass toggle
  readonly currentTime: number;          // AudioContext.currentTime
}
```
Two-phase startup: decoding samples does not need a running AudioContext, so the
multi-second download starts on mount (the UI gates interaction until it resolves)
and only `resume()` waits for a user gesture. `stopAll` must also clear the
instrument's own scheduler queue — `playAt` schedules a whole bar ahead, and
releasing only started voices would let the rest of the bar play out after Stop.
Lookahead scheduler (25ms timer tick, 100ms schedule-ahead window) for playback; never
`setTimeout` alone for note timing.

`playProgression` additionally takes `style?: BarStyle` (how each bar's chord is played)
and `melody?: (NoteEvent[] | null)[]` (lead notes per bar). Both resolve through
`renderBar` into one flat event list per bar, so chords and melody are scheduled from a
single timeline and cannot drift apart.

## `src/midi/`

```ts
export interface MidiPort {
  id: string;
  name: string;
  manufacturer?: string;
}
export interface MidiOut {
  requestAccess(): Promise<MidiPort[]>;  // called on user action ONLY, never on page load
  selectPort(id: string): void;
  // whenMs is optional: a performance.now()-timebase timestamp, forwarded to
  // Web MIDI's own timestamped send() so a shared audio+MIDI scheduler (see
  // `src/audio/playback.ts`) can schedule both sinks precisely from one
  // timeline. Omitted, notes send as soon as possible.
  sendChord(notes: number[], durationMs: number, velocity?: number, whenMs?: number): void;
  stopAll(): void;                       // MIDI panic: silence the selected output now
  readonly available: boolean;
}
export function exportMidiFile(
  bars: (AbsChord|null)[], bpm: number,
  opts?: { style?: BarStyle; melody?: (NoteEvent[] | null)[] },   // defaults to whole-bar chords
): Blob; // SMF format 0
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
