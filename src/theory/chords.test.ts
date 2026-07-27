import { describe, expect, it } from 'vitest';
import {
  chordIntervals,
  chordPitches,
  chordShape,
  extensionSpelling,
  hasSeventh,
  withSeventh,
  withoutSeventh,
  diatonicChords,
  isDiatonic,
  parseStateKey,
  qualityAtDegree,
  QUALITY_INTERVALS,
  stateKey,
  toAbsolute,
  toRelative,
  type ChordQuality,
  type Key,
  type RelChord,
} from './chords.ts';
import { allScales } from './scales.ts';

describe('stateKey / parseStateKey', () => {
  it('formats as `${degree}:${quality}` per SPEC.md examples', () => {
    expect(stateKey({ degree: 0, quality: 'maj' })).toBe('0:maj');
    expect(stateKey({ degree: 10, quality: 'maj' })).toBe('10:maj'); // bVII
    expect(stateKey({ degree: 9, quality: 'min7' })).toBe('9:min7'); // vi7
  });

  it('round-trips through parseStateKey', () => {
    const cases: RelChord[] = [
      { degree: 0, quality: 'maj' },
      { degree: 11, quality: 'dim' },
      { degree: 7, quality: 'dom7' },
      { degree: 3, quality: 'minMaj7' },
    ];
    for (const rc of cases) {
      expect(parseStateKey(stateKey(rc))).toEqual(rc);
    }
  });

  it('rejects malformed keys', () => {
    expect(() => parseStateKey('not-a-key')).toThrow();
    expect(() => parseStateKey('5:bogusQuality')).toThrow();
  });
});

describe('toAbsolute / toRelative round-trip', () => {
  const keys: Key[] = [
    { tonic: 0, scale: 'ionian' },
    { tonic: 9, scale: 'harmonicMinor' },
    { tonic: 6, scale: 'phrygian' },
    { tonic: 3, scale: 'dorian' },
  ];
  const qualities: ChordQuality[] = ['maj', 'min', 'dim', 'aug', 'dom7', 'min7', 'sus4'];

  it('toRelative(toAbsolute(rel, key), key) === rel', () => {
    for (const key of keys) {
      for (let degree = 0; degree < 12; degree++) {
        for (const quality of qualities) {
          const rel: RelChord = { degree, quality };
          expect(toRelative(toAbsolute(rel, key), key)).toEqual(rel);
        }
      }
    }
  });

  it('toAbsolute(toRelative(abs, key), key) === abs (module root/quality)', () => {
    for (const key of keys) {
      for (let root = 0; root < 12; root++) {
        for (const quality of qualities) {
          const abs = { root, quality };
          expect(toAbsolute(toRelative(abs, key), key)).toEqual(abs);
        }
      }
    }
  });
});

describe('chordPitches', () => {
  it('returns root + chord-tone pitch classes for each quality', () => {
    expect(new Set(chordPitches({ root: 0, quality: 'maj' }))).toEqual(new Set([0, 4, 7]));
    expect(new Set(chordPitches({ root: 9, quality: 'min7' }))).toEqual(new Set([9, 0, 4, 7]));
    expect(new Set(chordPitches({ root: 2, quality: 'dim7' }))).toEqual(new Set([2, 5, 8, 11]));
  });

  it('matches QUALITY_INTERVALS for every quality', () => {
    for (const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
      const pitches = chordPitches({ root: 5, quality });
      const expected = QUALITY_INTERVALS[quality].map((iv) => (5 + iv) % 12);
      expect(pitches).toEqual(expected);
    }
  });
});

describe('diatonicChords: known music-theory ground truth', () => {
  it('C ionian: I ii iii IV V vi viio', () => {
    const chords = diatonicChords({ tonic: 0, scale: 'ionian' });
    expect(chords).toEqual([
      { degree: 0, quality: 'maj' },
      { degree: 2, quality: 'min' },
      { degree: 4, quality: 'min' },
      { degree: 5, quality: 'maj' },
      { degree: 7, quality: 'maj' },
      { degree: 9, quality: 'min' },
      { degree: 11, quality: 'dim' },
    ]);
  });

  it('D dorian: i ii bIII IV v vio bVII', () => {
    const chords = diatonicChords({ tonic: 2, scale: 'dorian' });
    expect(chords).toEqual([
      { degree: 0, quality: 'min' },
      { degree: 2, quality: 'min' },
      { degree: 3, quality: 'maj' },
      { degree: 5, quality: 'maj' },
      { degree: 7, quality: 'min' },
      { degree: 9, quality: 'dim' },
      { degree: 10, quality: 'maj' },
    ]);
  });

  it('F# phrygian: i bII bIII iv vo bVI bvii', () => {
    const chords = diatonicChords({ tonic: 6, scale: 'phrygian' });
    expect(chords).toEqual([
      { degree: 0, quality: 'min' },
      { degree: 1, quality: 'maj' },
      { degree: 3, quality: 'maj' },
      { degree: 5, quality: 'min' },
      { degree: 7, quality: 'dim' },
      { degree: 8, quality: 'maj' },
      { degree: 10, quality: 'min' },
    ]);
  });

  it('A harmonic minor: i iio III+ iv V VI viio', () => {
    const chords = diatonicChords({ tonic: 9, scale: 'harmonicMinor' });
    expect(chords).toEqual([
      { degree: 0, quality: 'min' },
      { degree: 2, quality: 'dim' },
      { degree: 3, quality: 'aug' },
      { degree: 5, quality: 'min' },
      { degree: 7, quality: 'maj' },
      { degree: 8, quality: 'maj' },
      { degree: 11, quality: 'dim' },
    ]);
  });

  it('never throws, and returns 7 chords, for every scale in the table (triads and sevenths)', () => {
    for (const scale of allScales()) {
      const key: Key = { tonic: 0, scale: scale.id };
      expect(() => diatonicChords(key, false)).not.toThrow();
      expect(() => diatonicChords(key, true)).not.toThrow();
      expect(diatonicChords(key, false)).toHaveLength(7);
      expect(diatonicChords(key, true)).toHaveLength(7);
    }
  });

  it('sevenths=true gives the standard 7th-chord set for C ionian', () => {
    const chords = diatonicChords({ tonic: 0, scale: 'ionian' }, true);
    expect(chords).toEqual([
      { degree: 0, quality: 'maj7' },
      { degree: 2, quality: 'min7' },
      { degree: 4, quality: 'min7' },
      { degree: 5, quality: 'maj7' },
      { degree: 7, quality: 'dom7' },
      { degree: 9, quality: 'min7' },
      { degree: 11, quality: 'm7b5' },
    ]);
  });
});

describe('isDiatonic', () => {
  const cMajor: Key = { tonic: 0, scale: 'ionian' };

  it('reports true for the key’s own diatonic triads', () => {
    for (const rc of diatonicChords(cMajor)) {
      expect(isDiatonic(rc, cMajor)).toBe(true);
    }
  });

  it('reports true for the key’s own diatonic 7th chords', () => {
    for (const rc of diatonicChords(cMajor, true)) {
      expect(isDiatonic(rc, cMajor)).toBe(true);
    }
  });

  it('reports false for borrowed/non-diatonic chords', () => {
    expect(isDiatonic({ degree: 10, quality: 'maj' }, cMajor)).toBe(false); // bVII
    expect(isDiatonic({ degree: 1, quality: 'maj' }, cMajor)).toBe(false); // bII
    expect(isDiatonic({ degree: 0, quality: 'min' }, cMajor)).toBe(false); // i (parallel minor borrow)
  });

  it('sus chords are never diatonic', () => {
    expect(isDiatonic({ degree: 0, quality: 'sus4' }, cMajor)).toBe(false);
  });
});

describe('chord modifiers', () => {
  const cMajorKey: Key = { tonic: 0, scale: 'ionian' };

  it('leaves unmodified chords exactly as the quality table defines them', () => {
    for (const q of Object.keys(QUALITY_INTERVALS) as ChordQuality[]) {
      expect(chordIntervals(q)).toEqual(QUALITY_INTERVALS[q]);
      expect(chordIntervals(q, {})).toEqual(QUALITY_INTERVALS[q]);
    }
  });

  it('sus replaces the third but keeps the fifth and any seventh', () => {
    expect(chordIntervals('maj', { sus4: true })).toEqual([0, 5, 7]);
    expect(chordIntervals('min', { sus2: true })).toEqual([0, 2, 7]);
    expect(chordIntervals('dom7', { sus4: true })).toEqual(QUALITY_INTERVALS.dom7sus4);
    expect(chordIntervals('maj7', { sus4: true })).toEqual([0, 5, 7, 11]);
    expect(chordIntervals('m7b5', { sus4: true })).toEqual([0, 5, 6, 10]); // b5 survives
  });

  it('adds a 9th independently of the 7th', () => {
    expect(chordIntervals('maj', { ninth: true })).toEqual([0, 4, 7, 14]); // add9
    expect(chordIntervals('maj7', { ninth: true })).toEqual([0, 4, 7, 11, 14]); // maj9
    expect(chordIntervals('dom7', { sus4: true, ninth: true })).toEqual([0, 5, 7, 10, 14]); // 9sus4
  });

  it('skips a 9th that sus2 already supplies (same pitch class)', () => {
    expect(chordIntervals('maj', { sus2: true, ninth: true })).toEqual([0, 2, 7]);
  });

  it('modifiers reach the sounding pitches', () => {
    expect(chordPitches({ root: 0, quality: 'maj7', mods: { ninth: true } })).toEqual([0, 4, 7, 11, 2]);
  });

  it('state keys ignore modifiers, so the model sees the plain chord', () => {
    const plain = stateKey({ degree: 7, quality: 'dom7' });
    expect(stateKey({ degree: 7, quality: 'dom7', mods: { sus4: true, ninth: true } })).toBe(plain);
  });

  it('toAbsolute/toRelative carry modifiers through', () => {
    const rel = { degree: 7, quality: 'dom7' as ChordQuality, mods: { sus4: true as const } };
    const abs = toAbsolute(rel, cMajorKey);
    expect(abs.mods).toEqual({ sus4: true });
    expect(toRelative(abs, cMajorKey)).toEqual(rel);
  });

  it('reports the shape a name renderer needs', () => {
    expect(chordShape('dom7', { sus4: true, ninth: true })).toEqual({
      third: 'sus4',
      seventh: 'b7',
      sixth: false,
      ninth: true,
      eleventh: false,
      thirteenth: false,
    });
    expect(chordShape('min')).toEqual({
      third: 'min',
      seventh: null,
      sixth: false,
      ninth: false,
      eleventh: false,
      thirteenth: false,
    });
  });

  it('lets sus2 and sus4 combine: both replace the third', () => {
    expect(chordIntervals('maj', { sus2: true, sus4: true })).toEqual([0, 2, 5, 7]);
    expect(chordShape('maj', { sus2: true, sus4: true }).third).toBe('sus2/4');
  });

  it('stacks 11ths and 13ths, skipping tones the chord already has', () => {
    expect(chordIntervals('dom7', { ninth: true, eleventh: true })).toEqual([0, 4, 7, 10, 14, 17]);
    expect(chordIntervals('dom7', { thirteenth: true })).toEqual([0, 4, 7, 10, 21]);
    // sus4 *is* the 11th an octave down, so the extension adds nothing.
    expect(chordIntervals('dom7', { sus4: true, eleventh: true })).toEqual([0, 5, 7, 10]);
  });

  it('spells an unbroken stack by its top note, and anything else as added', () => {
    const spell = (mods: Parameters<typeof chordShape>[1]) =>
      extensionSpelling(chordShape('dom7', mods));
    expect(spell({ ninth: true })).toEqual({ stack: 9, added: [], sixth: false });
    expect(spell({ ninth: true, eleventh: true })).toEqual({ stack: 11, added: [], sixth: false });
    expect(spell({ ninth: true, eleventh: true, thirteenth: true })).toEqual({
      stack: 13,
      added: [],
      sixth: false,
    });
    // A 13th chord implies the 11th, so 9 + 13 still spells 13.
    expect(spell({ ninth: true, thirteenth: true })).toEqual({
      stack: 13,
      added: [],
      sixth: false,
    });
    // Over a seventh, a 6th is the 13th.
    expect(spell({ ninth: true, sixth: true })).toEqual({ stack: 13, added: [], sixth: false });
    // Without the 9th there is no stack to continue: these are added tones.
    expect(spell({ eleventh: true })).toEqual({ stack: null, added: [11], sixth: false });
    expect(spell({ thirteenth: true })).toEqual({ stack: null, added: [13], sixth: false });
    // No seventh, no stack at all — and a 6th stays a 6th.
    expect(extensionSpelling(chordShape('maj', { ninth: true }))).toEqual({
      stack: null,
      added: [9],
      sixth: false,
    });
    expect(extensionSpelling(chordShape('maj', { sixth: true }))).toEqual({
      stack: null,
      added: [],
      sixth: true,
    });
  });

  it('adds the key’s own seventh, falling back to the triad’s where the key has none', () => {
    const cMajor: Key = { tonic: 0, scale: 'ionian' };
    expect(withSeventh({ degree: 7, quality: 'maj' }, cMajor).quality).toBe('dom7'); // V7
    expect(withSeventh({ degree: 0, quality: 'maj' }, cMajor).quality).toBe('maj7'); // Imaj7
    expect(withSeventh({ degree: 2, quality: 'min' }, cMajor).quality).toBe('min7'); // ii7
    // bVII isn't diatonic to C major: the major triad implies a dominant 7th.
    expect(withSeventh({ degree: 10, quality: 'maj' }, cMajor).quality).toBe('dom7');
    // Already a 7th chord, or with no representable 7th: unchanged.
    expect(withSeventh({ degree: 7, quality: 'dom7' }, cMajor).quality).toBe('dom7');
    expect(withSeventh({ degree: 0, quality: 'aug' }, cMajor).quality).toBe('aug');
  });

  it('strips a seventh back to its triad, preserving modifiers', () => {
    expect(withoutSeventh({ degree: 7, quality: 'dom7', mods: { ninth: true } })).toEqual({
      degree: 7,
      quality: 'maj',
      mods: { ninth: true },
    });
    expect(withoutSeventh({ degree: 0, quality: 'maj' }).quality).toBe('maj'); // already a triad
    expect(hasSeventh('m7b5')).toBe(true);
    expect(hasSeventh('sus2')).toBe(false);
  });
});

describe('qualityAtDegree', () => {
  const cMajor: Key = { tonic: 0, scale: 'ionian' };
  const aMinor: Key = { tonic: 9, scale: 'aeolian' };
  const dDorian: Key = { tonic: 2, scale: 'dorian' };

  it('gives the key its own quality wherever the scale has one', () => {
    for (const key of [cMajor, aMinor, dDorian]) {
      for (const rc of diatonicChords(key)) {
        expect(qualityAtDegree(key, rc.degree)).toBe(rc.quality);
      }
    }
  });

  it('follows the mode, not the major scale: dorian IV is major, aeolian IV is minor', () => {
    expect(qualityAtDegree(dDorian, 5)).toBe('maj');
    expect(qualityAtDegree(aMinor, 5)).toBe('min');
  });

  it('borrows from the parallel minor for the flat degrees a major key lacks', () => {
    expect(qualityAtDegree(cMajor, 3)).toBe('maj'); // bIII
    expect(qualityAtDegree(cMajor, 8)).toBe('maj'); // bVI
    expect(qualityAtDegree(cMajor, 10)).toBe('maj'); // bVII
    expect(qualityAtDegree(cMajor, 1)).toBe('maj'); // bII, the Neapolitan
  });

  it('makes the two upward-leading chromatic degrees diminished', () => {
    expect(qualityAtDegree(cMajor, 6)).toBe('dim'); // #iv° in a major key
    expect(qualityAtDegree(aMinor, 11)).toBe('dim'); // vii° over a minor key's dominant
  });

  it('answers for any integer, in or out of an octave', () => {
    for (const key of [cMajor, aMinor]) {
      for (let d = -24; d <= 24; d++) {
        expect(qualityAtDegree(key, d)).toBe(qualityAtDegree(key, ((d % 12) + 12) % 12));
      }
    }
  });

  it('is always a triad — sevenths are a separate decision', () => {
    for (const key of [cMajor, aMinor, dDorian]) {
      for (let d = 0; d < 12; d++) {
        expect(hasSeventh(qualityAtDegree(key, d))).toBe(false);
      }
    }
  });
});
