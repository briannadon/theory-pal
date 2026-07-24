// Loads the trained transition model in the background. `loadModel` never
// throws — it resolves `null` on any fetch/parse failure (SPEC.md) — so the
// only states are "still loading" and "settled" (with or without a model).
// The rest of the UI must work identically in every state, falling back to
// `model/`'s own theory-prior path whenever `model` is `null`.
import { useEffect, useState } from 'react';
import { loadModel, type TransitionModel } from '../../model/index.ts';

export type ModelLoadStatus = 'loading' | 'loaded' | 'unavailable';

export interface UseModelResult {
  model: TransitionModel | null;
  status: ModelLoadStatus;
}

export function useModel(url?: string): UseModelResult {
  const [model, setModel] = useState<TransitionModel | null>(null);
  const [status, setStatus] = useState<ModelLoadStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setModel(null);
    void loadModel(url).then((m) => {
      if (cancelled) return;
      setModel(m);
      setStatus(m ? 'loaded' : 'unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { model, status };
}
