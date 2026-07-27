import { describe, expect, it } from 'vitest';
import { chordName, toAbsolute, type Key, type RelChord } from '../../theory/index.ts';
import {
  baseQuality,
  modifierState,
  normalizeChord,
  setDegree,
  setQuality,
  toggleModifier,
} from './chordMods.ts';

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

describe('setDegree', () => {
  const aMinor: Key = { tonic: 9, scale: 'aeolian' };

  it('re-snaps the quality to what the new degree takes in this key', () => {
    // The point of the rule: vii° is diminished because of where it sits, so
    // moving a major I chord onto VII gives the key's own vii°, not VII major.
    expect(setDegree({ degree: 0, quality: 'maj' }, cMajor, 11)).toEqual({
      degree: 11,
      quality: 'dim',
    });
    expect(setDegree({ degree: 0, quality: 'maj' }, cMajor, 9)).toEqual({
      degree: 9,
      quality: 'min',
    });
  });

  it('borrows a quality for the chromatic degrees the key has no chord on', () => {
    expect(name(setDegree({ degree: 0, quality: 'maj' }, cMajor, 8))).toBe('Ab'); // bVI
    expect(setDegree({ degree: 0, quality: 'maj' }, cMajor, 6).quality).toBe('dim'); // #iv°
  });

  it('keeps a seventh across the move, re-derived for the new degree', () => {
    // V7 (dominant) landing on IV becomes IVmaj7, which is the 7th C major
    // actually has there — not a dominant transplanted from where it came from.
    expect(setDegree({ degree: 7, quality: 'dom7' }, cMajor, 5)).toEqual({
      degree: 5,
      quality: 'maj7',
    });
    // And a triad stays a triad.
    expect(setDegree({ degree: 7, quality: 'maj' }, cMajor, 5).quality).toBe('maj');
  });

  it('carries the modifiers untouched', () => {
    const moved = setDegree({ degree: 0, quality: 'maj', mods: { ninth: true } }, cMajor, 3);
    expect(moved).toEqual({ degree: 3, quality: 'maj', mods: { ninth: true } });
  });

  it('reads a sus spelled as a quality as the modifier it is', () => {
    const moved = setDegree({ degree: 0, quality: 'sus4' }, cMajor, 7);
    expect(moved).toEqual({ degree: 7, quality: 'maj', mods: { sus4: true } });
    expect(modifierState(moved).sus4).toBe(true);
  });

  it('answers to the mode rather than to the major scale', () => {
    expect(setDegree({ degree: 0, quality: 'min' }, aMinor, 5).quality).toBe('min'); // iv
    expect(setDegree({ degree: 0, quality: 'min' }, { tonic: 2, scale: 'dorian' }, 5).quality).toBe(
      'maj',
    ); // dorian's major IV
  });

  it('is idempotent on the degree the chord is already on, once snapped', () => {
    const snapped = setDegree({ degree: 0, quality: 'maj' }, cMajor, 11);
    expect(setDegree(snapped, cMajor, 11)).toEqual(snapped);
  });
});

describe('setQuality / baseQuality', () => {
  it('overrules what the degree implies', () => {
    expect(setQuality({ degree: 0, quality: 'maj' }, 'aug')).toEqual({ degree: 0, quality: 'aug' });
  });

  it('reports the quality under a sus, whichever way the sus is spelled', () => {
    expect(baseQuality({ degree: 7, quality: 'dom7sus4' })).toBe('dom7');
    expect(baseQuality({ degree: 7, quality: 'dom7', mods: { sus4: true } })).toBe('dom7');
    expect(baseQuality({ degree: 0, quality: 'sus2' })).toBe('maj');
  });

  it('moves the seventh with the quality, and the 7 toggle agrees', () => {
    expect(modifierState(setQuality({ degree: 0, quality: 'maj' }, 'maj7')).seventh).toBe(true);
    expect(modifierState(setQuality({ degree: 0, quality: 'maj7' }, 'min')).seventh).toBe(false);
  });

  it('keeps the modifiers, and normalizes a sus quality into them first', () => {
    expect(setQuality({ degree: 0, quality: 'sus4', mods: { ninth: true } }, 'min')).toEqual({
      degree: 0,
      quality: 'min',
      mods: { ninth: true, sus4: true },
    });
  });
});
