import { describe, expect, it } from 'vitest';
import { chordName, noteName } from './pitch.ts';

describe('chordName spelling', () => {
  it('matches the SPEC.md example exactly', () => {
    expect(chordName({ root: 1, quality: 'min7' })).toBe('C#m7');
  });

  it('spells minor roots as Eb, not D#', () => {
    expect(chordName({ root: 3, quality: 'min' })).toBe('Ebm');
  });

  it('spells common minor-key tonics with sharps (C#m, G#m), not their flat enharmonics', () => {
    expect(chordName({ root: 1, quality: 'min' })).toBe('C#m');
    expect(chordName({ root: 8, quality: 'min' })).toBe('G#m');
  });

  it('spells major chords using standard flat-key tonics (Db, Ab, Bb)', () => {
    expect(chordName({ root: 1, quality: 'maj' })).toBe('Db');
    expect(chordName({ root: 8, quality: 'maj' })).toBe('Ab');
    expect(chordName({ root: 10, quality: 'maj' })).toBe('Bb');
  });

  it('never produces a double sharp/flat or an out-of-range letter for the 12 pitch classes', () => {
    for (let pc = 0; pc < 12; pc++) {
      const name = noteName(pc, 'maj');
      expect(name).toMatch(/^[A-G](#|b)?$/);
    }
  });

  it('natural pitch classes always spell as the natural letter regardless of quality', () => {
    const naturals: Array<[number, string]> = [
      [0, 'C'],
      [2, 'D'],
      [4, 'E'],
      [5, 'F'],
      [7, 'G'],
      [9, 'A'],
      [11, 'B'],
    ];
    for (const [pc, letter] of naturals) {
      expect(noteName(pc, 'maj')).toBe(letter);
      expect(noteName(pc, 'min')).toBe(letter);
      expect(noteName(pc, 'dom7')).toBe(letter);
    }
  });

  it('renders standard suffixes for each quality', () => {
    expect(chordName({ root: 0, quality: 'maj7' })).toBe('Cmaj7');
    expect(chordName({ root: 0, quality: 'dom7' })).toBe('C7');
    expect(chordName({ root: 0, quality: 'm7b5' })).toBe('Cm7b5');
    expect(chordName({ root: 0, quality: 'dim7' })).toBe('Cdim7');
    expect(chordName({ root: 0, quality: 'aug' })).toBe('C+');
    expect(chordName({ root: 0, quality: 'sus2' })).toBe('Csus2');
    expect(chordName({ root: 0, quality: 'sus4' })).toBe('Csus4');
    expect(chordName({ root: 0, quality: 'dom7sus4' })).toBe('C7sus4');
  });

  it('appends a slash bass note for a specified inversion', () => {
    // C major, first inversion -> bass is E.
    expect(chordName({ root: 0, quality: 'maj', inversion: 1 })).toBe('C/E');
    // Root position (inversion 0) never gets a slash.
    expect(chordName({ root: 0, quality: 'maj', inversion: 0 })).toBe('C');
  });
});
