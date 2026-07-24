// Lazily-constructed AudioEngine for this app instance. The engine object
// itself is cheap to construct (no AudioContext yet), but `init()` — which
// creates the AudioContext and fetches the soundfont — must only ever run
// from a user-gesture handler (SPEC.md / PLAN.md M0), never on mount. So the
// engine is created eagerly here (module-lifetime, one per app instance) and
// `ensureInit()` is exposed for components to call from inside a click
// handler; `SmplrAudioEngine.init()` is itself idempotent, so calling it
// again on every subsequent gesture is a harmless no-op.
import { useRef } from 'react';
import { SmplrAudioEngine, type AudioEngine } from '../../audio/index.ts';

export interface UseAudioEngineResult {
  engine: AudioEngine;
  ensureInit: () => Promise<void>;
}

export function useAudioEngine(): UseAudioEngineResult {
  const ref = useRef<AudioEngine | null>(null);
  if (!ref.current) ref.current = new SmplrAudioEngine();
  const engine = ref.current;
  return { engine, ensureInit: () => engine.init() };
}
