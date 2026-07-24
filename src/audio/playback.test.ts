import { describe, expect, it, vi } from 'vitest';
import { playProgression } from './playback.ts';
import type { Clock, Ticker } from './scheduler.ts';
import type { AudioEngine } from './engine.ts';
import type { MidiOut, MidiPort } from '../midi/index.ts';
import type { VoicedChord } from '../theory/index.ts';

function fakeClock(): Clock & { set(sec: number): void } {
  let t = 0;
  return { now: () => t, set: (sec) => (t = sec) };
}

function manualTicker(): Ticker & { tick(): void } {
  let fn: (() => void) | null = null;
  return {
    start(tick) {
      fn = tick;
      return 'h';
    },
    stop() {
      fn = null;
    },
    tick() {
      fn?.();
    },
  };
}

function fakeAudioEngine(): AudioEngine & { playAtCalls: unknown[]; stopAllCalls: number } {
  const playAtCalls: unknown[] = [];
  let stopAllCalls = 0;
  return {
    playAtCalls,
    get stopAllCalls() {
      return stopAllCalls;
    },
    preload: vi.fn(async () => {}),
    init: vi.fn(async () => {}),
    playChord: vi.fn(),
    playAt: vi.fn((notes: number[], whenSec: number, durationSec: number, velocity?: number) => {
      playAtCalls.push({ notes, whenSec, durationSec, velocity });
    }),
    stopAll: vi.fn(() => {
      stopAllCalls++;
    }),
    setEnabled: vi.fn(),
    currentTime: 0,
  };
}

function fakeMidiOut(available: boolean): MidiOut & { sendChordCalls: unknown[]; stopAllCalls: number } {
  const sendChordCalls: unknown[] = [];
  let stopAllCalls = 0;
  return {
    sendChordCalls,
    get stopAllCalls() {
      return stopAllCalls;
    },
    requestAccess: vi.fn(async (): Promise<MidiPort[]> => []),
    selectPort: vi.fn(),
    sendChord: vi.fn((notes: number[], durationMs: number, velocity?: number, whenMs?: number) => {
      sendChordCalls.push({ notes, durationMs, velocity, whenMs });
    }),
    stopAll: vi.fn(() => {
      stopAllCalls++;
    }),
    available,
  };
}

function chord(notes: number[]): VoicedChord {
  return { notes };
}

describe('playProgression', () => {
  it('schedules each bar through the audio engine at the right time and duration', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const audio = fakeAudioEngine();

    const playback = playProgression({
      chords: [chord([60, 64, 67]), chord([65, 69, 72])],
      bpm: 120, // 2s/bar at 4 beats/bar
      audio,
      clock,
      ticker,
      lookaheadSec: 0.1,
    });

    playback.start();
    ticker.tick(); // first poll — start() only registers with the ticker, mirroring setInterval
    expect(audio.playAtCalls).toEqual([
      { notes: [60, 64, 67], whenSec: 0, durationSec: 0.425, velocity: 100 },
      { notes: [60, 64, 67], whenSec: 0.5, durationSec: 0.425, velocity: 100 },
      { notes: [60, 64, 67], whenSec: 1, durationSec: 0.425, velocity: 100 },
      { notes: [60, 64, 67], whenSec: 1.5, durationSec: 0.425, velocity: 100 },
    ]);

    clock.set(1.95);
    ticker.tick();
    expect(audio.playAtCalls).toEqual([
      { notes: [60, 64, 67], whenSec: 0, durationSec: 0.425, velocity: 100 },
      { notes: [60, 64, 67], whenSec: 0.5, durationSec: 0.425, velocity: 100 },
      { notes: [60, 64, 67], whenSec: 1, durationSec: 0.425, velocity: 100 },
      { notes: [60, 64, 67], whenSec: 1.5, durationSec: 0.425, velocity: 100 },
      { notes: [65, 69, 72], whenSec: 2, durationSec: 0.425, velocity: 100 },
      { notes: [65, 69, 72], whenSec: 2.5, durationSec: 0.425, velocity: 100 },
      { notes: [65, 69, 72], whenSec: 3, durationSec: 0.425, velocity: 100 },
      { notes: [65, 69, 72], whenSec: 3.5, durationSec: 0.425, velocity: 100 },
    ]);
    expect(playback.playing).toBe(true);

    clock.set(4.0);
    ticker.tick();
    expect(playback.playing).toBe(false); // 2-bar, non-looping sequence is done
  });

  it('skips null slots (silence) without calling the audio engine, but still fires onStep', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const audio = fakeAudioEngine();
    const steps: number[] = [];

    const playback = playProgression({
      chords: [chord([60]), null, chord([67])],
      bpm: 120,
      audio,
      clock,
      ticker,
      onStep: (i) => steps.push(i),
    });

    playback.start();
    clock.set(1.95);
    ticker.tick();
    clock.set(3.95);
    ticker.tick();

    expect(steps).toEqual([0, 1, 2]);
    expect(audio.playAtCalls).toHaveLength(8); // 4 quarter notes for chord 1 + 4 quarter notes for chord 3
  });

  it('drives MIDI from the same scheduler, converting step time to a performance.now()-timebase timestamp', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const audio = fakeAudioEngine();
    const midi = fakeMidiOut(true);
    let wall = 100_000; // arbitrary performance.now() epoch offset
    const now = () => wall;

    const playback = playProgression({
      chords: [chord([60]), chord([64])],
      bpm: 120, // 2s/bar
      audio,
      midi,
      clock,
      ticker,
      now,
    });

    playback.start(); // captures offset = wall(100000) - clock.now()*1000 (0) = 100000
    ticker.tick(); // first poll
    expect(midi.sendChordCalls).toEqual([
      { notes: [60], durationMs: 425, velocity: 100, whenMs: 100000 },
      { notes: [60], durationMs: 425, velocity: 100, whenMs: 100500 },
      { notes: [60], durationMs: 425, velocity: 100, whenMs: 101000 },
      { notes: [60], durationMs: 425, velocity: 100, whenMs: 101500 },
    ]);

    clock.set(1.95);
    wall = 101_950; // wall clock advanced in lockstep with the scheduling clock
    ticker.tick();
    expect(midi.sendChordCalls).toEqual([
      { notes: [60], durationMs: 425, velocity: 100, whenMs: 100000 },
      { notes: [60], durationMs: 425, velocity: 100, whenMs: 100500 },
      { notes: [60], durationMs: 425, velocity: 100, whenMs: 101000 },
      { notes: [60], durationMs: 425, velocity: 100, whenMs: 101500 },
      { notes: [64], durationMs: 425, velocity: 100, whenMs: 102000 },
      { notes: [64], durationMs: 425, velocity: 100, whenMs: 102500 },
      { notes: [64], durationMs: 425, velocity: 100, whenMs: 103000 },
      { notes: [64], durationMs: 425, velocity: 100, whenMs: 103500 },
    ]);
  });

  it('does not touch MidiOut at all when unavailable', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const audio = fakeAudioEngine();
    const midi = fakeMidiOut(false);

    const playback = playProgression({ chords: [chord([60])], bpm: 120, audio, midi, clock, ticker });
    playback.start();
    ticker.tick();

    expect(midi.sendChordCalls).toEqual([]);
    expect(audio.playAtCalls).toHaveLength(4);
  });

  it('loops the progression indefinitely when loop is true', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const audio = fakeAudioEngine();

    const playback = playProgression({
      chords: [chord([60]), chord([64])],
      bpm: 120,
      loop: true,
      audio,
      clock,
      ticker,
    });

    playback.start();
    for (const t of [1.95, 3.95, 5.95]) {
      clock.set(t);
      ticker.tick();
    }
    expect(audio.playAtCalls.map((c) => (c as { whenSec: number }).whenSec)).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5,
    ]);
    expect(playback.playing).toBe(true);
  });

  it('stop() halts the scheduler and silences both sinks', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const audio = fakeAudioEngine();
    const midi = fakeMidiOut(true);

    const playback = playProgression({
      chords: [chord([60]), chord([64]), chord([67])],
      bpm: 120,
      loop: true,
      audio,
      midi,
      clock,
      ticker,
    });

    playback.start();
    playback.stop();

    expect(playback.playing).toBe(false);
    expect(audio.stopAllCalls).toBe(1);
    expect(midi.stopAllCalls).toBe(1);

    // Nothing further fires even if the (now-detached) tick were invoked again.
    const before = audio.playAtCalls.length;
    clock.set(100);
    ticker.tick();
    expect(audio.playAtCalls).toHaveLength(before);
  });
});
