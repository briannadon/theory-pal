import { describe, expect, it, vi } from 'vitest';
import { SmplrAudioEngine } from './engine.ts';
import type { Smplr, StopFn } from 'smplr';

interface FakeContext {
  currentTime: number;
  state: 'suspended' | 'running';
  resume: () => Promise<void>;
}

function makeFakeContext(): FakeContext {
  const ctx: FakeContext = {
    currentTime: 0,
    state: 'suspended',
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
  };
  return ctx;
}

interface FakeInstrument {
  ready: Promise<void>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function makeFakeInstrument(): FakeInstrument {
  const noopStop: StopFn = () => {};
  return {
    ready: Promise.resolve(),
    start: vi.fn(() => noopStop),
    stop: vi.fn(),
  };
}

describe('SmplrAudioEngine', () => {
  it('does not touch the context factory or instrument factory before init()', () => {
    const contextFactory = vi.fn(() => makeFakeContext() as unknown as AudioContext);
    const instrumentFactory = vi.fn(() => makeFakeInstrument() as unknown as Smplr);
    new SmplrAudioEngine({ contextFactory, instrumentFactory });
    expect(contextFactory).not.toHaveBeenCalled();
    expect(instrumentFactory).not.toHaveBeenCalled();
  });

  it('init() creates the context and instrument exactly once, resuming a suspended context', async () => {
    const ctx = makeFakeContext();
    const instrument = makeFakeInstrument();
    const contextFactory = vi.fn(() => ctx as unknown as AudioContext);
    const instrumentFactory = vi.fn(() => instrument as unknown as Smplr);
    const engine = new SmplrAudioEngine({ contextFactory, instrumentFactory });

    const p1 = engine.init();
    const p2 = engine.init();
    await Promise.all([p1, p2]);

    expect(contextFactory).toHaveBeenCalledTimes(1);
    expect(instrumentFactory).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('currentTime reflects the context, and is 0 before init()', async () => {
    const ctx = makeFakeContext();
    const engine = new SmplrAudioEngine({
      contextFactory: () => ctx as unknown as AudioContext,
      instrumentFactory: () => makeFakeInstrument() as unknown as Smplr,
    });
    expect(engine.currentTime).toBe(0);
    await engine.init();
    ctx.currentTime = 3.5;
    expect(engine.currentTime).toBe(3.5);
  });

  it('playChord/playAt no-op before init() resolves (no throw, no instrument call)', () => {
    const instrument = makeFakeInstrument();
    const engine = new SmplrAudioEngine({
      contextFactory: () => makeFakeContext() as unknown as AudioContext,
      instrumentFactory: () => instrument as unknown as Smplr,
    });
    expect(() => engine.playChord([60, 64, 67])).not.toThrow();
    expect(() => engine.playAt([60], 1, 1)).not.toThrow();
    expect(instrument.start).not.toHaveBeenCalled();
  });

  it('playAt schedules every note with the given time/duration/velocity', async () => {
    const instrument = makeFakeInstrument();
    const engine = new SmplrAudioEngine({
      contextFactory: () => makeFakeContext() as unknown as AudioContext,
      instrumentFactory: () => instrument as unknown as Smplr,
    });
    await engine.init();
    engine.playAt([60, 64, 67], 2.5, 0.8, 90);

    expect(instrument.start).toHaveBeenCalledTimes(3);
    expect(instrument.start).toHaveBeenCalledWith({ note: 60, time: 2.5, duration: 0.8, velocity: 90 });
    expect(instrument.start).toHaveBeenCalledWith({ note: 64, time: 2.5, duration: 0.8, velocity: 90 });
    expect(instrument.start).toHaveBeenCalledWith({ note: 67, time: 2.5, duration: 0.8, velocity: 90 });
  });

  it('playChord defaults duration and velocity, and uses currentTime', async () => {
    const ctx = makeFakeContext();
    const instrument = makeFakeInstrument();
    const engine = new SmplrAudioEngine({
      contextFactory: () => ctx as unknown as AudioContext,
      instrumentFactory: () => instrument as unknown as Smplr,
    });
    await engine.init();
    ctx.currentTime = 7;
    engine.playChord([60]);
    expect(instrument.start).toHaveBeenCalledWith({ note: 60, time: 7, duration: 1.5, velocity: 100 });
  });

  it('setEnabled(false) silences immediately and blocks further notes, without disposing', async () => {
    const instrument = makeFakeInstrument();
    const engine = new SmplrAudioEngine({
      contextFactory: () => makeFakeContext() as unknown as AudioContext,
      instrumentFactory: () => instrument as unknown as Smplr,
    });
    await engine.init();

    engine.setEnabled(false);
    expect(instrument.stop).toHaveBeenCalledTimes(1); // immediate silence on toggle

    engine.playChord([60]);
    expect(instrument.start).not.toHaveBeenCalled(); // no-op while disabled

    engine.setEnabled(true);
    engine.playChord([60]);
    expect(instrument.start).toHaveBeenCalledTimes(1); // resumes without re-init
  });

  it('stopAll() stops the instrument without tearing down the engine', async () => {
    const instrument = makeFakeInstrument();
    const engine = new SmplrAudioEngine({
      contextFactory: () => makeFakeContext() as unknown as AudioContext,
      instrumentFactory: () => instrument as unknown as Smplr,
    });
    await engine.init();
    engine.stopAll();
    expect(instrument.stop).toHaveBeenCalledTimes(1);

    engine.playChord([60]);
    expect(instrument.start).toHaveBeenCalledTimes(1); // still usable afterwards
  });
});
