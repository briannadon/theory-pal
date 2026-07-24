// The one function in `model/` allowed to touch the network. Everything else
// in this module is pure and DOM-free (SPEC.md), so `fetch` stays isolated
// here where it's trivial to keep out of the rest of the test suite.
//
// SPEC.md types this `Promise<TransitionModel>`, but the task's explicit
// requirement is that a fetch failure resolve to `null` rather than throw,
// matching `suggest`/`surprise`'s `model: TransitionModel | null` parameter
// so the app degrades to prior-only suggestions the instant the network (or
// the model file, which a separate pipeline effort produces concurrently and
// may not exist yet) doesn't cooperate. `Promise<TransitionModel | null>`
// is the honest signature for that behavior.
import type { TransitionModel } from './types.ts';

const DEFAULT_URL = 'model/transitions.json';

function looksLikeTransitionModel(data: unknown): data is TransitionModel {
  return (
    typeof data === 'object' &&
    data !== null &&
    'modes' in data &&
    typeof (data as { modes: unknown }).modes === 'object' &&
    (data as { modes: unknown }).modes !== null
  );
}

export async function loadModel(url: string = DEFAULT_URL): Promise<TransitionModel | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!looksLikeTransitionModel(data)) return null;
    return data;
  } catch {
    return null;
  }
}
