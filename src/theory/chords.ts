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
 * quality union combinatorially (sus × seventh × ninth × eleventh × thirteenth
 * is dozens of spellings *per degree*) instead ride alongside it, so the union
 * — and every model state key built from it — is unchanged. `stateKey`
 * deliberately ignores this field: a sus4'd, 13th-stacked V is the model's
 * plain V.
 *
 * Every flag is independent, including sus2 and sus4: both replace the third,
 * and having both gives the 2nd *and* the 4th over the fifth, which is a real
 * (if uncommon) sonority rather than a contradiction.
 *
 * The seventh is *not* a modifier: "add the 7th" means the degree's diatonic
 * 7th (V -> dom7, I -> maj7), which only the key knows, so it is a change of
 * `quality` — see `withSeventh`.
 */
export interface ChordMods {
  sus2?: boolean;
  sus4?: boolean;
  /** A 6th *inside* the chord (C6 = C E G A), as opposed to a 13th above a
   * seventh. Same pitch class, different chord: which one it is depends on
   * whether a seventh is present, and the namers use exactly that. */
  sixth?: boolean;
  ninth?: boolean;
  eleventh?: boolean;
  thirteenth?: boolean;
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
const SIXTH_INTERVAL = 9;
const NINTH_INTERVAL = 14;
const ELEVENTH_INTERVAL = 17;
const THIRTEENTH_INTERVAL = 21;

function hasMods(mods?: ChordMods): mods is ChordMods {
  return (
    !!mods &&
    (!!mods.sus2 ||
      !!mods.sus4 ||
      !!mods.sixth ||
      !!mods.ninth ||
      !!mods.eleventh ||
      !!mods.thirteenth)
  );
}

/**
 * The chord's semitone offsets from the root, with `mods` applied: the single
 * source of truth for what a modified chord actually *is*. sus drops the third
 * (3 or 4) and substitutes a 2nd, a 4th, or both, leaving the fifth and any
 * seventh alone — so a sus4'd dom7 is the familiar 7sus4, and a sus4'd maj7 is
 * maj7sus4. The extensions append a 9th, 11th and 13th above the octave, each
 * skipped when the chord already contains that pitch class (sus2 *is* the 9th
 * an octave down, and sus4 the 11th).
 *
 * Unmodified chords return `QUALITY_INTERVALS[quality]` unchanged, so every
 * caller that predates modifiers behaves exactly as before.
 */
export function chordIntervals(quality: ChordQuality, mods?: ChordMods): number[] {
  const base = QUALITY_INTERVALS[quality];
  if (!hasMods(mods)) return base;

  let intervals = base;
  if (mods.sus2 || mods.sus4) {
    const substitutes = [...(mods.sus2 ? [2] : []), ...(mods.sus4 ? [5] : [])];
    intervals = [...substitutes, ...intervals.filter((i) => !THIRD_INTERVALS.has(i))].sort(
      (a, b) => a - b,
    );
  }
  const extensions: [boolean | undefined, number][] = [
    [mods.sixth, SIXTH_INTERVAL],
    [mods.ninth, NINTH_INTERVAL],
    [mods.eleventh, ELEVENTH_INTERVAL],
    [mods.thirteenth, THIRTEENTH_INTERVAL],
  ];
  for (const [on, interval] of extensions) {
    if (on && !intervals.some((i) => mod12(i) === mod12(interval))) {
      intervals = [...intervals, interval];
    }
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
  third: 'maj' | 'min' | 'sus2' | 'sus4' | 'sus2/4' | 'none';
  /** Seventh flavor: major 7th, minor/flat 7th, diminished (bb) 7th, or none. */
  seventh: 'maj7' | 'b7' | 'bb7' | null;
  sixth: boolean;
  ninth: boolean;
  eleventh: boolean;
  thirteenth: boolean;
}

export function chordShape(quality: ChordQuality, mods?: ChordMods): ChordShape {
  const intervals = chordIntervals(quality, mods);
  const has = (i: number) => intervals.includes(i);

  let third: ChordShape['third'] = 'none';
  if (has(4)) third = 'maj';
  else if (has(3)) third = 'min';
  else if (has(2) && has(5)) third = 'sus2/4';
  else if (has(2)) third = 'sus2';
  else if (has(5)) third = 'sus4';

  // The seventh comes from the *base quality*, not from the interval set: a
  // 6th sits 9 semitones up, exactly where dim7 puts its bb7, so reading the
  // interval set alone would turn every C6 into a diminished 7th chord.
  const base = QUALITY_INTERVALS[quality];
  const seventh: ChordShape['seventh'] = base.includes(11)
    ? 'maj7'
    : base.includes(10)
      ? 'b7'
      : base.includes(9)
        ? 'bb7'
        : null;

  return {
    third,
    seventh,
    sixth: seventh !== 'bb7' && has(SIXTH_INTERVAL),
    ninth: has(NINTH_INTERVAL),
    eleventh: has(ELEVENTH_INTERVAL),
    thirteenth: has(THIRTEENTH_INTERVAL),
  };
}

/**
 * How a chord's extensions are *spelled*, which is not the same as which ones
 * it contains. Lead-sheet convention names the top of an unbroken stack above
 * the seventh and lets the ones below it be implied — C-E-G-Bb-D-F-A is C13,
 * not "C7 with a 9th, an 11th and a 13th" — while an extension that doesn't
 * continue the stack is called out as an added tone. Both name renderers need
 * exactly this split, so it lives here rather than being derived twice.
 *
 * `stack` is the number that replaces the 7 in the chord symbol (9, 11 or 13);
 * `added` lists the extensions that have to be named separately.
 */
export function extensionSpelling(shape: ChordShape): {
  stack: 9 | 11 | 13 | null;
  added: (9 | 11 | 13)[];
  /** True when the 6th should be spelled as a 6th (C6, Cm6, C6/9) rather than
   * folded into a 13th, i.e. when there is no seventh under it. */
  sixth: boolean;
} {
  const { seventh, ninth, eleventh } = shape;
  // Over a seventh, a 6th *is* the 13th — same tone, and "C7 add 6" is not how
  // anyone writes C13.
  const thirteenth = shape.thirteenth || (!!seventh && shape.sixth);
  if (!seventh) {
    // No seventh, so nothing to extend: every extension is an added tone.
    const added: (9 | 11 | 13)[] = [];
    if (ninth) added.push(9);
    if (eleventh) added.push(11);
    if (thirteenth) added.push(13);
    return { stack: null, added, sixth: shape.sixth };
  }

  // The stack has to be unbroken from the seventh upward. A 13th chord
  // conventionally implies (and usually omits) the 11th, so a 9th plus a 13th
  // still spells 13.
  let stack: 9 | 11 | 13 | null = null;
  if (ninth && thirteenth) stack = 13;
  else if (ninth && eleventh) stack = 11;
  else if (ninth) stack = 9;

  const covered = new Set<number>();
  if (stack !== null) {
    covered.add(9);
    if (stack >= 11) covered.add(11);
    if (stack >= 13) covered.add(13);
  }

  const added: (9 | 11 | 13)[] = [];
  if (ninth && !covered.has(9)) added.push(9);
  if (eleventh && !covered.has(11)) added.push(11);
  if (thirteenth && !covered.has(13)) added.push(13);
  return { stack, added, sixth: false };
}

// Triad quality -> the 7th chord built on it when the key has no opinion,
// i.e. for chords that aren't diatonic to the current key. Major triads take a
// dominant 7th, which is what a borrowed bVII or a secondary dominant wants;
// aug is absent because no v1 quality has an augmented triad with a seventh.
const TRIAD_TO_SEVENTH: Partial<Record<ChordQuality, ChordQuality>> = {
  maj: 'dom7',
  min: 'min7',
  dim: 'm7b5',
  sus2: 'sus2', // sus qualities carry their seventh via dom7sus4 below
  sus4: 'dom7sus4',
};

// The inverse: strip the seventh back off.
const SEVENTH_TO_TRIAD: Partial<Record<ChordQuality, ChordQuality>> = {
  maj7: 'maj',
  dom7: 'maj',
  min7: 'min',
  m7b5: 'dim',
  dim7: 'dim',
  minMaj7: 'min',
  dom7sus4: 'sus4',
};

export function hasSeventh(quality: ChordQuality): boolean {
  return quality in SEVENTH_TO_TRIAD;
}

/**
 * The chord with a seventh added. Which seventh depends on the key: in C, the
 * V takes a dominant 7th and the I a major 7th, and only the key knows that —
 * which is why "add the 7th" is a change of quality rather than a `ChordMods`
 * flag. Chords the key has no diatonic 7th for (borrowed, chromatic) fall back
 * to the seventh their triad implies. Returns the chord unchanged when its
 * quality has no representable 7th (aug) or already has one.
 */
export function withSeventh(chord: RelChord, key: Key): RelChord {
  if (hasSeventh(chord.quality)) return chord;
  // The key's own 7th for this degree, but only when it is built on the same
  // triad: C major's I is a maj7, yet an *augmented* chord on degree 0 must
  // not silently become one — that would change its fifth, not add a seventh.
  const diatonic = diatonicChords(key, true).find(
    (c) =>
      c.degree === mod12(chord.degree) &&
      hasSeventh(c.quality) &&
      withoutSeventh(c).quality === chord.quality,
  );
  const quality = diatonic ? diatonic.quality : TRIAD_TO_SEVENTH[chord.quality];
  if (!quality || quality === chord.quality) return chord;
  return { ...chord, quality };
}

/** The chord with its seventh removed, back to the underlying triad. */
export function withoutSeventh(chord: RelChord): RelChord {
  const quality = SEVENTH_TO_TRIAD[chord.quality];
  return quality ? { ...chord, quality } : chord;
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
