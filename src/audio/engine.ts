// SoundFont piano playback (SPEC.md `src/audio/`). Built on `smplr`'s
// `SplendidGrandPiano` — a sampled Steinway grand shipped by smplr itself and
// fetched from smplr's own sample host at instrument-creation time, so there
// is nothing to vendor into `public/`. Nothing happens at module import time;
// loading starts when the app calls `preload()` (samples only — no user
// gesture needed) or `init()` (samples plus the gesture-gated context
// resume browsers require before audio can actually sound).
//
// `contextFactory` / `instrumentFactory` are injectable so this class is
// unit-testable without a real browser AudioContext (see engine.test.ts).
import { SplendidGrandPiano, type Smplr } from 'smplr';

export interface AudioEngine {
  preload(): Promise<void>;
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
  private loadPromise: Promise<void> | null = null;

  constructor(options?: AudioEngineOptions) {
    this.contextFactory = options?.contextFactory ?? (() => new AudioContext());
    this.instrumentFactory = options?.instrumentFactory ?? ((ctx) => SplendidGrandPiano(ctx));
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
        const instrument = this.instrumentFactory(ctx);
        this.instrument = instrument;
        await instrument.ready;
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

  /** Silence anything currently sounding *and* drop anything already
   * scheduled. Both halves matter: `playAt` hands smplr note events up to a
   * bar ahead of the audible present, and smplr's `stop()` only releases
   * voices that have started — queued events would keep firing, so a stop
   * mid-bar would play the rest of that bar out. `scheduler.stop()` clears
   * that queue; it restarts itself on the next scheduled note, so this stays
   * non-destructive: `init()` need not be called again afterwards. */
  stopAll(): void {
    if (!this.instrument) return;
    this.instrument.scheduler.stop();
    this.instrument.stop();
  }

  /** Internal-piano bypass toggle for users routing MIDI out instead. Muting
   * silences output immediately without disposing the instrument or context;
   * re-enabling resumes normal playback with no re-init needed. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopAll();
  }
}
