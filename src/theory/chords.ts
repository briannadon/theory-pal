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

/**
 * Voicing modifiers layered on top of a base `ChordQuality`, the mechanism the
 * header comment above calls for: extensions that would otherwise multiply the
 * quality union combinatorially (sus × seventh × ninth is 12 spellings *per
 * degree*) instead ride alongside it, so the union — and every model state key
 * built from it — is unchanged. `stateKey` deliberately ignores this field: a
 * sus4'd, 9th-added V is the model's plain V.
 *
 * `sus` replaces the third with a 2nd or 4th; `ninth` adds a 9th above the
 * octave. The seventh is *not* a modifier: "add the 7th" is resolved at
 * build time by picking the degree's diatonic 7th quality (V -> dom7,
 * I -> maj7), which is information only the key knows.
 */
export interface ChordMods {
  sus?: 2 | 4;
  ninth?: boolean;
}

/** Chord in relative (roman) space — the model's currency. */
export interface RelChord {
  degree: number; // 0-11 semitones above tonic (chromatic; not a 1-7 scale-degree number)
  quality: ChordQuality;
  mods?: ChordMods;
}

/** Chord in absolute space — display and sound. */
export interface AbsChord {
  root: PitchClass;
  quality: ChordQuality;
  inversion?: number;
  mods?: ChordMods;
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
  return { root: mod12(key.tonic + c.degree), quality: c.quality, ...(c.mods && { mods: c.mods }) };
}

export function toRelative(c: AbsChord, key: Key): RelChord {
  return { degree: mod12(c.root - key.tonic), quality: c.quality, ...(c.mods && { mods: c.mods }) };
}

const THIRD_INTERVALS: ReadonlySet<number> = new Set([3, 4]);
const NINTH_INTERVAL = 14;

/**
 * The chord's semitone offsets from the root, with `mods` applied: the single
 * source of truth for what a modified chord actually *is*. `sus` drops the
 * third (3 or 4) and substitutes a 2nd or 4th, leaving the fifth and any
 * seventh alone — so a sus4'd dom7 is the familiar 7sus4, and a sus4'd maj7
 * is maj7sus4. `ninth` appends a 9th, skipped when the chord already contains
 * that pitch class (sus2 *is* the 9th, an octave down).
 *
 * Unmodified chords return `QUALITY_INTERVALS[quality]` unchanged, so every
 * caller that predates modifiers behaves exactly as before.
 */
export function chordIntervals(quality: ChordQuality, mods?: ChordMods): number[] {
  const base = QUALITY_INTERVALS[quality];
  if (!mods || (mods.sus === undefined && !mods.ninth)) return base;

  let intervals = base;
  if (mods.sus !== undefined) {
    const substitute = mods.sus === 2 ? 2 : 5;
    intervals = [substitute, ...intervals.filter((i) => !THIRD_INTERVALS.has(i))].sort(
      (a, b) => a - b,
    );
  }
  if (mods.ninth && !intervals.some((i) => mod12(i) === mod12(NINTH_INTERVAL))) {
    intervals = [...intervals, NINTH_INTERVAL];
  }
  return intervals;
}

export function chordPitches(c: AbsChord): PitchClass[] {
  return chordIntervals(c.quality, c.mods).map((i) => mod12(c.root + i));
}

/** What a (possibly modified) chord is made of, in naming terms. Both name
 * renderers — chord symbols in pitch.ts and roman numerals in roman.ts —
 * derive their suffix from this instead of each re-deriving "does this thing
 * still have a third?" from raw intervals. */
export interface ChordShape {
  third: 'maj' | 'min' | 'sus2' | 'sus4' | 'none';
  /** Seventh flavor: major 7th, minor/flat 7th, diminished (bb) 7th, or none. */
  seventh: 'maj7' | 'b7' | 'bb7' | null;
  ninth: boolean;
}

export function chordShape(quality: ChordQuality, mods?: ChordMods): ChordShape {
  const intervals = chordIntervals(quality, mods);
  const has = (i: number) => intervals.includes(i);

  let third: ChordShape['third'] = 'none';
  if (has(4)) third = 'maj';
  else if (has(3)) third = 'min';
  else if (has(2)) third = 'sus2';
  else if (has(5)) third = 'sus4';

  const seventh: ChordShape['seventh'] = has(11) ? 'maj7' : has(10) ? 'b7' : has(9) ? 'bb7' : null;

  return { third, seventh, ninth: has(NINTH_INTERVAL) };
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
