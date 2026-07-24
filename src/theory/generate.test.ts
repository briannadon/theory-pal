// The generator is a rule engine, so it's tested as one: the properties that
// define "this sounds like a melody" hold at surprise 0, and loosen — in the
// documented order — as the slider rises. Exact note-for-note output is not
// asserted; that would freeze arbitrary implementation detail.
import { describe, expect, it } from 'vitest';
import { generateMelody, getScale, melodyRowKind, type Key, type RelChord } from './index.ts';

const cMajor: Key = { tonic: 0, scale: 'ionian' };

// I - vi - IV - V, the workhorse test progression.
const slots: (RelChord | null)[] = [
  { degree: 0, quality: 'maj' },
  { degree: 9, quality: 'min' },
  { degree: 5, quality: 'maj' },
  { degree: 7, quality: 'dom7' },
];

function generate(surprise: number, seed = 7, stepsPerBar: 8 | 16 = 8) {
  return generateMelody({ slots, key: cMajor, stepsPerBar, surprise, seed });
}

function kinds(surpriseLevel: number, seed = 7) {
  const lane = generate(surpriseLevel, seed);
  return lane.notes.map((n) => ({
    ...n,
    bar: Math.floor(n.start / lane.stepsPerBar),
    strong: n.start % (lane.stepsPerBar / 2) === 0,
    kind: melodyRowKind(n.pitch, slots[Math.floor(n.start / lane.stepsPerBar)], cMajor),
  }));
}

describe('generateMelody', () => {
  it('writes notes across every bar of the progression', () => {
    const lane = generate(0);
    expect(lane.notes.length).toBeGreaterThanOrEqual(2 * slots.length); // sparsest cell is 2/bar
    const bars = new Set(lane.notes.map((n) => Math.floor(n.start / lane.stepsPerBar)));
    expect(bars).toEqual(new Set([0, 1, 2, 3]));
  });

  it('is deterministic: same seed and settings give the same melody', () => {
    expect(generate(0.5, 42)).toEqual(generate(0.5, 42));
    expect(generate(0.5, 42)).not.toEqual(generate(0.5, 43));
  });

  it('at surprise 0, every strong beat is a chord tone', () => {
    for (const note of kinds(0)) {
      if (note.strong) expect(note.kind).toBe('chord');
    }
  });

  it('at surprise 0, stays inside the scale entirely', () => {
    const scale = getScale('ionian').intervals;
    for (const note of generate(0).notes) {
      expect(scale).toContain(((note.pitch % 12) + 12) % 12);
    }
  });

  it('lands the phrase on a stable tone at low surprise', () => {
    const lane = generate(0);
    const last = lane.notes[lane.notes.length - 1];
    expect(melodyRowKind(last.pitch, slots[3], cMajor)).toBe('chord');
  });

  it('stays within the lane’s pitch range', () => {
    for (const surpriseLevel of [0, 0.3, 0.6, 1]) {
      for (const note of generate(surpriseLevel).notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(0);
        expect(note.pitch).toBeLessThanOrEqual(24);
      }
    }
  });

  it('introduces more non-chord tones as surprise rises', () => {
    const strayRate = (s: number) => {
      let stray = 0;
      let total = 0;
      for (let seed = 1; seed <= 30; seed++) {
        for (const note of kinds(s, seed)) {
          total++;
          if (note.kind !== 'chord') stray++;
        }
      }
      return stray / total;
    };
    expect(strayRate(0.8)).toBeGreaterThan(strayRate(0.1));
  });

  it('only leaves the scale once the chromatic gate opens', () => {
    const scale = getScale('ionian').intervals;
    const offScale = (s: number) => {
      let count = 0;
      for (let seed = 1; seed <= 30; seed++) {
        for (const note of generateMelody({ slots, key: cMajor, stepsPerBar: 8, surprise: s, seed })
          .notes) {
          if (!scale.includes(((note.pitch % 12) + 12) % 12)) count++;
        }
      }
      return count;
    };
    expect(offScale(0.3)).toBe(0); // below the 0.6 chromatic gate
    expect(offScale(1)).toBeGreaterThan(0);
  });

  it('notes never overlap: the lane is a single voice', () => {
    for (const surpriseLevel of [0, 0.5, 1]) {
      const notes = generate(surpriseLevel).notes;
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i].start).toBeGreaterThanOrEqual(notes[i - 1].start + notes[i - 1].length);
      }
    }
  });

  it('honors the lane resolution', () => {
    const lane = generate(0.4, 7, 16);
    expect(lane.stepsPerBar).toBe(16);
    expect(Math.max(...lane.notes.map((n) => n.start))).toBeLessThan(4 * 16);
  });

  it('handles an empty or chordless grid without throwing', () => {
    expect(generateMelody({ slots: [], key: cMajor, stepsPerBar: 8 }).notes).toEqual([]);
    const overNulls = generateMelody({ slots: [null, null], key: cMajor, stepsPerBar: 8, seed: 3 });
    expect(overNulls.notes.length).toBeGreaterThan(0); // falls back to the scale
  });
});
