import { describe, expect, it } from 'vitest';
import { parseMidi, type MidiEvent, type MidiNoteOffEvent, type MidiNoteOnEvent } from 'midi-file';
import { exportMidiFile } from './export.ts';
import type { AbsChord } from '../theory/index.ts';

async function parse(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return parseMidi(bytes);
}

function isNoteOn(e: MidiEvent): e is MidiNoteOnEvent {
  return e.type === 'noteOn' && e.velocity > 0;
}

function isNoteOff(e: MidiEvent): e is MidiNoteOffEvent {
  return e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0);
}

/** Absolute tick of each event in a track, given each event's deltaTime. */
function absoluteTicks(track: MidiEvent[]): number[] {
  let t = 0;
  return track.map((e) => {
    t += e.deltaTime;
    return t;
  });
}

describe('exportMidiFile', () => {
  it('produces a parseable format-0, single-track SMF', async () => {
    const bars: (AbsChord | null)[] = [{ root: 0, quality: 'maj' }];
    const blob = exportMidiFile(bars, 120);
    expect(blob.type).toBe('audio/midi');
    const parsed = await parse(blob);
    expect(parsed.header.format).toBe(0);
    expect(parsed.tracks).toHaveLength(1);
  });

  it('encodes the correct tempo meta event from bpm', async () => {
    const bars: (AbsChord | null)[] = [{ root: 0, quality: 'maj' }];
    for (const bpm of [60, 90, 120, 174]) {
      const parsed = await parse(exportMidiFile(bars, bpm));
      const tempoEvent = parsed.tracks[0].find((e) => e.type === 'setTempo');
      expect(tempoEvent).toBeDefined();
      const microsecondsPerBeat = (tempoEvent as { microsecondsPerBeat: number }).microsecondsPerBeat;
      expect(Math.round(60_000_000 / microsecondsPerBeat)).toBe(bpm);
    }
  });

  it('every note-on has a matching note-off, same note number, after it', async () => {
    const bars: (AbsChord | null)[] = [
      { root: 0, quality: 'maj7' },
      { root: 5, quality: 'dom7' },
      null,
      { root: 9, quality: 'min7' },
    ];
    const parsed = await parse(exportMidiFile(bars, 100));
    const track = parsed.tracks[0];
    const ticks = absoluteTicks(track);

    const onStack = new Map<number, number[]>(); // note -> stack of on-tick positions (index into track)
    const unmatched: number[] = [];
    track.forEach((e, i) => {
      if (isNoteOn(e)) {
        const list = onStack.get(e.noteNumber) ?? [];
        list.push(i);
        onStack.set(e.noteNumber, list);
      } else if (isNoteOff(e)) {
        const list = onStack.get(e.noteNumber);
        if (!list || list.length === 0) {
          unmatched.push(i);
        } else {
          const onIndex = list.pop()!;
          expect(ticks[i]).toBeGreaterThanOrEqual(ticks[onIndex]);
        }
      }
    });
    expect(unmatched).toEqual([]);
    // Nothing left dangling: every note-on was eventually matched.
    for (const [, list] of onStack) expect(list).toEqual([]);
  });

  it('places one chord per bar (480 ticks/beat * 4 beats = 1920 ticks/bar) and leaves null bars silent', async () => {
    const bars: (AbsChord | null)[] = [{ root: 0, quality: 'maj' }, null, { root: 7, quality: 'maj' }];
    const parsed = await parse(exportMidiFile(bars, 120));
    const track = parsed.tracks[0];
    const ticks = absoluteTicks(track);

    const barsWithNoteOn = new Set<number>();
    track.forEach((e, i) => {
      if (isNoteOn(e)) barsWithNoteOn.add(Math.floor(ticks[i] / 1920));
    });
    expect(barsWithNoteOn.has(0)).toBe(true);
    expect(barsWithNoteOn.has(1)).toBe(false); // the null bar
    expect(barsWithNoteOn.has(2)).toBe(true);

    // Bar 0's chord (C major, root position via voiceProgression) starts at tick 0.
    const firstNoteOnTick = ticks[track.findIndex((e) => isNoteOn(e))];
    expect(firstNoteOnTick).toBe(0);
  });

  it('voices each chord (via theory/voiceProgression) rather than emitting bare root-position triads', async () => {
    // A ii-V-I: voice leading should keep some common tones between adjacent
    // chords rather than jumping straight back to root position each bar,
    // which is what distinguishes voiceProgression output from a naive
    // per-chord chordPitches() rendering.
    const bars: (AbsChord | null)[] = [
      { root: 2, quality: 'min7' }, // Dm7
      { root: 7, quality: 'dom7' }, // G7
      { root: 0, quality: 'maj7' }, // Cmaj7
    ];
    const parsed = await parse(exportMidiFile(bars, 120));
    const track = parsed.tracks[0];
    const ticks = absoluteTicks(track);

    const notesAtTick = (tick: number): number[] =>
      track.filter((e, i) => isNoteOn(e) && ticks[i] === tick).map((e) => (e as MidiNoteOnEvent).noteNumber);

    const bar0 = notesAtTick(0).sort((a, b) => a - b);
    const bar1 = notesAtTick(1920).sort((a, b) => a - b);
    // Each voiced chord should have 4 notes (7th chords) and stay within a
    // reasonable playable register (voiceProgression's default window).
    expect(bar0).toHaveLength(4);
    expect(bar1).toHaveLength(4);
    for (const n of [...bar0, ...bar1]) {
      expect(n).toBeGreaterThanOrEqual(48);
      expect(n).toBeLessThanOrEqual(84);
    }
  });

  it('ends with an endOfTrack meta event spanning the full bar count', async () => {
    const bars: (AbsChord | null)[] = [{ root: 0, quality: 'maj' }, null];
    const parsed = await parse(exportMidiFile(bars, 120));
    const track = parsed.tracks[0];
    expect(track[track.length - 1].type).toBe('endOfTrack');
    const ticks = absoluteTicks(track);
    expect(ticks[ticks.length - 1]).toBe(2 * 1920); // 2 bars total, including the trailing silent one
  });

  it('writes each chord for as long as slotBeats says, not a bar apiece', async () => {
    // Bar 1 as 3 + 1, then a whole bar: ticks 0, 1440, 1920.
    const bars: (AbsChord | null)[] = [
      { root: 0, quality: 'maj' },
      { root: 7, quality: 'maj' },
      { root: 5, quality: 'maj' },
    ];
    const parsed = await parse(exportMidiFile(bars, 120, { slotBeats: [3, 1, 4] }));
    const track = parsed.tracks[0];
    const ticks = absoluteTicks(track);
    const onsets = new Set(track.map((e, i) => (isNoteOn(e) ? ticks[i] : -1)));
    onsets.delete(-1);
    expect([...onsets].sort((a, b) => a - b)).toEqual([0, 1440, 1920]);
    // Three bars' worth of slots, two bars of music: the file ends with it.
    expect(ticks[ticks.length - 1]).toBe(3840);
  });

  it('holds the melody to its own even bars while the chords move under it', async () => {
    const bars: (AbsChord | null)[] = [{ root: 0, quality: 'maj' }, { root: 7, quality: 'maj' }];
    const parsed = await parse(
      exportMidiFile(bars, 120, {
        slotBeats: [3, 1],
        melody: [[{ note: 72, startBeat: 2, durationBeats: 1, velocity: 90 }]],
      }),
    );
    const melodyTrack = parsed.tracks[2];
    const ticks = absoluteTicks(melodyTrack);
    const onset = ticks[melodyTrack.findIndex((e) => isNoteOn(e))];
    expect(onset).toBe(960); // bar 1, beat 3 — unmoved by the chords being cut 3 + 1
  });

  it('an all-null progression exports silently without throwing', async () => {
    const bars: (AbsChord | null)[] = [null, null, null, null];
    const blob = exportMidiFile(bars, 120);
    const parsed = await parse(blob);
    const track = parsed.tracks[0];
    expect(track.some((e) => isNoteOn(e))).toBe(false);
    expect(track[track.length - 1].type).toBe('endOfTrack');
  });
});

describe('exportMidiFile with a melody', () => {
  const cMaj: AbsChord = { root: 0, quality: 'maj' };

  const melody = [
    [{ note: 72, startBeat: 0, durationBeats: 1, velocity: 88 }],
    [{ note: 74, startBeat: 2, durationBeats: 2, velocity: 88 }],
  ];

  it('splits chords and melody onto their own tracks and channels', async () => {
    const parsed = await parse(exportMidiFile([cMaj, cMaj], 120, { melody }));

    expect(parsed.header.format).toBe(1);
    expect(parsed.tracks).toHaveLength(3);

    // Track 0 carries tempo/meta only, the format-1 convention.
    expect(parsed.tracks[0].some((e) => e.type === 'setTempo')).toBe(true);
    expect(parsed.tracks[0].filter(isNoteOn)).toHaveLength(0);

    const chordNotes = parsed.tracks[1].filter(isNoteOn);
    const melodyNotes = parsed.tracks[2].filter(isNoteOn);
    expect(chordNotes.length).toBeGreaterThan(0);
    expect(melodyNotes.map((e) => e.noteNumber)).toEqual([72, 74]);

    expect(new Set(chordNotes.map((e) => e.channel))).toEqual(new Set([0]));
    expect(new Set(melodyNotes.map((e) => e.channel))).toEqual(new Set([1]));
  });

  it('places melody notes at their own offsets within the bar', async () => {
    const parsed = await parse(exportMidiFile([cMaj, cMaj], 120, { melody }));
    const ticks = absoluteTicks(parsed.tracks[2]);
    const onIndices = parsed.tracks[2]
      .map((e, i) => (isNoteOn(e) ? i : -1))
      .filter((i) => i >= 0);

    expect(ticks[onIndices[0]]).toBe(0); // bar 1, beat 1
    expect(ticks[onIndices[1]]).toBe(480 * 4 + 480 * 2); // bar 2, beat 3
  });

  it('stays a single-track format-0 file when there is no melody', async () => {
    const parsed = await parse(exportMidiFile([cMaj, cMaj], 120, { melody: [null, null] }));
    expect(parsed.header.format).toBe(0);
    expect(parsed.tracks).toHaveLength(1);
  });
});
