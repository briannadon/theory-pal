// Shared playback pass for the progression grid (SPEC.md `src/audio/`:
// "Export a playProgression-style API the UI can drive"). One `StepScheduler`
// drives both sinks — the internal piano and, if wired up, live MIDI out —
// from the same `onStep` callback, so there is exactly one source of timing
// truth instead of the audio and MIDI paths each keeping their own clock.
//
// Audio gets sample-accurate scheduling for free: `AudioEngine.playAt` takes
// an `AudioContext.currentTime`-relative timestamp and Web Audio schedules it
// precisely regardless of when, within the lookahead window, `onStep` itself
// actually runs. MIDI has no equivalent local clock to schedule against, so
// this module correlates the two timelines once per `start()` call — sampling
// the wall clock (`now`, `performance.now()` by default) and the scheduling
// clock at the same instant gives an offset used to convert every step's
// `AudioContext`-relative time into the `performance.now()`-timebase
// timestamp `MidiOut.sendChord` expects.
import type { VoicedChord } from '../theory/index.ts';
import type { MidiOut } from '../midi/index.ts';
import type { AudioEngine } from './engine.ts';
import { StepScheduler, realTimeTicker, type Clock, type Ticker } from './scheduler.ts';

export interface PlayProgressionOptions {
  /** One voiced chord per bar-slot; `null` is a silent bar. */
  chords: (VoicedChord | null)[];
  bpm: number;
  loop?: boolean;
  /** Beats per bar. Default 4 (SPEC.md v1: one chord per 4/4 bar). */
  beatsPerBar?: number;
  velocity?: number;
  /** Internal piano sink. Omit, or toggle off via `AudioEngine.setEnabled(false)`,
   * for MIDI-out-only playback. */
  audio?: AudioEngine;
  /** Live MIDI sink. Only used while `midi.available` — safe to always pass
   * a `MidiOut` even when access hasn't been granted. */
  midi?: MidiOut;
  /** UI hook, e.g. to highlight the currently-playing grid cell. */
  onStep?: (index: number, timeSec: number) => void;
  /** Scheduler tuning — see scheduler.ts. Defaults: 25ms tick, 100ms lookahead. */
  tickMs?: number;
  lookaheadSec?: number;
  /** Advanced/test overrides. */
  clock?: Clock;
  ticker?: Ticker;
  /** Wall clock, `performance.now()`-timebase. Defaults to `performance.now`. */
  now?: () => number;
}

export interface Playback {
  start(): void;
  stop(): void;
  readonly playing: boolean;
}

const DEFAULT_BEATS_PER_BAR = 4;
const DEFAULT_VELOCITY = 100;

export function playProgression(opts: PlayProgressionOptions): Playback {
  const beatsPerBar = opts.beatsPerBar ?? DEFAULT_BEATS_PER_BAR;
  const stepDurationSec = (60 / opts.bpm) * beatsPerBar;
  const velocity = opts.velocity ?? DEFAULT_VELOCITY;
  const wallNow = opts.now ?? (() => performance.now());
  const audio = opts.audio;
  const midi = opts.midi;

  const clock: Clock = opts.clock ?? { now: () => (audio ? audio.currentTime : wallNow() / 1000) };
  const ticker = opts.ticker ?? realTimeTicker;

  // Set once per start(): the offset between the wall clock and the
  // scheduling clock, so a step's `time` (in the scheduling clock's
  // timebase) can be converted to a performance.now()-timebase timestamp for
  // MidiOut.sendChord. Recomputed on every start() in case the two clocks
  // have drifted apart while stopped (e.g. the AudioContext was suspended).
  let midiOffsetMs: number | null = null;

  const scheduler = new StepScheduler(
    clock,
    ticker,
    opts.chords.length,
    stepDurationSec,
    (index, time) => {
      opts.onStep?.(index, time);
      const chord = opts.chords[index];
      if (!chord || chord.notes.length === 0) return;
      const beatDurationSec = 60 / opts.bpm;
      const noteDurationSec = beatDurationSec * 0.85;
      for (let b = 0; b < beatsPerBar; b++) {
        const beatTime = time + b * beatDurationSec;
        audio?.playAt(chord.notes, beatTime, noteDurationSec, velocity);
        if (midi?.available && midiOffsetMs !== null) {
          midi.sendChord(chord.notes, noteDurationSec * 1000, velocity, midiOffsetMs + beatTime * 1000);
        }
      }
    },
    { tickMs: opts.tickMs, lookaheadSec: opts.lookaheadSec, loop: opts.loop ?? false },
  );

  return {
    start(): void {
      midiOffsetMs = wallNow() - clock.now() * 1000;
      scheduler.start();
    },
    stop(): void {
      scheduler.stop();
      audio?.stopAll();
      midi?.stopAll();
    },
    get playing(): boolean {
      return scheduler.running;
    },
  };
}
