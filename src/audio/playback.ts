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
import {
  DEFAULT_BAR_STYLE,
  renderBar,
  type BarStyle,
  type NoteEvent,
  type VoicedChord,
} from '../theory/index.ts';
import { MIDI_CHANNEL, type MidiOut } from '../midi/index.ts';
import type { AudioEngine, Voice } from './engine.ts';
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
  /** How each bar's chord is played: block chords (default) or an arpeggio.
   * See theory/pattern.ts. */
  style?: BarStyle;
  /** Melody notes per bar-slot, already in beats-from-bar-start form. Indexed
   * like `chords`; a missing or null entry is a bar with no melody. Scheduled
   * alongside the chord from the same timeline, so the lead can never drift
   * against the accompaniment. */
  melody?: (NoteEvent[] | null)[];
  /** Seeded RNG for styles that need one (`random` arpeggios). */
  rng?: () => number;
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
  const style: BarStyle = { velocity, ...(opts.style ?? DEFAULT_BAR_STYLE) };
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
      const beatDurationSec = 60 / opts.bpm;

      // Everything audible in this bar — the chord under the current playing
      // style, plus any melody notes written for it — is one flat list of
      // NoteEvents, so both sinks schedule from identical material and a new
      // style never needs a second scheduling path.
      const chord = opts.chords[index];
      const sources: { events: NoteEvent[]; voice: Voice; channel: number }[] = [];
      if (chord && chord.notes.length > 0) {
        sources.push({
          events: renderBar(chord, style, beatsPerBar, opts.rng),
          voice: 'chords',
          channel: MIDI_CHANNEL.chords,
        });
      }
      const melodyBar = opts.melody?.[index];
      if (melodyBar && melodyBar.length > 0) {
        sources.push({ events: melodyBar, voice: 'melody', channel: MIDI_CHANNEL.melody });
      }

      // Both sources are scheduled from this one step's `time`, so the lead
      // cannot drift against the accompaniment, but each keeps its own audio
      // voice and MIDI channel so they stay separately mixable and routable.
      for (const { events, voice, channel } of sources) {
        for (const ev of events) {
          const startSec = time + ev.startBeat * beatDurationSec;
          const durationSec = ev.durationBeats * beatDurationSec;
          audio?.playAt([ev.note], startSec, durationSec, ev.velocity, voice);
          if (midi?.available && midiOffsetMs !== null) {
            midi.sendChord(
              [ev.note],
              durationSec * 1000,
              ev.velocity,
              midiOffsetMs + startSec * 1000,
              channel,
            );
          }
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
