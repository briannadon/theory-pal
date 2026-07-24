import { describe, expect, it } from 'vitest';
import { allScales } from '../../theory/index.ts';
import { findScaleGroupLabel, scaleGroups } from './scaleGroups.ts';

describe('scaleGroups', () => {
  it('splits all 21 scales into three groups of 7', () => {
    const groups = scaleGroups();
    expect(groups).toHaveLength(3);
    for (const g of groups) expect(g.scales).toHaveLength(7);
    const total = groups.reduce((n, g) => n + g.scales.length, 0);
    expect(total).toBe(allScales().length);
  });

  it('groups the diatonic modes first, matching theory/scales.ts ordering', () => {
    const [diatonic] = scaleGroups();
    expect(diatonic.label).toBe('Diatonic Modes');
    expect(diatonic.scales.map((s) => s.id)).toEqual([
      'ionian',
      'dorian',
      'phrygian',
      'lydian',
      'mixolydian',
      'aeolian',
      'locrian',
    ]);
  });

  it('every scale from theory/ appears in exactly one group', () => {
    const groups = scaleGroups();
    for (const scale of allScales()) {
      const owners = groups.filter((g) => g.scales.some((s) => s.id === scale.id));
      expect(owners).toHaveLength(1);
    }
  });
});

describe('findScaleGroupLabel', () => {
  it('finds the harmonic and melodic minor families', () => {
    expect(findScaleGroupLabel('harmonicMinor')).toBe('Harmonic Minor Family');
    expect(findScaleGroupLabel('melodicMinor')).toBe('Melodic Minor Family');
    expect(findScaleGroupLabel('dorian')).toBe('Diatonic Modes');
  });
});
