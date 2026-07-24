import { describe, expect, it, vi } from 'vitest';
import { SmplrAudioEngine, VOICES } from './engine.ts';
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
  scheduler: { schedule: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  output: { volume: number };
  loader: { id: string };
}

function makeFakeInstrument(id = 'fake-loader'): FakeInstrument {
  const noopStop: StopFn = () => {};
  return {
    ready: Promise.resolve(),
    start: vi.fn(() => noopStop),
    stop: vi.fn(),
    scheduler: { schedule: vi.fn(() => noopStop), stop: vi.fn() },
    output: { volume: 100 },
    loader: { id },
  };
}

/** The engine builds one instrument per voice, in VOICES order (chords first,
 * then melody), so tests that care about a specific voice index into `made`.
 * `loaders` records what each call was handed, which is how sample sharing is
 * verified. */
function voiceFactory() {
  const made: FakeInstrument[] = [];
  const loaders: unknown[] = [];
  const factory = vi.fn((_ctx: AudioContext, loader?: unknown) => {
    const instrument = makeFakeInstrument(`loader-${made.length}`);
    made.push(instrument);
    loaders.push(loader);
    return instrument as unknown as Smplr;
  });
  return { factory, made, loaders };
}

function engineWith(ctx: FakeContext, factory: ReturnType<typeof voiceFactory>['factory']) {
  return new SmplrAudioEngine({
    contextFactory: () => ctx as unknown as AudioContext,
    instrumentFactory: factory as unknown as (c: AudioContext) => Smplr,
  });
}

describe('SmplrAudioEngine', () => {
  it('does not touch the context factory or instrument factory before init()', () => {
    const contextFactory = vi.fn(() => makeFakeContext() as unknown as AudioContext);
    const { factory } = voiceFactory();
    new SmplrAudioEngine({
      contextFactory,
      instrumentFactory: factory as unknown as (c: AudioContext) => Smplr,
    });
    expect(contextFactory).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it('init() builds one context and one instrument per voice, resuming a suspended context', async () => {
    const ctx = makeFakeContext();
    const contextFactory = vi.fn(() => ctx as unknown as AudioContext);
    const { factory } = voiceFactory();
    const engine = new SmplrAudioEngine({
      contextFactory,
      instrumentFactory: factory as unknown as (c: AudioContext) => Smplr,
    });

    await Promise.all([engine.init(), engine.init()]);

    expect(contextFactory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(VOICES.length);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('gives the extra voices the first voice’s loader, so samples download once', async () => {
    const { factory, made, loaders } = voiceFactory();
    await engineWith(makeFakeContext(), factory).preload();

    expect(loaders[0]).toBeUndefined(); // the first voice does the downloading
    for (let i = 1; i < VOICES.length; i++) {
      expect(loaders[i]).toBe(made[0].loader); // the rest reuse its cache
    }
  });

  it('preload() loads samples without resuming the context (no gesture required)', async () => {
    const ctx = makeFakeContext();
    const { factory } = voiceFactory();

    await engineWith(ctx, factory).preload();

    expect(factory).toHaveBeenCalledTimes(VOICES.length);
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(ctx.state).toBe('suspended');
  });

  it('init() after preload() resumes without re-fetching the samples', async () => {
    const ctx = makeFakeContext();
    const contextFactory = vi.fn(() => ctx as unknown as AudioContext);
    const { factory } = voiceFactory();
    const engine = new SmplrAudioEngine({
      contextFactory,
      instrumentFactory: factory as unknown as (c: AudioContext) => Smplr,
    });

    await engine.preload();
    await engine.init();
    await engine.init();

    expect(contextFactory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(VOICES.length);
    expect(ctx.resume).toHaveBeenCalledTimes(1); // only the first init(): already running after that
  });

  it('currentTime reflects the context, and is 0 before init()', async () => {
    const ctx = makeFakeContext();
    const engine = engineWith(ctx, voiceFactory().factory);
    expect(engine.currentTime).toBe(0);
    await engine.init();
    ctx.currentTime = 3.5;
    expect(engine.currentTime).toBe(3.5);
  });

  it('playChord/playAt no-op before init() resolves (no throw, no instrument call)', () => {
    const { factory, made } = voiceFactory();
    const engine = engineWith(makeFakeContext(), factory);
    expect(() => engine.playChord([60, 64, 67])).not.toThrow();
    expect(() => engine.playAt([60], 1, 1)).not.toThrow();
    expect(made).toHaveLength(0);
  });

  it('playAt schedules every note with the given time/duration/velocity', async () => {
    const { factory, made } = voiceFactory();
    const engine = engineWith(makeFakeContext(), factory);
    await engine.init();
    engine.playAt([60, 64, 67], 2.5, 0.8, 90);

    expect(made[0].start).toHaveBeenCalledTimes(3);
    for (const note of [60, 64, 67]) {
      expect(made[0].start).toHaveBeenCalledWith({ note, time: 2.5, duration: 0.8, velocity: 90 });
    }
  });

  it('routes each voice to its own instrument', async () => {
    const { factory, made } = voiceFactory();
    const engine = engineWith(makeFakeContext(), factory);
    await engine.init();

    engine.playAt([60], 0, 1, 100, 'chords');
    engine.playAt([72], 0, 1, 100, 'melody');

    expect(made[0].start).toHaveBeenCalledWith({ note: 60, time: 0, duration: 1, velocity: 100 });
    expect(made[0].start).toHaveBeenCalledTimes(1);
    expect(made[1].start).toHaveBeenCalledWith({ note: 72, time: 0, duration: 1, velocity: 100 });
    expect(made[1].start).toHaveBeenCalledTimes(1);
  });

  it('sets each voice’s level on its own output channel, before or after load', async () => {
    const { factory, made } = voiceFactory();
    const engine = engineWith(makeFakeContext(), factory);

    engine.setVolume('melody', 0.5); // set before the instruments exist
    await engine.init();
    expect(made[1].output.volume).toBe(63.5);
    expect(made[0].output.volume).toBe(127); // chords untouched, at full level

    engine.setVolume('chords', 0);
    expect(made[0].output.volume).toBe(0);
    expect(made[1].output.volume).toBe(63.5);
  });

  it('clamps levels to 0-1', async () => {
    const { factory, made } = voiceFactory();
    const engine = engineWith(makeFakeContext(), factory);
    await engine.init();

    engine.setVolume('chords', 4);
    expect(made[0].output.volume).toBe(127);
    engine.setVolume('chords', -1);
    expect(made[0].output.volume).toBe(0);
  });

  it('playChord defaults duration and velocity, and uses currentTime', async () => {
    const ctx = makeFakeContext();
    const { factory, made } = voiceFactory();
    const engine = engineWith(ctx, factory);
    await engine.init();
    ctx.currentTime = 7;
    engine.playChord([60]);
    expect(made[0].start).toHaveBeenCalledWith({ note: 60, time: 7, duration: 1.5, velocity: 100 });
  });

  it('setEnabled(false) silences every voice and blocks further notes, without disposing', async () => {
    const { factory, made } = voiceFactory();
    const engine = engineWith(makeFakeContext(), factory);
    await engine.init();

    engine.setEnabled(false);
    for (const instrument of made) expect(instrument.stop).toHaveBeenCalledTimes(1);

    engine.playChord([60]);
    expect(made[0].start).not.toHaveBeenCalled(); // no-op while disabled

    engine.setEnabled(true);
    engine.playChord([60]);
    expect(made[0].start).toHaveBeenCalledTimes(1); // resumes without re-init
  });

  it('stopAll() stops every voice without tearing down the engine', async () => {
    const { factory, made } = voiceFactory();
    const engine = engineWith(makeFakeContext(), factory);
    await engine.init();
    engine.stopAll();
    for (const instrument of made) expect(instrument.stop).toHaveBeenCalledTimes(1);

    engine.playChord([60]);
    expect(made[0].start).toHaveBeenCalledTimes(1); // still usable afterwards
  });

  it('stopAll() also drops notes scheduled for the future, not just sounding ones', async () => {
    const { factory, made } = voiceFactory();
    const engine = engineWith(makeFakeContext(), factory);
    await engine.init();

    engine.playAt([60], 4, 0.5); // queued well beyond smplr's own lookahead
    engine.stopAll();

    // `instrument.stop()` alone only releases started voices — without this,
    // a stop mid-bar lets the rest of the bar's scheduled notes still fire.
    for (const instrument of made) expect(instrument.scheduler.stop).toHaveBeenCalledTimes(1);
  });
});
