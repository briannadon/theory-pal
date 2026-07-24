import { describe, expect, it } from 'vitest';
import {
  addMelodyNote,
  clampMelody,
  melodyPitchToMidi,
  melodyRowKind,
  melodyToBars,
  setMelodyResolution,
  MELODY_BASE_MIDI,
  type Key,
  type MelodyLane,
} from './index.ts';

const cMajor: Key = { tonic: 0, scale: 'ionian' };
const fMajor: Key = { tonic: 5, scale: 'ionian' };

function lane(notes: MelodyLane['notes'], stepsPerBar: 8 | 16 = 8): MelodyLane {
  return { stepsPerBar, notes };
}

describe('melody pitch space', () => {
  it('is relative to the tonic, so a key change transposes the line', () => {
    expect(melodyPitchToMidi(0, cMajor)).toBe(MELODY_BASE_MIDI);
    expect(melodyPitchToMidi(0, fMajor)).toBe(MELODY_BASE_MIDI + 5);
    expect(melodyPitchToMidi(7, cMajor)).toBe(MELODY_BASE_MIDI + 7);
  });
});

describe('melodyRowKind', () => {
  const cMaj7 = { degree: 0, quality: 'maj7' as const };

  it('marks the sounding chord’s own tones', () => {
    for (const pitch of [0, 4, 7, 11]) {
      expect(melodyRowKind(pitch, cMaj7, cMajor)).toBe('chord');
    }
    expect(melodyRowKind(12, cMaj7, cMajor)).toBe('chord'); // octave up
  });

  it('separates other scale tones from off-scale ones', () => {
    expect(melodyRowKind(2, cMaj7, cMajor)).toBe('scale'); // D
    expect(melodyRowKind(1, cMaj7, cMajor)).toBe('off'); // C#
  });

  it('counts modifier tones as chord tones', () => {
    const withNinth = { degree: 0, quality: 'maj7' as const, mods: { ninth: true } };
    expect(melodyRowKind(2, cMaj7, cMajor)).toBe('scale');
    expect(melodyRowKind(2, withNinth, cMajor)).toBe('chord'); // the 9th
  });

  it('falls back to scale membership where a bar has no chord', () => {
    expect(melodyRowKind(4, null, cMajor)).toBe('scale');
    expect(melodyRowKind(3, null, cMajor)).toBe('off');
  });
});

describe('melodyToBars', () => {
  it('files notes under the bar they start in, in beats from that bar', () => {
    const bars = melodyToBars(lane([{ pitch: 0, start: 0, length: 2 }, { pitch: 7, start: 10, length: 1 }]), cMajor, 2);
    expect(bars[0]).toEqual([
      { note: MELODY_BASE_MIDI, startBeat: 0, durationBeats: 1, velocity: 88 },
    ]);
    expect(bars[1]).toEqual([
      { note: MELODY_BASE_MIDI + 7, startBeat: 1, durationBeats: 0.5, velocity: 88 },
    ]);
  });

  it('keeps notes tied across a barline whole, rather than splitting them', () => {
    const bars = melodyToBars(lane([{ pitch: 0, start: 6, length: 6 }]), cMajor, 2);
    expect(bars[0]).toEqual([
      { note: MELODY_BASE_MIDI, startBeat: 3, durationBeats: 3, velocity: 88 },
    ]);
    expect(bars[1]).toBeNull();
  });

  it('leaves empty bars null and drops notes past the end', () => {
    const bars = melodyToBars(lane([{ pitch: 0, start: 40, length: 1 }]), cMajor, 2);
    expect(bars).toEqual([null, null]);
  });
});

describe('lane editing', () => {
  it('is monophonic: a new note trims what it lands on', () => {
    const start = lane([{ pitch: 0, start: 0, length: 4 }]);
    const after = addMelodyNote(start, { pitch: 4, start: 2, length: 2 });
    expect(after.notes).toEqual([
      { pitch: 0, start: 0, length: 2 },
      { pitch: 4, start: 2, length: 2 },
    ]);
  });

  it('removes a note it completely covers', () => {
    const start = lane([{ pitch: 0, start: 2, length: 2 }]);
    const after = addMelodyNote(start, { pitch: 4, start: 0, length: 8 });
    expect(after.notes).toEqual([{ pitch: 4, start: 0, length: 8 }]);
  });

  it('re-grids notes when the resolution changes, keeping them where they sound', () => {
    const eighths = lane([{ pitch: 0, start: 4, length: 2 }], 8);
    const sixteenths = setMelodyResolution(eighths, 16);
    expect(sixteenths).toEqual({ stepsPerBar: 16, notes: [{ pitch: 0, start: 8, length: 4 }] });
    expect(setMelodyResolution(sixteenths, 8)).toEqual(eighths);
  });

  it('clamps notes stranded past a shrunken grid', () => {
    const start = lane([{ pitch: 0, start: 4, length: 1 }, { pitch: 0, start: 20, length: 1 }]);
    expect(clampMelody(start, 2).notes).toHaveLength(1);
    expect(clampMelody(start, 4)).toBe(start); // untouched when nothing is stranded
  });
});
