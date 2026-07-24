// Roman-numeral rendering: a display concern derived from (semitone offset,
// quality). Degree labels are fixed relative to the MAJOR scale of the tonic —
// standard practice across tonal theory (this is how Hooktheory-style "scale
// degree" notation and most lead-sheet conventions label modal/borrowed chords:
// Dorian's characteristic vi and bIII are named relative to the major reference,
// not re-derived per mode). This makes the mapping key-independent and gives
// every chromatic root exactly one canonical label — no ambiguity between e.g.
// #IV and bV (this table picks #IV, matching common usage for the raised 4th).
import {
  chordShape,
  extensionSpelling,
  isMinorish,
  type ChordMods,
  type ChordQuality,
  type Key,
  type RelChord,
} from './chords.ts';

const DEGREE_LABELS = [
  'I',
  'bII',
  'II',
  'bIII',
  'III',
  'IV',
  '#IV',
  'V',
  'bVI',
  'VI',
  'bVII',
  'VII',
];

// Suffix appended after the (cased) degree label. Case of the base label is
// decided separately by quality; these strings are case-neutral.
const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: '',
  dim: 'o',
  aug: '+',
  maj7: 'maj7',
  min7: '7',
  dom7: '7',
  m7b5: 'ø7', // "ø" = 'ø'; half-diminished, e.g. viiø7
  dim7: 'o7',
  minMaj7: 'maj7', // lowercase base distinguishes it from maj7's uppercase base
  sus2: 'sus2',
  sus4: 'sus4',
  dom7sus4: '7sus4',
};

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

// Roman-numeral suffix for a *modified* chord (see ChordMods). Same shape
// analysis the chord-symbol renderer uses, but with roman conventions: V7 + 9
// is V9, ii7 + 9 is ii9, and the case of the numeral still comes from the base
// quality even when a sus has displaced the third — keeping ii recognizable as
// ii once it becomes iisus4.
// 7th quality -> its roman suffix once an extension stack sits on top, as a
// function of the stack's top note: V7 becomes V9/V11/V13, ii7 becomes
// ii9/ii11/ii13. The numeral's case still comes from the base quality.
const EXTENDED_SUFFIX: Partial<Record<ChordQuality, (stack: number) => string>> = {
  maj7: (n) => `maj${n}`,
  dom7: (n) => `${n}`,
  min7: (n) => `${n}`,
  m7b5: (n) => `ø${n}`,
  minMaj7: (n) => `maj${n}`,
  dom7sus4: (n) => `${n}sus4`,
};

function moddedSuffix(quality: ChordQuality, mods: ChordMods): string {
  const shape = chordShape(quality, mods);
  const { third, seventh } = shape;
  const { stack, added, sixth } = extensionSpelling(shape);
  const sixthTag = sixth ? (shape.ninth ? '6/9' : '6') : '';
  const addedTag = added.length > 0 ? `add${added.join(',')}` : '';

  if (third === 'sus2' || third === 'sus4' || third === 'sus2/4') {
    const sus = third === 'sus2/4' ? 'sus2/4' : third;
    const core = seventh
      ? `${seventh === 'maj7' ? 'maj' : seventh === 'bb7' ? 'o' : ''}${stack ?? 7}`
      : sixthTag;
    return `${core}${sus}${addedTag}`;
  }

  const base = QUALITY_SUFFIX[quality];
  if (sixthTag) {
    const rest = added.filter((n) => n !== 9);
    return `${base}${sixthTag}${rest.length > 0 ? `add${rest.join(',')}` : ''}`;
  }
  if (stack === null) return `${base}${addedTag}`;
  return `${EXTENDED_SUFFIX[quality]?.(stack) ?? base}${addedTag}`;
}

export function romanNumeral(c: RelChord, _key: Key): string {
  const label = DEGREE_LABELS[mod12(c.degree)];
  const cased = isMinorish(c.quality) ? label.toLowerCase() : label;
  const suffix = c.mods ? moddedSuffix(c.quality, c.mods) : QUALITY_SUFFIX[c.quality];
  return `${cased}${suffix}`;
}
