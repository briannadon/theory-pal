// Lookahead scheduler for playback timing (PLAN.md "Playback timing", SPEC.md
// `src/audio/`). Never times notes with `setTimeout` alone: a ~25ms timer tick
// looks a ~100ms window ahead of a monotonic clock (`AudioContext.currentTime`
// in production) and dispatches any step whose target time falls inside it.
//
// Kept free of AudioContext/DOM so it is unit-testable with a fake clock and a
// manually-driven tick source (see scheduler.test.ts) — the `Clock` and
// `Ticker` seams are the whole point. `src/audio/playback.ts` is the only
// production caller; it feeds this a real clock (`AudioContext.currentTime`)
// and drives both the audio engine and `MidiOut` from the same `onStep`
// callback, so audio and MIDI share one timeline instead of each keeping
// their own.

export interface Clock {
  /** Monotonic time in seconds. `AudioContext.currentTime` in production. */
  now(): number;
}

/** Drives the scheduler's polling loop. Swappable so tests can advance a fake
 * clock and fire ticks by hand instead of waiting on real timers. */
export interface Ticker {
  start(tick: () => void, intervalMs: number): unknown;
  stop(handle: unknown): void;
}

/** Production ticker: a plain `setInterval`. */
export const realTimeTicker: Ticker = {
  start(tick, intervalMs) {
    return setInterval(tick, intervalMs);
  },
  stop(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export interface StepSchedulerOptions {
  /** Timer poll interval, ms. Default 25 (PLAN.md / SPEC.md). */
  tickMs?: number;
  /** How far ahead of `clock.now()` events are dispatched, seconds. Default 0.1 (100ms). */
  lookaheadSec?: number;
  /** Repeat the step sequence indefinitely once the last step fires. Default false. */
  loop?: boolean;
}

const DEFAULT_TICK_MS = 25;
const DEFAULT_LOOKAHEAD_SEC = 0.1;

/**
 * Schedules a fixed-length sequence of `stepCount` steps, `stepDurationSec`
 * apart, against `clock`. `onStep(index, time)` fires once per step, in
 * order, as soon as its target time enters the lookahead window (so it may
 * fire slightly before `time`, never after). When `loop` is true the index
 * wraps back to 0 indefinitely and the absolute timeline keeps advancing;
 * otherwise the scheduler stops itself after the last step.
 *
 * Note that `onStep` firing "early" (within the lookahead window) is by
 * design: the callback's job is to *schedule* the step precisely for `time`
 * (e.g. Web Audio's own sample-accurate `AudioBufferSourceNode.start(time)`
 * or a Web MIDI timestamped `send`), not to make sound immediately.
 */
export class StepScheduler {
  private readonly clock: Clock;
  private readonly ticker: Ticker;
  private readonly stepCount: number;
  private readonly stepDurationSec: number;
  private readonly onStep: (index: number, time: number) => void;

  private handle: unknown = null;
  private active = false;
  private nextStepTime = 0;
  private stepIndex = 0;

  private readonly tickMs: number;
  private readonly lookaheadSec: number;
  private readonly loop: boolean;

  constructor(
    clock: Clock,
    ticker: Ticker,
    stepCount: number,
    stepDurationSec: number,
    onStep: (index: number, time: number) => void,
    options?: StepSchedulerOptions,
  ) {
    this.clock = clock;
    this.ticker = ticker;
    this.stepCount = stepCount;
    this.stepDurationSec = stepDurationSec;
    this.onStep = onStep;
    this.tickMs = options?.tickMs ?? DEFAULT_TICK_MS;
    this.lookaheadSec = options?.lookaheadSec ?? DEFAULT_LOOKAHEAD_SEC;
    this.loop = options?.loop ?? false;
  }

  /** True from `start()` until the sequence finishes (non-looping) or `stop()` is called. */
  get running(): boolean {
    return this.active;
  }

  /** Begin playback at `clock.now() + startDelaySec` (default: now). No-op if
   * already running or the sequence is empty. */
  start(startDelaySec = 0): void {
    if (this.active || this.stepCount <= 0) return;
    this.active = true;
    this.stepIndex = 0;
    this.nextStepTime = this.clock.now() + startDelaySec;

    // `ticker.start` may invoke `tick` synchronously (as the fake ticker used
    // in tests does, to make "one call = one tick" deterministic). If that
    // first tick already exhausts a short, non-looping sequence, `tick()`
    // will have called `stop()` — which flips `active` false — before this
    // line gets to assign `this.handle`. Only keep the handle (and thus the
    // polling loop) alive if we're still active once `ticker.start` returns.
    const handle = this.ticker.start(() => this.tick(), this.tickMs);
    if (this.active) {
      this.handle = handle;
    } else {
      this.ticker.stop(handle);
    }
  }

  /** Cancel all pending (not-yet-dispatched) steps and stop polling. Steps
   * already dispatched via `onStep` are unaffected — callers own cleanup of
   * whatever they scheduled in response (e.g. `AudioEngine.stopAll()`). */
  stop(): void {
    this.active = false;
    if (this.handle !== null) {
      this.ticker.stop(this.handle);
      this.handle = null;
    }
  }

  private tick(): void {
    if (!this.active) return;
    const horizon = this.clock.now() + this.lookaheadSec;
    while (this.active && this.stepIndex < this.stepCount && this.nextStepTime < horizon) {
      const index = this.stepIndex;
      const time = this.nextStepTime;
      this.onStep(index, time);
      this.stepIndex++;
      this.nextStepTime += this.stepDurationSec;
      if (this.stepIndex >= this.stepCount) {
        if (this.loop) {
          this.stepIndex = 0;
        } else {
          this.stop();
        }
      }
    }
  }
}
