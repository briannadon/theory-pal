// Scale definitions: pure data. Adding a scale is a table entry — no other code
// needs to change. Covers the 7 diatonic modes, harmonic minor + its 7 modes, and
// melodic minor (jazz/ascending form) + its 7 modes.
//
// Interval patterns are semitones above tonic, ascending, always length 7, always
// starting at 0. Mode names use the common jazz/theory names where one exists
// (e.g. "Phrygian Dominant" rather than "5th mode of harmonic minor").

export type ScaleId =
  | 'ionian'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'aeolian'
  | 'locrian'
  | 'harmonicMinor'
  | 'locrianNatural6'
  | 'ionianAugmented'
  | 'dorianSharp4'
  | 'phrygianDominant'
  | 'lydianSharp2'
  | 'ultraLocrian'
  | 'melodicMinor'
  | 'dorianB2'
  | 'lydianAugmented'
  | 'lydianDominant'
  | 'mixolydianB6'
  | 'locrianSharp2'
  | 'altered';

export interface Scale {
  id: ScaleId;
  name: string; // display, e.g. "Harmonic Minor"
  intervals: number[]; // semitones above tonic, ascending, length 7, starts at 0
}

// The table. Order within each family follows "mode number" (1st = the parent
// scale itself, 2nd..7th = modes built on each successive scale degree).
const SCALE_TABLE: Scale[] = [
  // --- 7 diatonic modes (modes of the major scale) ---
  { id: 'ionian', name: 'Ionian (Major)', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'dorian', name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'aeolian', name: 'Aeolian (Natural Minor)', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'locrian', name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },

  // --- harmonic minor + its 7 modes ---
  { id: 'harmonicMinor', name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'locrianNatural6', name: 'Locrian Natural 6', intervals: [0, 1, 3, 5, 6, 9, 10] },
  { id: 'ionianAugmented', name: 'Ionian Augmented', intervals: [0, 2, 4, 5, 8, 9, 11] },
  {
    id: 'dorianSharp4',
    name: 'Dorian #4 (Ukrainian Dorian)',
    intervals: [0, 2, 3, 6, 7, 9, 10],
  },
  { id: 'phrygianDominant', name: 'Phrygian Dominant', intervals: [0, 1, 4, 5, 7, 8, 10] },
  { id: 'lydianSharp2', name: 'Lydian #2', intervals: [0, 3, 4, 6, 7, 9, 11] },
  { id: 'ultraLocrian', name: 'Ultra Locrian', intervals: [0, 1, 3, 4, 6, 8, 9] },

  // --- melodic minor (jazz/ascending form) + its 7 modes ---
  { id: 'melodicMinor', name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'dorianB2', name: 'Dorian b2', intervals: [0, 1, 3, 5, 7, 9, 10] },
  { id: 'lydianAugmented', name: 'Lydian Augmented', intervals: [0, 2, 4, 6, 8, 9, 11] },
  { id: 'lydianDominant', name: 'Lydian Dominant', intervals: [0, 2, 4, 6, 7, 9, 10] },
  { id: 'mixolydianB6', name: 'Mixolydian b6', intervals: [0, 2, 4, 5, 7, 8, 10] },
  {
    id: 'locrianSharp2',
    name: 'Locrian #2 (Half-Diminished)',
    intervals: [0, 2, 3, 5, 6, 8, 10],
  },
  { id: 'altered', name: 'Altered (Super Locrian)', intervals: [0, 1, 3, 4, 6, 8, 10] },
];

const SCALE_BY_ID: Map<ScaleId, Scale> = new Map(SCALE_TABLE.map((s) => [s.id, s]));

export function getScale(id: ScaleId): Scale {
  const scale = SCALE_BY_ID.get(id);
  if (!scale) throw new Error(`Unknown scale id: ${id}`);
  return scale;
}

export function allScales(): Scale[] {
  return SCALE_TABLE.slice();
}
