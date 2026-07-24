import { describe, expect, it } from 'vitest';
import type { Key, RelChord } from './chords.ts';
import { romanNumeral } from './roman.ts';

const cMajor: Key = { tonic: 0, scale: 'ionian' };

describe('romanNumeral', () => {
  it('matches the SPEC.md examples exactly', () => {
    expect(romanNumeral({ degree: 10, quality: 'maj' }, cMajor)).toBe('bVII');
    expect(romanNumeral({ degree: 5, quality: 'min' }, cMajor)).toBe('iv');
    expect(romanNumeral({ degree: 11, quality: 'dim' }, cMajor)).toBe('viio');
    expect(romanNumeral({ degree: 7, quality: 'dom7' }, cMajor)).toBe('V7');
  });

  it('handles non-diatonic chromatic degrees: bII, #IV', () => {
    expect(romanNumeral({ degree: 1, quality: 'maj' }, cMajor)).toBe('bII');
    expect(romanNumeral({ degree: 6, quality: 'maj' }, cMajor)).toBe('#IV');
  });

  it('cases uppercase for major/augmented, lowercase for minor/diminished', () => {
    const upperish: RelChord[] = [
      { degree: 0, quality: 'maj' },
      { degree: 0, quality: 'aug' },
      { degree: 0, quality: 'maj7' },
      { degree: 0, quality: 'dom7' },
    ];
    for (const rc of upperish) {
      expect(romanNumeral(rc, cMajor)).toMatch(/^[#b]?[IV]+/);
    }
    const lowerish: RelChord[] = [
      { degree: 0, quality: 'min' },
      { degree: 0, quality: 'dim' },
      { degree: 0, quality: 'min7' },
      { degree: 0, quality: 'm7b5' },
      { degree: 0, quality: 'dim7' },
      { degree: 0, quality: 'minMaj7' },
    ];
    for (const rc of lowerish) {
      expect(romanNumeral(rc, cMajor)).toMatch(/^[#b]?[iv]+/);
    }
  });

  it('renders every diatonic degree of C ionian correctly', () => {
    expect(romanNumeral({ degree: 0, quality: 'maj' }, cMajor)).toBe('I');
    expect(romanNumeral({ degree: 2, quality: 'min' }, cMajor)).toBe('ii');
    expect(romanNumeral({ degree: 4, quality: 'min' }, cMajor)).toBe('iii');
    expect(romanNumeral({ degree: 5, quality: 'maj' }, cMajor)).toBe('IV');
    expect(romanNumeral({ degree: 7, quality: 'maj' }, cMajor)).toBe('V');
    expect(romanNumeral({ degree: 9, quality: 'min' }, cMajor)).toBe('vi');
    expect(romanNumeral({ degree: 11, quality: 'dim' }, cMajor)).toBe('viio');
  });

  it('renders seventh-chord suffixes distinctly for maj7 vs minMaj7', () => {
    expect(romanNumeral({ degree: 0, quality: 'maj7' }, cMajor)).toBe('Imaj7');
    expect(romanNumeral({ degree: 0, quality: 'minMaj7' }, cMajor)).toBe('imaj7');
  });

  it('is independent of the key’s scale field — only degree + quality matter', () => {
    const otherKey: Key = { tonic: 0, scale: 'harmonicMinor' };
    const rc: RelChord = { degree: 8, quality: 'maj' };
    expect(romanNumeral(rc, cMajor)).toBe(romanNumeral(rc, otherKey));
  });
});

describe('romanNumeral with modifiers', () => {
  it('absorbs a 9th into the numeral, keeping the degree’s case', () => {
    expect(romanNumeral({ degree: 7, quality: 'dom7', mods: { ninth: true } }, cMajor)).toBe('V9');
    expect(romanNumeral({ degree: 2, quality: 'min7', mods: { ninth: true } }, cMajor)).toBe('ii9');
    expect(romanNumeral({ degree: 0, quality: 'maj7', mods: { ninth: true } }, cMajor)).toBe('Imaj9');
  });

  it('marks a 9th without a 7th as an added tone', () => {
    expect(romanNumeral({ degree: 0, quality: 'maj', mods: { ninth: true } }, cMajor)).toBe('Iadd9');
    expect(romanNumeral({ degree: 9, quality: 'min', mods: { ninth: true } }, cMajor)).toBe('viadd9');
  });

  it('renders sus modifiers, keeping the base quality’s case', () => {
    expect(romanNumeral({ degree: 2, quality: 'min', mods: { sus4: true } }, cMajor)).toBe('iisus4');
    expect(romanNumeral({ degree: 7, quality: 'dom7', mods: { sus4: true } }, cMajor)).toBe('V7sus4');
    expect(romanNumeral({ degree: 7, quality: 'dom7', mods: { sus4: true, ninth: true } }, cMajor)).toBe('V9sus4');
  });
});

describe('romanNumeral with 6ths and extension stacks', () => {
  it('numbers the top of the stack', () => {
    expect(romanNumeral({ degree: 7, quality: 'dom7', mods: { ninth: true, thirteenth: true } }, cMajor)).toBe('V13');
    expect(romanNumeral({ degree: 2, quality: 'min7', mods: { ninth: true, eleventh: true } }, cMajor)).toBe('ii11');
  });

  it('marks 6ths, keeping the degree’s case', () => {
    expect(romanNumeral({ degree: 0, quality: 'maj', mods: { sixth: true } }, cMajor)).toBe('I6');
    expect(romanNumeral({ degree: 9, quality: 'min', mods: { sixth: true } }, cMajor)).toBe('vi6');
    expect(romanNumeral({ degree: 0, quality: 'maj', mods: { sixth: true, ninth: true } }, cMajor)).toBe('I6/9');
  });
});
