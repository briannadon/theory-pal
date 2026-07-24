import { describe, expect, it } from 'vitest';
import {
  chordPitches,
  diatonicChords,
  isDiatonic,
  parseStateKey,
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
