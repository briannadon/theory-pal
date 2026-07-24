// Note spelling: turns a (pitch class, quality) pair into a musically sensible
// letter name, e.g. "Eb" rather than "D#" for a minor triad's root in flat
// contexts. `chordName` takes no key, so the enharmonic choice for the 5
// "black key" pitch classes (1, 3, 6, 8, 10) is driven entirely by the chord's
// own quality: a fixed table modeled on real key-signature usage frequency
// (e.g. Eb minor is common, D# minor is not; C# minor is common, Db minor is
// not). Natural pitch classes (0,2,4,5,7,9,11) always spell as C/D/E/F/G/A/B
// and never consult these tables.
import { isMinorish, QUALITY_INTERVALS, type AbsChord, type ChordQuality, type PitchClass } from './chords.ts';

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// true = spell this pitch class with a flat when the chord is major-ish.
const MAJOR_PREFERS_FLAT = [
  false, // 0 C
  true, // 1 Db
  false, // 2 D
  true, // 3 Eb
  false, // 4 E
  false, // 5 F
  false, // 6 F#
  false, // 7 G
  true, // 8 Ab
  false, // 9 A
  true, // 10 Bb
  false, // 11 B
];

// true = spell this pitch class with a flat when the chord is minor-ish.
// Differs from the major table at 1 (C#m, not Dbm) and 8 (G#m, not Abm),
// matching common minor-key usage (C# minor / G# minor are common; Db minor /
// Ab minor are rare and only ever seen as enharmonic respellings).
const MINOR_PREFERS_FLAT = [
  false, // 0 C
  false, // 1 C#
  false, // 2 D
  true, // 3 Eb
  false, // 4 E
  false, // 5 F
  false, // 6 F#
  false, // 7 G
  false, // 8 G#
  false, // 9 A
  true, // 10 Bb
  false, // 11 B
];

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

export function noteName(pc: PitchClass, quality: ChordQuality): string {
  const p = mod12(pc);
  const preferFlat = isMinorish(quality) ? MINOR_PREFERS_FLAT[p] : MAJOR_PREFERS_FLAT[p];
  return preferFlat ? FLAT_NAMES[p] : SHARP_NAMES[p];
}

// Chord-symbol suffix for each v1 quality, e.g. Cmaj7, C#m7, Cm7b5, Cdim7, C+, Csus4.
const CHORD_SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: '+',
  maj7: 'maj7',
  min7: 'm7',
  dom7: '7',
  m7b5: 'm7b5',
  dim7: 'dim7',
  minMaj7: 'm(maj7)',
  sus2: 'sus2',
  sus4: 'sus4',
  dom7sus4: '7sus4',
};

export function chordName(c: AbsChord): string {
  const root = noteName(c.root, c.quality);
  const base = `${root}${CHORD_SUFFIX[c.quality]}`;
  if (!c.inversion) return base;
  const intervals = QUALITY_INTERVALS[c.quality];
  const bassOffset = intervals[c.inversion % intervals.length];
  const bassPc = mod12(c.root + bassOffset);
  if (bassPc === c.root) return base;
  return `${base}/${noteName(bassPc, c.quality)}`;
}
