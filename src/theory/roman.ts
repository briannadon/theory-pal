// Roman-numeral rendering: a display concern derived from (semitone offset,
// quality). Degree labels are fixed relative to the MAJOR scale of the tonic —
// standard practice across tonal theory (this is how Hooktheory-style "scale
// degree" notation and most lead-sheet conventions label modal/borrowed chords:
// Dorian's characteristic vi and bIII are named relative to the major reference,
// not re-derived per mode). This makes the mapping key-independent and gives
// every chromatic root exactly one canonical label — no ambiguity between e.g.
// #IV and bV (this table picks #IV, matching common usage for the raised 4th).
import { isMinorish, type ChordQuality, type Key, type RelChord } from './chords.ts';

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

export function romanNumeral(c: RelChord, _key: Key): string {
  const label = DEGREE_LABELS[mod12(c.degree)];
  const cased = isMinorish(c.quality) ? label.toLowerCase() : label;
  return `${cased}${QUALITY_SUFFIX[c.quality]}`;
}
