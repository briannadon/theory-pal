// Lazily-constructed AudioEngine for this app instance, plus the soundfont
// load status the UI surfaces.
//
// Two-phase startup (see engine.ts): `preload()` fetches and decodes the
// samples and runs on mount, so the multi-second download overlaps with the
// user reading the page rather than stalling their first click.
// `ensureInit()` adds the AudioContext `resume()` that browsers only permit
// from a user gesture, and components still call it from click handlers;
// by then the samples are usually already in memory.
import { useEffect, useRef, useState } from 'react';
import { SmplrAudioEngine, type AudioEngine } from '../../audio/index.ts';

export type SoundLoadStatus = 'loading' | 'ready' | 'error';

export interface UseAudioEngineResult {
  engine: AudioEngine;
  ensureInit: () => Promise<void>;
  soundStatus: SoundLoadStatus;
}

export function useAudioEngine(): UseAudioEngineResult {
  const ref = useRef<AudioEngine | null>(null);
  if (!ref.current) ref.current = new SmplrAudioEngine();
  const engine = ref.current;

  const [soundStatus, setSoundStatus] = useState<SoundLoadStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    engine.preload().then(
      () => {
        if (!cancelled) setSoundStatus('ready');
      },
      () => {
        if (!cancelled) setSoundStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [engine]);

  return { engine, ensureInit: () => engine.init(), soundStatus };
}
