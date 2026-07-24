// SoundFont piano playback (SPEC.md `src/audio/`). Built on `smplr`'s
// `SplendidGrandPiano` — a sampled Steinway grand shipped by smplr itself and
// fetched lazily from smplr's own sample host at instrument-creation time, so
// there is nothing to vendor into `public/`: no asset load happens until
// `init()` runs, and no `AudioContext` is constructed at module import time
// (browsers refuse to start one before a user gesture anyway).
//
// `contextFactory` / `instrumentFactory` are injectable so this class is
// unit-testable without a real browser AudioContext (see engine.test.ts).
import { SplendidGrandPiano, type Smplr } from 'smplr';

export interface AudioEngine {
  init(): Promise<void>;
  playChord(notes: number[], durationSec?: number, velocity?: number): void;
  playAt(notes: number[], whenSec: number, durationSec: number, velocity?: number): void;
  stopAll(): void;
  setEnabled(on: boolean): void;
  readonly currentTime: number;
}

export interface AudioEngineOptions {
  /** Defaults to `() => new AudioContext()`. Override in tests. */
  contextFactory?: () => AudioContext;
  /** Defaults to smplr's `SplendidGrandPiano`. Override in tests, or to swap instruments. */
  instrumentFactory?: (ctx: AudioContext) => Smplr;
}

const DEFAULT_DURATION_SEC = 1.5;
const DEFAULT_VELOCITY = 100;

/** `AudioEngine` backed by smplr's sampled piano. Lazy: no `AudioContext` and
 * no sample fetch happens until `init()` is called. */
export class SmplrAudioEngine implements AudioEngine {
  private readonly contextFactory: () => AudioContext;
  private readonly instrumentFactory: (ctx: AudioContext) => Smplr;

  private context: AudioContext | null = null;
  private instrument: Smplr | null = null;
  private enabled = true;
  private initPromise: Promise<void> | null = null;

  constructor(options?: AudioEngineOptions) {
    this.contextFactory = options?.contextFactory ?? (() => new AudioContext());
    this.instrumentFactory = options?.instrumentFactory ?? ((ctx) => SplendidGrandPiano(ctx));
  }

  /** Idempotent: safe to call from multiple gesture handlers; every caller
   * awaits the same underlying load. Must be called from a user-gesture
   * handler — never on module import or page load. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const ctx = this.contextFactory();
        this.context = ctx;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const instrument = this.instrumentFactory(ctx);
        this.instrument = instrument;
        await instrument.ready;
      })();
    }
    return this.initPromise;
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /** Audition a chord starting now, for `durationSec` (default 1.5s). No-op
   * before `init()` resolves or while disabled. */
  playChord(notes: number[], durationSec = DEFAULT_DURATION_SEC, velocity = DEFAULT_VELOCITY): void {
    this.playAt(notes, this.currentTime, durationSec, velocity);
  }

  /** Schedule a chord sample-accurately against `whenSec` (an `AudioContext.currentTime`-
   * relative timestamp — the scheduler in `scheduler.ts` supplies these). No-op
   * before `init()` resolves or while disabled via `setEnabled(false)`. */
  playAt(notes: number[], whenSec: number, durationSec: number, velocity = DEFAULT_VELOCITY): void {
    if (!this.enabled || !this.instrument) return;
    for (const note of notes) {
      this.instrument.start({ note, time: whenSec, duration: durationSec, velocity });
    }
  }

  /** Silence anything currently sounding. Does not tear down the engine —
   * `init()` need not be called again afterwards. */
  stopAll(): void {
    this.instrument?.stop();
  }

  /** Internal-piano bypass toggle for users routing MIDI out instead. Muting
   * silences output immediately without disposing the instrument or context;
   * re-enabling resumes normal playback with no re-init needed. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.instrument?.stop();
  }
}
