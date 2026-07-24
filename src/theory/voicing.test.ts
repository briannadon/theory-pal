import { describe, expect, it } from 'vitest';
import { chordPitches, QUALITY_INTERVALS, type AbsChord } from './chords.ts';
import { voiceChord, voiceProgression, type VoicedChord } from './voicing.ts';

function totalMovement(a: VoicedChord, b: VoicedChord): number {
  const sortedA = [...a.notes].sort((x, y) => x - y);
  const sortedB = [...b.notes].sort((x, y) => x - y);
  const n = Math.min(sortedA.length, sortedB.length);
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.abs(sortedA[i] - sortedB[i]);
  for (let i = n; i < sortedA.length; i++) {
    total += Math.min(...sortedB.map((x) => Math.abs(x - sortedA[i])));
  }
  for (let i = n; i < sortedB.length; i++) {
    total += Math.min(...sortedA.map((x) => Math.abs(x - sortedB[i])));
  }
  return total;
}

/** Root-position voicing anchored independently to `center` every time — no
 * voice leading at all. Used as the "naive" baseline the smart voicer must beat. */
function naiveVoice(c: AbsChord, center = 60): VoicedChord {
  const intervals = QUALITY_INTERVALS[c.quality];
  const pc = ((c.root % 12) + 12) % 12;
  let rootNote = pc;
  while (rootNote < center - 6) rootNote += 12;
  while (rootNote > center + 6) rootNote -= 12;
  return { notes: intervals.map((iv) => rootNote + iv) };
}

describe('voiceChord / voiceProgression', () => {
  it('keeps every note within the register window (default and custom)', () => {
    const chords: AbsChord[] = [
      { root: 0, quality: 'maj7' },
      { root: 5, quality: 'dom7' },
      { root: 7, quality: 'min7' },
      { root: 11, quality: 'dim7' },
      { root: 3, quality: 'aug' },
    ];
    for (const voiced of voiceProgression(chords)) {
      for (const n of voiced.notes) {
        expect(n).toBeGreaterThanOrEqual(48);
        expect(n).toBeLessThanOrEqual(84);
      }
    }
    const custom = voiceProgression(chords, { center: 64, low: 55, high: 79 });
    for (const voiced of custom) {
      for (const n of voiced.notes) {
        expect(n).toBeGreaterThanOrEqual(55);
        expect(n).toBeLessThanOrEqual(79);
      }
    }
  });

  it('produces exactly the chord’s pitch classes (mod 12), regardless of octave placement', () => {
    const chords: AbsChord[] = [
      { root: 2, quality: 'min' },
      { root: 9, quality: 'dom7' },
      { root: 6, quality: 'sus4' },
    ];
    let prev: VoicedChord | undefined;
    for (const c of chords) {
      const voiced = voiceChord(c, prev);
      const gotPcs = new Set(voiced.notes.map((n) => ((n % 12) + 12) % 12));
      const wantPcs = new Set(chordPitches(c));
      expect(gotPcs).toEqual(wantPcs);
      prev = voiced;
    }
  });

  it('keeps the root in the bass by default (lowest note has the root’s pitch class)', () => {
    const c: AbsChord = { root: 4, quality: 'min7' };
    const voiced = voiceChord(c);
    expect(voiced.notes[0] % 12).toBe(4);
  });

  it('honors a specified inversion in the bass', () => {
    // C major, first inversion: bass pitch class should be E (4), the third.
    const voiced = voiceChord({ root: 0, quality: 'maj', inversion: 1 });
    expect(voiced.notes[0] % 12).toBe(4);
    // Second inversion: bass pitch class should be G (7), the fifth.
    const voiced2 = voiceChord({ root: 0, quality: 'maj', inversion: 2 });
    expect(voiced2.notes[0] % 12).toBe(7);
  });

  it('is deterministic: identical input produces identical output', () => {
    const chords: AbsChord[] = [
      { root: 0, quality: 'maj' },
      { root: 5, quality: 'maj' },
      { root: 7, quality: 'dom7' },
      { root: 9, quality: 'min' },
    ];
    const a = voiceProgression(chords);
    const b = voiceProgression(chords);
    expect(a).toEqual(b);
  });

  it('produces block chords: one VoicedChord per input chord', () => {
    const chords: AbsChord[] = [
      { root: 0, quality: 'maj' },
      { root: 5, quality: 'maj' },
    ];
    expect(voiceProgression(chords)).toHaveLength(2);
  });

  it('minimizes total voice movement vs. a naive independently-anchored root-position baseline', () => {
    // I - IV - V - vi in C major: a progression with real register jumps if
    // each chord is voiced independently.
    const chords: AbsChord[] = [
      { root: 0, quality: 'maj' },
      { root: 5, quality: 'maj' },
      { root: 7, quality: 'maj' },
      { root: 9, quality: 'min' },
    ];
    const smart = voiceProgression(chords);
    const naive = chords.map((c) => naiveVoice(c));

    let smartTotal = 0;
    let naiveTotal = 0;
    for (let i = 1; i < chords.length; i++) {
      smartTotal += totalMovement(smart[i - 1], smart[i]);
      naiveTotal += totalMovement(naive[i - 1], naive[i]);
    }
    expect(smartTotal).toBeLessThan(naiveTotal);
  });

  it('minimizes movement across a longer, more chromatic progression too', () => {
    // i - bVI - bVII - i in A minor-ish (borrowed chords included).
    const chords: AbsChord[] = [
      { root: 9, quality: 'min' },
      { root: 5, quality: 'maj' },
      { root: 7, quality: 'maj' },
      { root: 9, quality: 'min' },
    ];
    const smart = voiceProgression(chords);
    const naive = chords.map((c) => naiveVoice(c));

    let smartTotal = 0;
    let naiveTotal = 0;
    for (let i = 1; i < chords.length; i++) {
      smartTotal += totalMovement(smart[i - 1], smart[i]);
      naiveTotal += totalMovement(naive[i - 1], naive[i]);
    }
    expect(smartTotal).toBeLessThanOrEqual(naiveTotal);
  });
});
