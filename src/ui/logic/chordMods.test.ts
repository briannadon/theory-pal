import { describe, expect, it } from 'vitest';
import { chordName, toAbsolute, type Key, type RelChord } from '../../theory/index.ts';
import { modifierState, normalizeChord, toggleModifier } from './chordMods.ts';

const cMajor: Key = { tonic: 0, scale: 'ionian' };
const name = (c: RelChord) => chordName(toAbsolute(c, cMajor));

describe('normalizeChord', () => {
  it('rewrites sus qualities into the mods form, so toggles have one shape to read', () => {
    expect(normalizeChord({ degree: 0, quality: 'sus4' })).toEqual({
      degree: 0,
      quality: 'maj',
      mods: { sus4: true },
    });
    expect(normalizeChord({ degree: 7, quality: 'dom7sus4' })).toEqual({
      degree: 7,
      quality: 'dom7',
      mods: { sus4: true },
    });
  });

  it('leaves other chords alone', () => {
    const chord: RelChord = { degree: 2, quality: 'min7', mods: { ninth: true } };
    expect(normalizeChord(chord)).toBe(chord);
  });
});

describe('modifierState', () => {
  it('lights the same toggles whichever way a sus chord is spelled', () => {
    const asQuality = modifierState({ degree: 7, quality: 'dom7sus4' });
    const asMods = modifierState({ degree: 7, quality: 'dom7', mods: { sus4: true } });
    expect(asQuality).toEqual(asMods);
    expect(asQuality.sus4).toBe(true);
    expect(asQuality.seventh).toBe(true);
  });

  it('reads the seventh off the quality and the rest off the mods', () => {
    expect(modifierState({ degree: 0, quality: 'maj' })).toMatchObject({
      seventh: false,
      sixth: false,
      ninth: false,
    });
    expect(
      modifierState({ degree: 0, quality: 'maj7', mods: { ninth: true, thirteenth: true } }),
    ).toMatchObject({ seventh: true, ninth: true, thirteenth: true });
  });
});

describe('toggleModifier', () => {
  it('adds the key’s own seventh, and takes it back off', () => {
    const five: RelChord = { degree: 7, quality: 'maj' };
    const withSeven = toggleModifier(five, cMajor, 'seventh');
    expect(name(withSeven)).toBe('G7'); // V takes a dominant 7th...

    const one: RelChord = { degree: 0, quality: 'maj' };
    expect(name(toggleModifier(one, cMajor, 'seventh'))).toBe('Cmaj7'); // ...I a major one

    expect(name(toggleModifier(withSeven, cMajor, 'seventh'))).toBe('G');
  });

  it('stacks modifiers freely, including sus2 with sus4', () => {
    let chord: RelChord = { degree: 0, quality: 'maj' };
    chord = toggleModifier(chord, cMajor, 'sus2');
    expect(name(chord)).toBe('Csus2');
    chord = toggleModifier(chord, cMajor, 'sus4');
    expect(name(chord)).toBe('Csus2/4');
    // The 7th still comes from the key: on I that is a major 7th, even with
    // the third suspended away.
    chord = toggleModifier(chord, cMajor, 'seventh');
    expect(name(chord)).toBe('Cmaj7sus2/4');
    expect(name(toggleModifier({ degree: 7, quality: 'maj', mods: { sus4: true } }, cMajor, 'seventh'))).toBe(
      'C7sus4'.replace('C', 'G'),
    );
  });

  it('builds a 13th chord one toggle at a time', () => {
    let chord: RelChord = { degree: 7, quality: 'maj' };
    for (const mod of ['seventh', 'ninth', 'thirteenth'] as const) {
      chord = toggleModifier(chord, cMajor, mod);
    }
    expect(name(chord)).toBe('G13');
  });

  it('turns a sus quality off, not just its flag', () => {
    // Spelled as a quality rather than as mods — the toggle still has to
    // remove it, which is what normalizeChord is for.
    const chord = toggleModifier({ degree: 0, quality: 'sus4' }, cMajor, 'sus4');
    expect(name(chord)).toBe('C');
    expect(chord.mods).toBeUndefined();
  });

  it('drops the mods object entirely once nothing is set', () => {
    const on = toggleModifier({ degree: 0, quality: 'maj' }, cMajor, 'ninth');
    expect(on.mods).toEqual({ ninth: true });
    expect(toggleModifier(on, cMajor, 'ninth')).toEqual({ degree: 0, quality: 'maj' });
  });

  it('round-trips: toggling a modifier twice returns the original chord', () => {
    const chord: RelChord = { degree: 5, quality: 'maj7', mods: { ninth: true } };
    for (const mod of ['sus2', 'sus4', 'sixth', 'eleventh', 'thirteenth'] as const) {
      const there = toggleModifier(chord, cMajor, mod);
      expect(toggleModifier(there, cMajor, mod)).toEqual(chord);
    }
  });
});
