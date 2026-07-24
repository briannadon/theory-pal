import { getScale, type ScaleId } from './scales.ts';

export type PitchClass = number; // 0-11, 0 = C

// v1 vocabulary: triads (maj/min/dim/aug), 7ths (maj7/min7/dom7/m7b5/dim7/minMaj7),
// and sus chords (sus2/sus4/dom7sus4).
//
// Extensions (9/11/13/add9) land post-MVP as ADDITIONAL members of this union — do
// not renumber or repurpose existing members. Design intent for that migration:
// each extended quality (e.g. 'dom9') collapses onto one of the bases already here
// for every *model* state (transition-table lookups, `isDiatonic`, `diatonicChords`)
// so the Markov model never needs a schema break — a 'dom9' chord is stored/counted
// as 'dom7' for suggestion purposes. Only the voicing/audition layer (chordPitches /
// voiceChord) needs to know about the extra tone, by consulting a *separate*
// extension-interval table keyed by the extended quality and falling back to the
// base triad/7th intervals here when the quality is unrecognized. That keeps this
// file, and the QUALITY_INTERVALS table below, unchanged when extensions land.
export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'maj7'
  | 'min7'
  | 'dom7'
  | 'm7b5'
  | 'dim7'
  | 'minMaj7'
  | 'sus2'
  | 'sus4'
  | 'dom7sus4';

export interface Key {
  tonic: PitchClass;
  scale: ScaleId;
}

/** Chord in relative (roman) space — the model's currency. */
export interface RelChord {
  degree: number; // 0-11 semitones above tonic (chromatic; not a 1-7 scale-degree number)
  quality: ChordQuality;
}

/** Chord in absolute space — display and sound. */
export interface AbsChord {
  root: PitchClass;
  quality: ChordQuality;
  inversion?: number;
}

// Chord-tone semitone offsets from the root, ascending, for each v1 quality.
// This is the single source of truth for chord construction: classification
// (TRIAD_MAP/SEVENTH_MAP below), chordPitches, and the voicing engine all derive
// from it.
export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  minMaj7: [0, 3, 7, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dom7sus4: [0, 5, 7, 10],
};

// Qualities whose triad "color" is minor/diminished (drives roman-numeral case
// and chordName enharmonic spelling bias).
const MINOR_ISH: ReadonlySet<ChordQuality> = new Set([
  'min',
  'dim',
  'min7',
  'm7b5',
  'dim7',
  'minMaj7',
]);

export function isMinorish(quality: ChordQuality): boolean {
  return MINOR_ISH.has(quality);
}

// third,fifth (semitones from root) -> triad quality.
const TRIAD_MAP: Record<string, ChordQuality> = {
  '4,7': 'maj',
  '3,7': 'min',
  '3,6': 'dim',
  '4,8': 'aug',
};

// third,fifth,seventh (semitones from root) -> seventh-chord quality. Combos that
// fall outside the v1 vocabulary (e.g. an augmented triad with a major or minor
// 7th, which the vocabulary has no name for) are simply absent; diatonicChords
// falls back to the bare triad quality for those degrees.
const SEVENTH_MAP: Record<string, ChordQuality> = {
  '4,7,11': 'maj7',
  '4,7,10': 'dom7',
  '3,7,10': 'min7',
  '3,6,10': 'm7b5',
  '3,6,9': 'dim7',
  '3,7,11': 'minMaj7',
};

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

export function stateKey(c: RelChord): string {
  return `${mod12(c.degree)}:${c.quality}`;
}

export function parseStateKey(k: string): RelChord {
  const idx = k.indexOf(':');
  if (idx < 0) throw new Error(`Invalid state key: ${k}`);
  const degree = Number(k.slice(0, idx));
  const quality = k.slice(idx + 1) as ChordQuality;
  if (!Number.isInteger(degree) || !(quality in QUALITY_INTERVALS)) {
    throw new Error(`Invalid state key: ${k}`);
  }
  return { degree, quality };
}

export function toAbsolute(c: RelChord, key: Key): AbsChord {
  return { root: mod12(key.tonic + c.degree), quality: c.quality };
}

export function toRelative(c: AbsChord, key: Key): RelChord {
  return { degree: mod12(c.root - key.tonic), quality: c.quality };
}

export function chordPitches(c: AbsChord): PitchClass[] {
  const intervals = QUALITY_INTERVALS[c.quality];
  return intervals.map((i) => mod12(c.root + i));
}

/**
 * The 7 diatonic chords of a key, built by stacking thirds within the scale
 * (tertian harmony). `sevenths` selects triads (default) or 7th chords.
 */
export function diatonicChords(key: Key, sevenths = false): RelChord[] {
  const scale = getScale(key.scale);
  const ints = scale.intervals;
  const n = ints.length;
  const result: RelChord[] = [];
  for (let d = 0; d < n; d++) {
    const root = ints[d];
    const third = mod12(ints[(d + 2) % n] - root);
    const fifth = mod12(ints[(d + 4) % n] - root);
    const triadQuality = TRIAD_MAP[`${third},${fifth}`];
    let quality: ChordQuality | undefined = triadQuality;
    if (sevenths) {
      const seventh = mod12(ints[(d + 6) % n] - root);
      const seventhQuality = SEVENTH_MAP[`${third},${fifth},${seventh}`];
      if (seventhQuality) quality = seventhQuality;
      // else: fall back to the triad quality already assigned above.
    }
    if (!quality) {
      // Should not happen for any scale in the table (thirds/fifths always land
      // on 3/4 and 6/7/8), but fail loudly rather than silently mis-voice.
      throw new Error(
        `No chord quality for scale ${key.scale} degree ${d} (third=${third}, fifth=${fifth})`,
      );
    }
    result.push({ degree: mod12(root), quality });
  }
  return result;
}

/**
 * Whether `c` matches one of the key's naturally-occurring diatonic triads or
 * 7th chords (checked against whichever family its own quality belongs to). Sus
 * chords are never tertian-diatonic, so they always report false.
 */
export function isDiatonic(c: RelChord, key: Key): boolean {
  const quality = c.quality;
  if (quality === 'sus2' || quality === 'sus4' || quality === 'dom7sus4') return false;
  const isSeventh = quality in SEVENTH_MAP_QUALITIES;
  const set = isSeventh ? diatonicChords(key, true) : diatonicChords(key, false);
  const degree = mod12(c.degree);
  return set.some((rc) => rc.degree === degree && rc.quality === quality);
}

const SEVENTH_MAP_QUALITIES: Record<string, true> = {
  maj7: true,
  min7: true,
  dom7: true,
  m7b5: true,
  dim7: true,
  minMaj7: true,
};
