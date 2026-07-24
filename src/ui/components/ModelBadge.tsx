// Subtle indicator of whether the current suggestion list is corpus-backed
// or theory-prior-only (SPEC.md: `model === null` — or a mode the corpus
// never populated — falls back to the prior transparently; the wiring
// requirement is that the UI still *show* which happened). Derived from
// `useModel`'s load status plus whether any currently-displayed Suggestion
// has `fromCorpus: true` — the same flag SPEC.md defines model/ as
// returning — rather than reaching into the model file's internals here.
import type { ModelLoadStatus } from '../hooks/useModel.ts';

export interface ModelBadgeProps {
  status: ModelLoadStatus;
  anyFromCorpus: boolean;
}

export function ModelBadge({ status, anyFromCorpus }: ModelBadgeProps) {
  if (status === 'loading') {
    return (
      <span className="tp-model-badge tp-model-badge--loading">
        <span className="tp-model-badge__dot" aria-hidden="true" />
        loading corpus model…
      </span>
    );
  }
  if (status === 'loaded' && anyFromCorpus) {
    return (
      <span className="tp-model-badge tp-model-badge--corpus">
        <span className="tp-model-badge__dot" aria-hidden="true" />
        corpus-backed suggestions
      </span>
    );
  }
  return (
    <span className="tp-model-badge tp-model-badge--prior">
      <span className="tp-model-badge__dot" aria-hidden="true" />
      prior-only suggestions
    </span>
  );
}
