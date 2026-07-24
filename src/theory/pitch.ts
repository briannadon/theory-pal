// Note spelling: turns a (pitch class, quality) pair into a musically sensible
// letter name, e.g. "Eb" rather than "D#" for a minor triad's root in flat
// contexts. `chordName` takes no key, so the enharmonic choice for the 5
// "black key" pitch classes (1, 3, 6, 8, 10) is driven entirely by the chord's
// own quality: a fixed table modeled on real key-signature usage frequency
// (e.g. Eb minor is common, D# minor is not; C# minor is common, Db minor is
// not). Natural pitch classes (0,2,4,5,7,9,11) always spell as C/D/E/F/G/A/B
// and never consult these tables.
import {
  chordIntervals,
  chordShape,
  isMinorish,
  type AbsChord,
  type ChordMods,
  type ChordQuality,
  type PitchClass,
} from './chords.ts';

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

// Chord-symbol suffix for a *modified* chord, built from its shape rather
// than looked up: sus × seventh × ninth is far too many combinations to
// tabulate, and all of them follow the same handful of naming conventions.
// A sus chord has no third, so the third-quality marker ("m") is dropped —
// a sus4'd min7 is 7sus4, not m7sus4.
function moddedSuffix(quality: ChordQuality, mods: ChordMods): string {
  const { third, seventh, ninth } = chordShape(quality, mods);

  if (third === 'sus2' || third === 'sus4') {
    const sus = third;
    if (seventh && ninth) return `${seventh === 'maj7' ? 'maj9' : seventh === 'bb7' ? 'dim9' : '9'}${sus}`;
    if (seventh) return `${seventh === 'maj7' ? 'maj7' : seventh === 'bb7' ? 'dim7' : '7'}${sus}`;
    if (ninth) return `${sus}add9`;
    return sus;
  }

  const base = CHORD_SUFFIX[quality];
  if (!ninth) return base;
  // A 9th over a 7th absorbs it into the chord's name (Cmaj7 + 9 = Cmaj9);
  // a 9th without one is an added tone (C + 9 = Cadd9).
  if (!seventh) return `${base}add9`;
  return NINTH_SUFFIX[quality] ?? `${base}add9`;
}

// 7th quality -> the name it takes once a 9th is stacked on top.
const NINTH_SUFFIX: Partial<Record<ChordQuality, string>> = {
  maj7: 'maj9',
  dom7: '9',
  min7: 'm9',
  m7b5: 'm9b5',
  dim7: 'dim7add9', // no conventional "dim9"; the added tone is spelled out
  minMaj7: 'm(maj9)',
  dom7sus4: '9sus4',
};

export function chordName(c: AbsChord): string {
  const root = noteName(c.root, c.quality);
  const suffix = c.mods ? moddedSuffix(c.quality, c.mods) : CHORD_SUFFIX[c.quality];
  const base = `${root}${suffix}`;
  if (!c.inversion) return base;
  const intervals = chordIntervals(c.quality, c.mods);
  const bassOffset = intervals[c.inversion % intervals.length];
  const bassPc = mod12(c.root + bassOffset);
  if (bassPc === c.root) return base;
  return `${base}/${noteName(bassPc, c.quality)}`;
}
