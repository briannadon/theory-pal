import { describe, expect, it } from 'vitest';
import { allScales, diatonicChords, isDiatonic, stateKey, type Key, type RelChord } from '../theory/index.ts';
import { GLOBAL_FLOOR_WEIGHT } from './constants.ts';
import { theoryPrior } from './prior.ts';

describe('theoryPrior: C ionian after I (ground-truth functional-harmony sanity)', () => {
  const key: Key = { tonic: 0, scale: 'ionian' };
  const context: RelChord[] = [{ degree: 0, quality: 'maj' }];
  const weights = theoryPrior(key, context);

  const w = (rc: RelChord) => weights.get(stateKey(rc)) ?? 0;

  const I: RelChord = { degree: 0, quality: 'maj' };
  const ii: RelChord = { degree: 2, quality: 'min' };
  const iii: RelChord = { degree: 4, quality: 'min' };
  const IV: RelChord = { degree: 5, quality: 'maj' };
  const V: RelChord = { degree: 7, quality: 'maj' };
  const vi: RelChord = { degree: 9, quality: 'min' };
  const viio: RelChord = { degree: 11, quality: 'dim' };
  const sharpIVmaj: RelChord = { degree: 6, quality: 'maj' };
  const bVII: RelChord = { degree: 10, quality: 'maj' };
  const borrowedIv: RelChord = { degree: 5, quality: 'min' };
  const secondaryDomOfIV: RelChord = { degree: 0, quality: 'dom7' }; // "V/IV" — applied dominant a 5th above IV

  it('ranks the strong descending-fifth/fourth motions (IV, V) above the others', () => {
    expect(w(IV)).toBeGreaterThan(w(V));
    expect(w(V)).toBeGreaterThan(w(ii));
    expect(w(V)).toBeGreaterThan(w(iii));
    expect(w(V)).toBeGreaterThan(w(viio));
  });

  it('vi (tonic-substitute) and the V/IV secondary dominant are present with real, non-floor weight', () => {
    expect(w(vi)).toBeGreaterThan(GLOBAL_FLOOR_WEIGHT * 10);
    expect(w(secondaryDomOfIV)).toBeGreaterThan(GLOBAL_FLOOR_WEIGHT * 10);
  });

  it('bVII (major-key modal mixture) and borrowed iv are present and reachable, and marked non-diatonic', () => {
    expect(w(bVII)).toBeGreaterThan(GLOBAL_FLOOR_WEIGHT);
    expect(isDiatonic(bVII, key)).toBe(false);
    expect(w(borrowedIv)).toBeGreaterThan(GLOBAL_FLOOR_WEIGHT);
    expect(isDiatonic(borrowedIv, key)).toBe(false);
  });

  it('#IV major (no structural role in ionian) is present but at the floor — "low but present"', () => {
    expect(w(sharpIVmaj)).toBeCloseTo(GLOBAL_FLOOR_WEIGHT, 10);
    expect(w(sharpIVmaj)).toBeGreaterThan(0);
    expect(isDiatonic(sharpIVmaj, key)).toBe(false);
  });

  it('never omits the native tonic chord itself', () => {
    expect(w(I)).toBeGreaterThan(0);
  });
});

describe('theoryPrior: generalizes across modes via each mode\'s own characteristic scale tone', () => {
  it('dorian\'s IV (raised 6th) outscores ionian\'s IV in the identical root-motion/function situation', () => {
    // Same root (5), same function (S, scale-degree index 3 in both modes),
    // same previous-chord function (T, sitting on the tonic) — the only
    // difference is dorian's IV sits on its mode's characteristic altered
    // tone (natural 6 vs aeolian's b6) and ionian's does not.
    const ionianIV = theoryPrior({ tonic: 0, scale: 'ionian' }, [{ degree: 0, quality: 'maj' }]).get(
      stateKey({ degree: 5, quality: 'maj' }),
    )!;
    const dorianIV = theoryPrior({ tonic: 0, scale: 'dorian' }, [{ degree: 0, quality: 'min' }]).get(
      stateKey({ degree: 5, quality: 'maj' }),
    )!;
    expect(dorianIV).toBeGreaterThan(ionianIV);
  });

  it('phrygian/locrian already have a native bII, so no duplicate Neapolitan is layered on top', () => {
    const phrygianKey: Key = { tonic: 6, scale: 'phrygian' };
    const bII: RelChord = { degree: 1, quality: 'maj' };
    expect(isDiatonic(bII, phrygianKey)).toBe(true);
    const weights = theoryPrior(phrygianKey, [{ degree: 6, quality: 'min' }]);
    // Native + characteristic-boosted, not merely NEAPOLITAN_FACTOR-tier.
    expect(weights.get(stateKey(bII))).toBeGreaterThan(GLOBAL_FLOOR_WEIGHT * 5);
  });

  it('produces a full, non-throwing prior for every scale in the table, always covering all 7 diatonic degrees', () => {
    for (const scale of allScales()) {
      const key: Key = { tonic: 3, scale: scale.id };
      const weights = theoryPrior(key, []);
      for (const rc of diatonicChords(key)) {
        expect(weights.get(stateKey(rc))).toBeGreaterThan(0);
      }
    }
  });

  it('handles an empty context by assuming a tonic starting point, without throwing', () => {
    const key: Key = { tonic: 5, scale: 'mixolydian' };
    expect(() => theoryPrior(key, [])).not.toThrow();
    const weights = theoryPrior(key, []);
    expect(weights.size).toBeGreaterThan(0);
  });
});

describe('theoryPrior: non-diatonic chords are always reachable, never filtered out', () => {
  it('every (degree, quality) combination in the v1 vocabulary gets a nonzero weight', () => {
    const key: Key = { tonic: 0, scale: 'ionian' };
    const weights = theoryPrior(key, [{ degree: 0, quality: 'maj' }]);
    // 12 chromatic roots x 13 v1 qualities.
    expect(weights.size).toBe(12 * 13);
    for (const w of weights.values()) expect(w).toBeGreaterThan(0);
  });
});
