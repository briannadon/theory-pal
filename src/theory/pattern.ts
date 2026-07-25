// Span rendering: a voiced chord plus a playing style -> the individual notes
// that actually sound, with their positions inside the span the chord is held
// for. That span is usually a bar, but chords carry their own lengths, so it
// is just as often three beats or half of one.
//
// This is the intermediate representation everything downstream shares.
// Before it existed, `audio/playback.ts` hardcoded "hit the whole chord on
// every beat" inside its scheduler callback and `midi/export.ts` separately
// re-derived its own note timings, so neither could express a rhythm. Now
// both call `renderBar`, which means anything audible is also exportable, and
// a new style (arpeggios here, melody lines later) is added in one place.
//
// Beats, not seconds: the caller owns tempo. `startBeat` is relative to the
// start of the span itself.
import type { VoicedChord } from './voicing.ts';

export interface NoteEvent {
  note: number; // MIDI note number
  startBeat: number; // beats from the start of the span
  durationBeats: number;
  velocity: number; // 0-127
}

/** Order the chord's notes are walked in. Two entries aren't arpeggios at all:
 * `block` strikes the whole chord on every beat (the v1 playback behavior) and
 * `sustain` holds it for the whole span (what `.mid` export has always
 * written). Both live here so every consumer has one rendering path. */
export type ArpPattern = 'sustain' | 'block' | 'up' | 'down' | 'updown' | 'downup' | 'random';

/** Note rate as a fraction of a beat: 1 = quarter, 0.5 = eighth, and so on. */
export type ArpRate = '1/4' | '1/8' | '1/16' | '1/8t' | '1/16t';

const RATE_BEATS: Record<ArpRate, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/16': 0.25,
  '1/8t': 1 / 3,
  '1/16t': 1 / 6,
};

export interface BarStyle {
  pattern: ArpPattern;
  rate: ArpRate;
  /** How many octaves the pattern spans; 1 = the voicing as-is. */
  octaves?: number;
  /** Fraction of the step each note sounds for (0-1]. */
  gate?: number;
  velocity?: number;
}

export const DEFAULT_BAR_STYLE: BarStyle = { pattern: 'block', rate: '1/4' };

const DEFAULT_GATE = 0.85;
const DEFAULT_VELOCITY = 100;
const DEFAULT_OCTAVES = 1;

/** The note pool a pattern walks: the voicing, stacked up `octaves` times. */
function pool(chord: VoicedChord, octaves: number): number[] {
  const notes: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const n of chord.notes) notes.push(n + 12 * o);
  }
  return notes;
}

/** Pattern order over `n` notes, as indices into the ascending pool. `updown`
 * and `downup` don't repeat the turning-point notes, so a 3-note chord cycles
 * 0,1,2,1 rather than 0,1,2,2,1,0 — the standard arpeggiator behavior. */
function order(pattern: ArpPattern, n: number): number[] {
  const up = Array.from({ length: n }, (_, i) => i);
  switch (pattern) {
    case 'down':
      return up.slice().reverse();
    case 'updown':
      return n <= 2 ? up : [...up, ...up.slice(1, -1).reverse()];
    case 'downup': {
      const down = up.slice().reverse();
      return n <= 2 ? down : [...down, ...down.slice(1, -1).reverse()];
    }
    default:
      return up;
  }
}

/**
 * The notes a single span of `chord` produces under `style`.
 *
 * `spanBeats` is how long the chord is held — a whole bar in the simple case,
 * but chords carry their own rhythm now (see `ui/logic/grid.ts`), so this is
 * also 3 beats, or half of one. Nothing here assumes a bar: every pattern
 * fills the span it is given and no event runs past its end, so a 1-beat stab
 * is a 1-beat stab in every sink that renders it.
 *
 * `block` reproduces the original playback exactly: the full chord struck on
 * every beat, each note held for `gate` of a beat. Arpeggio patterns walk the
 * voicing one note per step at `rate`, cycling until the span is full — a span
 * shorter than one step still gets a single note rather than silence.
 *
 * `random` needs an `rng` for reproducibility (the caller owns seeding, as
 * `model/surprise` already does); without one it falls back to `up`.
 */
export function renderBar(
  chord: VoicedChord,
  style: BarStyle,
  spanBeats: number,
  rng?: () => number,
): NoteEvent[] {
  if (chord.notes.length === 0 || spanBeats <= 0) return [];

  const gate = style.gate ?? DEFAULT_GATE;
  const velocity = style.velocity ?? DEFAULT_VELOCITY;

  if (style.pattern === 'sustain') {
    return chord.notes.map((note) => ({
      note,
      startBeat: 0,
      durationBeats: spanBeats,
      velocity,
    }));
  }

  if (style.pattern === 'block') {
    const events: NoteEvent[] = [];
    for (let b = 0; b < spanBeats; b++) {
      // The gate applies to whatever is left of the span, so a half-beat stab
      // is a gated half-beat rather than a note that outlives its own chord.
      const durationBeats = Math.min(1, spanBeats - b) * gate;
      for (const note of chord.notes) {
        events.push({ note, startBeat: b, durationBeats, velocity });
      }
    }
    return events;
  }

  const notes = pool(chord, Math.max(1, style.octaves ?? DEFAULT_OCTAVES));
  const stepBeats = RATE_BEATS[style.rate];
  const steps = Math.max(1, Math.floor(spanBeats / stepBeats + 1e-9));
  const seq = order(style.pattern, notes.length);

  const events: NoteEvent[] = [];
  for (let s = 0; s < steps; s++) {
    const index =
      style.pattern === 'random' && rng
        ? Math.min(notes.length - 1, Math.floor(rng() * notes.length))
        : seq[s % seq.length];
    const startBeat = s * stepBeats;
    events.push({
      note: notes[index],
      startBeat,
      durationBeats: Math.min(stepBeats, spanBeats - startBeat) * gate,
      velocity,
    });
  }
  return events;
}
