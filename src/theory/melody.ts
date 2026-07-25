// Melody lane data model and its conversion into playable bars.
//
// Pitches are stored **relative to the tonic**, the same principle the chord
// model follows: a melody written in C and then switched to F transposes with
// the progression instead of being stranded against it. Time is stored in lane
// steps (1/8 or 1/16 notes) rather than beats, because that is what the editor
// grid manipulates; `melodyToBars` is the one place that converts.
import { chordIntervals, type Key, type RelChord } from './chords.ts';
import type { NoteEvent } from './pattern.ts';
import { getScale } from './scales.ts';

export interface MelodyNote {
  /** Semitones above the key's tonic. 0 is the tonic at the lane's base
   * octave; the lane shows two octaves, so this is normally 0-24. */
  pitch: number;
  /** Step index from the start of the progression (not from its own bar). */
  start: number;
  /** Length in steps; at least 1. */
  length: number;
  velocity?: number;
}

export interface MelodyLane {
  /** Lane resolution: 8 = eighth notes per bar, 16 = sixteenths. */
  stepsPerBar: 8 | 16;
  notes: MelodyNote[];
}

/** MIDI note for the tonic at the lane's base octave (C4-ish register, above
 * the default chord voicing window's center so leads sit over the chords). */
export const MELODY_BASE_MIDI = 72;

/** How many rows the editor shows: two octaves, tonic to tonic. */
export const MELODY_ROWS = 25;

export function emptyMelody(stepsPerBar: 8 | 16 = 8): MelodyLane {
  return { stepsPerBar, notes: [] };
}

export function melodyPitchToMidi(pitch: number, key: Key): number {
  return MELODY_BASE_MIDI + key.tonic + pitch;
}

/**
 * How a lane row relates to the chord sounding under it — the editor colors
 * rows with this, and the generator uses the same classification to decide
 * what counts as a "safe" note.
 *
 * Chord tones come from `chordIntervals`, so a bar carrying a 9th or a sus
 * modifier offers exactly the tones that chord actually contains.
 */
export function melodyRowKind(
  pitch: number,
  chord: RelChord | null,
  key: Key,
): 'chord' | 'scale' | 'off' {
  const pc = ((pitch % 12) + 12) % 12;
  if (chord) {
    const tones = chordIntervals(chord.quality, chord.mods).map(
      (iv) => (((chord.degree + iv) % 12) + 12) % 12,
    );
    if (tones.includes(pc)) return 'chord';
  }
  return getScale(key.scale).intervals.includes(pc) ? 'scale' : 'off';
}

const DEFAULT_MELODY_VELOCITY = 88;

/**
 * The lane as one flat list of `NoteEvent`s whose `startBeat` is measured from
 * the start of the *progression* rather than from any bar. Everything that
 * places melody on a timeline builds from this: `.mid` export writes absolute
 * ticks straight from it, and `melodyToSegments` buckets it.
 */
export function melodyToEvents(lane: MelodyLane, key: Key, beatsPerBar = 4): NoteEvent[] {
  const beatsPerStep = beatsPerBar / lane.stepsPerBar;
  return lane.notes
    .map((note) => ({
      note: melodyPitchToMidi(note.pitch, key),
      startBeat: note.start * beatsPerStep,
      durationBeats: Math.max(1, note.length) * beatsPerStep,
      velocity: note.velocity ?? DEFAULT_MELODY_VELOCITY,
    }))
    .sort((a, b) => a.startBeat - b.startBeat || a.note - b.note);
}

/**
 * Group lane notes into per-segment `NoteEvent` lists, ready for
 * `playProgression`: one entry per chord slot, each note's `startBeat`
 * rewritten relative to its own segment's start.
 *
 * `segmentBeats` is how long each slot lasts, which since chords carry their
 * own rhythm is no longer one bar each. Notes are filed under the segment they
 * *start* in and keep their full length, so a note tied across a chord change
 * (or a barline) stays one note rather than being chopped at the boundary —
 * playback schedules it from the segment's start time and it rings on into
 * whatever follows.
 */
export function melodyToSegments(
  lane: MelodyLane,
  key: Key,
  segmentBeats: readonly number[],
  beatsPerBar = 4,
): (NoteEvent[] | null)[] {
  const segments: (NoteEvent[] | null)[] = new Array(segmentBeats.length).fill(null);
  const starts: number[] = [];
  let at = 0;
  for (const beats of segmentBeats) {
    starts.push(at);
    at += beats;
  }
  const total = at;

  for (const event of melodyToEvents(lane, key, beatsPerBar)) {
    if (event.startBeat < 0 || event.startBeat >= total) continue;
    // The last segment starting at or before the note wins; segments are
    // contiguous, so that is the one sounding when it begins.
    let index = starts.length - 1;
    while (index > 0 && starts[index] > event.startBeat + 1e-9) index--;
    (segments[index] ??= []).push({ ...event, startBeat: event.startBeat - starts[index] });
  }
  return segments;
}

/**
 * `melodyToSegments` for a plain one-chord-per-bar timeline: `barCount` equal
 * bars. Kept because plenty of callers (and the generator's own round-trip
 * tests) think in bars.
 */
export function melodyToBars(
  lane: MelodyLane,
  key: Key,
  barCount: number,
  beatsPerBar = 4,
): (NoteEvent[] | null)[] {
  return melodyToSegments(lane, key, new Array(barCount).fill(beatsPerBar), beatsPerBar);
}

/** Re-grid the lane when the user switches 1/8 <-> 1/16, keeping notes where
 * they sound rather than where their step indices happen to land. */
export function setMelodyResolution(lane: MelodyLane, stepsPerBar: 8 | 16): MelodyLane {
  if (stepsPerBar === lane.stepsPerBar) return lane;
  const factor = stepsPerBar / lane.stepsPerBar;
  return {
    stepsPerBar,
    notes: lane.notes.map((n) => ({
      ...n,
      start: Math.round(n.start * factor),
      length: Math.max(1, Math.round(n.length * factor)),
    })),
  };
}

/** Insert a note, trimming or removing whatever it overlaps: the lane is
 * monophonic, so two notes never sound at once. */
export function addMelodyNote(lane: MelodyLane, note: MelodyNote): MelodyLane {
  const end = note.start + note.length;
  const kept: MelodyNote[] = [];
  for (const existing of lane.notes) {
    const exEnd = existing.start + existing.length;
    if (exEnd <= note.start || existing.start >= end) {
      kept.push(existing);
      continue;
    }
    // Overlap: keep only the part before the new note, if any.
    if (existing.start < note.start) {
      kept.push({ ...existing, length: note.start - existing.start });
    }
  }
  kept.push(note);
  kept.sort((a, b) => a.start - b.start);
  return { ...lane, notes: kept };
}

export function removeMelodyNote(lane: MelodyLane, index: number): MelodyLane {
  return { ...lane, notes: lane.notes.filter((_, i) => i !== index) };
}

/** Drop notes that fall outside a shrunken grid. */
export function clampMelody(lane: MelodyLane, barCount: number): MelodyLane {
  const limit = barCount * lane.stepsPerBar;
  const notes = lane.notes.filter((n) => n.start < limit);
  return notes.length === lane.notes.length ? lane : { ...lane, notes };
}
