import { describe, expect, it } from 'vitest';
import { allScales, getScale } from './scales.ts';

describe('scale table', () => {
  it('has 21 scales: 7 diatonic modes + 7 harmonic minor modes + 7 melodic minor modes', () => {
    expect(allScales()).toHaveLength(21);
  });

  it('every scale has 7 ascending intervals starting at 0', () => {
    for (const scale of allScales()) {
      expect(scale.intervals).toHaveLength(7);
      expect(scale.intervals[0]).toBe(0);
      for (let i = 1; i < scale.intervals.length; i++) {
        expect(scale.intervals[i]).toBeGreaterThan(scale.intervals[i - 1]);
      }
      expect(scale.intervals[6]).toBeLessThan(12);
      expect(scale.name.length).toBeGreaterThan(0);
    }
  });

  it('every scale has a unique id and display name', () => {
    const scales = allScales();
    expect(new Set(scales.map((s) => s.id)).size).toBe(scales.length);
    expect(new Set(scales.map((s) => s.name)).size).toBe(scales.length);
  });

  it('obscure harmonic/melodic minor modes use recognizable common names', () => {
    expect(getScale('phrygianDominant').name).toMatch(/phrygian dominant/i);
    expect(getScale('lydianDominant').name).toMatch(/lydian dominant/i);
    expect(getScale('altered').name).toMatch(/altered|super locrian/i);
  });

  it('getScale throws for unknown ids', () => {
    // @ts-expect-error intentionally invalid id for the runtime check
    expect(() => getScale('notAScale')).toThrow();
  });

  it('known interval patterns match standard music theory', () => {
    expect(getScale('ionian').intervals).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(getScale('dorian').intervals).toEqual([0, 2, 3, 5, 7, 9, 10]);
    expect(getScale('phrygian').intervals).toEqual([0, 1, 3, 5, 7, 8, 10]);
    expect(getScale('harmonicMinor').intervals).toEqual([0, 2, 3, 5, 7, 8, 11]);
    expect(getScale('melodicMinor').intervals).toEqual([0, 2, 3, 5, 7, 9, 11]);
    // 5th mode of harmonic minor: Phrygian with a major third.
    expect(getScale('phrygianDominant').intervals).toEqual([0, 1, 4, 5, 7, 8, 10]);
    // 4th mode of melodic minor: Lydian with a flat 7th.
    expect(getScale('lydianDominant').intervals).toEqual([0, 2, 4, 6, 7, 9, 10]);
    // 7th mode of melodic minor: the "altered" / super locrian scale.
    expect(getScale('altered').intervals).toEqual([0, 1, 3, 4, 6, 8, 10]);
  });
});
