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
  extensionSpelling,
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

// Chord-symbol suffix for a *modified* chord, built from its shape rather than
// looked up: sus × seventh × ninth × eleventh × thirteenth is far too many
// combinations to tabulate, and all of them follow the same handful of naming
// conventions.
//
// Two of those conventions do the real work. A sus chord has no third, so the
// third-quality marker ("m") is dropped — a sus4'd min7 is 7sus4, not m7sus4.
// And an unbroken extension stack is named by its top note, with the ones
// below implied (C-E-G-Bb-D-F-A is C13), while anything that doesn't continue
// the stack is spelled out as an added tone. `extensionSpelling` decides that
// split; this function only has to render it.
function moddedSuffix(quality: ChordQuality, mods: ChordMods): string {
  const shape = chordShape(quality, mods);
  const { third, seventh } = shape;
  const { stack, added, sixth } = extensionSpelling(shape);
  // A 6th with a 9th over it is the standard "6/9" voicing; alone it is just
  // a 6th chord. (Over a seventh it has already become the 13th.)
  const sixthTag = sixth ? (shape.ninth ? '6/9' : '6') : '';

  const addedTag = (): string => {
    if (added.length === 0) return '';
    const list = added.join(',');
    // Over a seventh the added tone needs parentheses to stay readable
    // (C7(add13)); over a bare triad the bald form is the idiom (Cadd9).
    return seventh ? `(add${list})` : `add${list}`;
  };

  if (third === 'sus2' || third === 'sus4' || third === 'sus2/4') {
    const sus = third === 'sus2/4' ? 'sus2/4' : third;
    let core: string;
    if (seventh) {
      const flavor = seventh === 'maj7' ? 'maj' : seventh === 'bb7' ? 'dim' : '';
      core = `${flavor}${stack ?? 7}`;
    } else {
      core = sixthTag;
    }
    return `${core}${sus}${addedTag()}`;
  }

  const base = CHORD_SUFFIX[quality];
  if (sixthTag) {
    // The 9th is part of "6/9", so it must not also appear as an added tone.
    const rest = added.filter((n) => n !== 9);
    const tag = rest.length > 0 ? `add${rest.join(',')}` : '';
    return `${base}${sixthTag}${tag}`;
  }
  if (stack === null) return `${base}${addedTag()}`;
  return `${EXTENDED_SUFFIX[quality]?.(stack) ?? base}${addedTag()}`;
}

// 7th quality -> its name once an extension stack sits on top, as a function
// of the stack's top note: dom7 -> C9/C11/C13, min7 -> Cm9/Cm11/Cm13, and so
// on. dim7 is absent: there is no conventional "dim9", so it keeps its own
// name and the extension is spelled as an added tone.
const EXTENDED_SUFFIX: Partial<Record<ChordQuality, (stack: number) => string>> = {
  maj7: (n) => `maj${n}`,
  dom7: (n) => `${n}`,
  min7: (n) => `m${n}`,
  m7b5: (n) => `m${n}b5`,
  minMaj7: (n) => `m(maj${n})`,
  dom7sus4: (n) => `${n}sus4`,
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
