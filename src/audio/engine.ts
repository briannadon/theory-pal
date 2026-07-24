// SoundFont piano playback (SPEC.md `src/audio/`). Built on `smplr`'s
// `SplendidGrandPiano` — a sampled Steinway grand shipped by smplr itself and
// fetched from smplr's own sample host at instrument-creation time, so there
// is nothing to vendor into `public/`. Nothing happens at module import time;
// loading starts when the app calls `preload()` (samples only — no user
// gesture needed) or `init()` (samples plus the gesture-gated context
// resume browsers require before audio can actually sound).
//
// Two voices, chords and melody, each its own instrument with its own output
// channel so they can be balanced against each other. They share one
// `SampleLoader`, so the second voice costs no extra download — smplr's loader
// caches decoded buffers by URL, which is the whole reason it is shareable.
//
// `contextFactory` / `instrumentFactory` are injectable so this class is
// unit-testable without a real browser AudioContext (see engine.test.ts).
import { SplendidGrandPiano, type SampleLoader, type Smplr } from 'smplr';

/** Independently mixable sources. Chords are the progression grid; melody is
 * the lead lane. */
export type Voice = 'chords' | 'melody';

export const VOICES: readonly Voice[] = ['chords', 'melody'];

export interface AudioEngine {
  preload(): Promise<void>;
  init(): Promise<void>;
  playChord(notes: number[], durationSec?: number, velocity?: number, voice?: Voice): void;
  playAt(
    notes: number[],
    whenSec: number,
    durationSec: number,
    velocity?: number,
    voice?: Voice,
  ): void;
  stopAll(): void;
  setEnabled(on: boolean): void;
  /** Level for one voice, 0-1. Applied to that voice's output channel, so it
   * is a true fader rather than a velocity change: the piano keeps its timbre
   * as it gets quieter. */
  setVolume(voice: Voice, level: number): void;
  readonly currentTime: number;
}

export interface AudioEngineOptions {
  /** Defaults to `() => new AudioContext()`. Override in tests. */
  contextFactory?: () => AudioContext;
  /** Defaults to smplr's `SplendidGrandPiano`. Override in tests, or to swap
   * instruments. Called once per voice; `loader` is smplr's shared sample
   * cache, so only the first call actually fetches anything. */
  instrumentFactory?: (ctx: AudioContext, loader?: SampleLoader) => Smplr;
}

const DEFAULT_DURATION_SEC = 1.5;
const DEFAULT_VELOCITY = 100;
const DEFAULT_VOICE: Voice = 'chords';
/** smplr channel volumes are on the MIDI 0-127 scale. */
const MAX_CHANNEL_VOLUME = 127;

/** `AudioEngine` backed by smplr's sampled piano. Lazy: no `AudioContext` and
 * no sample fetch happens until `preload()` or `init()` is called. */
export class SmplrAudioEngine implements AudioEngine {
  private readonly contextFactory: () => AudioContext;
  private readonly instrumentFactory: (ctx: AudioContext, loader?: SampleLoader) => Smplr;

  private context: AudioContext | null = null;
  private instruments: Partial<Record<Voice, Smplr>> = {};
  private enabled = true;
  private loadPromise: Promise<void> | null = null;
  private readonly levels: Record<Voice, number> = { chords: 1, melody: 1 };

  constructor(options?: AudioEngineOptions) {
    this.contextFactory = options?.contextFactory ?? (() => new AudioContext());
    this.instrumentFactory =
      options?.instrumentFactory ?? ((ctx, loader) => SplendidGrandPiano(ctx, { loader }));
  }

  /** Fetch and decode the soundfont without requiring a user gesture. The
   * AudioContext is constructed here but deliberately left however the
   * browser hands it over (suspended, under autoplay policy) — decoding
   * samples doesn't need a running context, so the multi-second download can
   * overlap with the user reading the page instead of stalling their first
   * click. Idempotent; every caller awaits the same load. */
  preload(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const ctx = this.contextFactory();
        this.context = ctx;

        // The first voice does the downloading; the rest reuse its loader, so
        // a second instrument is just a second output channel over the same
        // decoded buffers.
        const first = this.instrumentFactory(ctx);
        this.instruments.chords = first;
        for (const voice of VOICES) {
          if (voice === 'chords') continue;
          this.instruments[voice] = this.instrumentFactory(ctx, first.loader);
        }
        for (const voice of VOICES) this.applyLevel(voice);

        await Promise.all(VOICES.map((v) => this.instruments[v]?.ready));
      })();
    }
    return this.loadPromise;
  }

  /** Idempotent: safe to call from multiple gesture handlers; every caller
   * awaits the same underlying load. The `resume()` half must run from a
   * user-gesture handler — the `preload()` half need not, and normally has
   * already finished by the time the first gesture arrives. */
  async init(): Promise<void> {
    await this.preload();
    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /** Audition a chord starting now, for `durationSec` (default 1.5s). No-op
   * before `init()` resolves or while disabled. */
  playChord(
    notes: number[],
    durationSec = DEFAULT_DURATION_SEC,
    velocity = DEFAULT_VELOCITY,
    voice: Voice = DEFAULT_VOICE,
  ): void {
    this.playAt(notes, this.currentTime, durationSec, velocity, voice);
  }

  /** Schedule a chord sample-accurately against `whenSec` (an `AudioContext.currentTime`-
   * relative timestamp — the scheduler in `scheduler.ts` supplies these). No-op
   * before `init()` resolves or while disabled via `setEnabled(false)`. */
  playAt(
    notes: number[],
    whenSec: number,
    durationSec: number,
    velocity = DEFAULT_VELOCITY,
    voice: Voice = DEFAULT_VOICE,
  ): void {
    const instrument = this.instruments[voice];
    if (!this.enabled || !instrument) return;
    for (const note of notes) {
      instrument.start({ note, time: whenSec, duration: durationSec, velocity });
    }
  }

  /** Silence anything currently sounding *and* drop anything already
   * scheduled. Both halves matter: `playAt` hands smplr note events up to a
   * bar ahead of the audible present, and smplr's `stop()` only releases
   * voices that have started — queued events would keep firing, so a stop
   * mid-bar would play the rest of that bar out. `scheduler.stop()` clears
   * that queue; it restarts itself on the next scheduled note, so this stays
   * non-destructive: `init()` need not be called again afterwards. */
  stopAll(): void {
    for (const voice of VOICES) {
      const instrument = this.instruments[voice];
      if (!instrument) continue;
      instrument.scheduler.stop();
      instrument.stop();
    }
  }

  /** Internal-piano bypass toggle for users routing MIDI out instead. Muting
   * silences output immediately without disposing the instrument or context;
   * re-enabling resumes normal playback with no re-init needed. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopAll();
  }

  setVolume(voice: Voice, level: number): void {
    this.levels[voice] = Math.max(0, Math.min(1, level));
    this.applyLevel(voice);
  }

  private applyLevel(voice: Voice): void {
    const instrument = this.instruments[voice];
    if (!instrument) return;
    instrument.output.volume = this.levels[voice] * MAX_CHANNEL_VOLUME;
  }
}
