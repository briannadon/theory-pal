import { describe, expect, it } from 'vitest';
import { StepScheduler, type Clock, type Ticker } from './scheduler.ts';

/** A clock the test drives by hand instead of real wall time. */
function fakeClock(): Clock & { advance(sec: number): void; set(sec: number): void } {
  let t = 0;
  return {
    now: () => t,
    advance(sec: number) {
      t += sec;
    },
    set(sec: number) {
      t = sec;
    },
  };
}

/** A ticker that hands the test its `tick` callback instead of wiring up a
 * real timer, so the test decides exactly when each poll happens. */
function manualTicker(): Ticker & { tick(): void; startCount: number; stopped: boolean } {
  let fn: (() => void) | null = null;
  let stopped = false;
  let startCount = 0;
  return {
    start(tick) {
      fn = tick;
      startCount++;
      return 'handle';
    },
    stop() {
      stopped = true;
    },
    tick() {
      fn?.();
    },
    get startCount() {
      return startCount;
    },
    get stopped() {
      return stopped;
    },
  };
}

describe('StepScheduler', () => {
  it('fires steps in order at their scheduled times, within the lookahead window', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const events: Array<[number, number]> = [];
    const scheduler = new StepScheduler(clock, ticker, 4, 1, (i, t) => events.push([i, t]), {
      lookaheadSec: 0.1,
    });

    scheduler.start();
    // start() only registers with the ticker; nothing fires until the first
    // poll (mirroring a real setInterval, whose first tick lands ~tickMs
    // after start(), not synchronously).
    ticker.tick();
    // Step 0 (scheduled for time 0) is due immediately; nothing else is yet.
    expect(events).toEqual([[0, 0]]);

    // Not yet within the lookahead window of step 1 (time 1).
    clock.set(0.5);
    ticker.tick();
    expect(events).toEqual([[0, 0]]);

    // Now within 0.1s of step 1's target time.
    clock.set(0.95);
    ticker.tick();
    expect(events).toEqual([
      [0, 0],
      [1, 1],
    ]);

    clock.set(1.95);
    ticker.tick();
    clock.set(2.95);
    ticker.tick();
    expect(events).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(scheduler.running).toBe(true);

    // Sequence finishes playing (after step 3's 1-second duration at t = 4): scheduler stops itself.
    clock.set(4.0);
    ticker.tick();
    expect(scheduler.running).toBe(false);
    expect(ticker.stopped).toBe(true);
  });

  it('loops back to step 0 and keeps the timeline advancing', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const events: Array<[number, number]> = [];
    const scheduler = new StepScheduler(clock, ticker, 2, 1, (i, t) => events.push([i, t]), {
      lookaheadSec: 0.1,
      loop: true,
    });

    scheduler.start();
    for (const t of [0.95, 1.95, 2.95, 3.95]) {
      clock.set(t);
      ticker.tick();
    }

    expect(events).toEqual([
      [0, 0],
      [1, 1],
      [0, 2],
      [1, 3],
      [0, 4],
    ]);
    // Looping sequences never stop themselves.
    expect(scheduler.running).toBe(true);
    expect(ticker.stopped).toBe(false);
  });

  it('stop() cancels pending events — nothing fires after it', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const events: Array<[number, number]> = [];
    const scheduler = new StepScheduler(clock, ticker, 8, 1, (i, t) => events.push([i, t]), {
      lookaheadSec: 0.1,
      loop: true,
    });

    scheduler.start();
    clock.set(0.95);
    ticker.tick();
    expect(events).toEqual([
      [0, 0],
      [1, 1],
    ]);

    scheduler.stop();
    expect(scheduler.running).toBe(false);
    expect(ticker.stopped).toBe(true);

    // Advancing time and ticking again must not fire anything further — the
    // ticker is gone, but even a stray call to the captured tick fn (as if a
    // real timer fired one last time before clearInterval took effect) must
    // be a no-op once stopped.
    clock.set(10);
    ticker.tick();
    expect(events).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('a whole short non-looping sequence firing within one synchronous tick still stops cleanly', () => {
    // Regresses the start()/ticker.start() race: if the ticker invokes tick()
    // synchronously (as manualTicker's `start` does not, but a naive one
    // could) and that first tick already exhausts the sequence, start() must
    // not resurrect polling afterwards.
    const clock = fakeClock();
    let capturedTick: (() => void) | null = null;
    let stopCalls = 0;
    const syncTicker: Ticker = {
      start(tick) {
        capturedTick = tick;
        tick(); // fire immediately, synchronously, like some real schedulers do
        return 'h';
      },
      stop() {
        stopCalls++;
      },
    };
    const events: number[] = [];
    // lookaheadSec large enough that both steps are due immediately at t=0.
    const scheduler = new StepScheduler(clock, syncTicker, 2, 1, (i) => events.push(i), {
      lookaheadSec: 5,
    });

    scheduler.start();
    expect(events).toEqual([0, 1]);
    // Steps dispatched to lookahead buffer at t=0; scheduler stays active until t=2 when audio finishes playing
    expect(scheduler.running).toBe(true);

    clock.set(2);
    (capturedTick as null | (() => void))?.();
    expect(scheduler.running).toBe(false);
    expect(stopCalls).toBe(1); // the synchronous in-tick stop(), not a second one from start()
    expect(capturedTick).not.toBeNull();
  });

  it('does not start when the step count is zero', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const events: number[] = [];
    const scheduler = new StepScheduler(clock, ticker, 0, 1, (i) => events.push(i));
    scheduler.start();
    expect(scheduler.running).toBe(false);
    expect(ticker.startCount).toBe(0);
  });

  it('start() is idempotent while already running', () => {
    const clock = fakeClock();
    const ticker = manualTicker();
    const scheduler = new StepScheduler(clock, ticker, 4, 1, () => {});
    scheduler.start();
    scheduler.start();
    expect(ticker.startCount).toBe(1);
  });
});
