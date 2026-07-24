// Public API surface for src/audio/. Matches SPEC.md's `src/audio/` section.
export type { AudioEngine, AudioEngineOptions } from './engine.ts';
export { SmplrAudioEngine } from './engine.ts';

export type { Clock, Ticker, StepSchedulerOptions } from './scheduler.ts';
export { StepScheduler, realTimeTicker } from './scheduler.ts';

export type { PlayProgressionOptions, Playback } from './playback.ts';
export { playProgression } from './playback.ts';
