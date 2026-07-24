// Order-2 Markov with backoff, blended with the theory prior. See
// constants.ts for every tunable knob and SPEC.md for the contract this
// implements.
import { parseStateKey, isDiatonic, stateKey, type Key, type RelChord } from '../theory/index.ts';
import {
  BLEND_EXPONENT_CORPUS,
  BLEND_EXPONENT_PRIOR,
  CONFIDENCE_HALF_COUNT,
  CORPUS_SMOOTHING_ALPHA,
  DEFAULT_SUGGEST_LIMIT,
  MIN_ORDER1_TOTAL,
  MIN_ORDER2_TOTAL,
  SURPRISE_MIN_PROBABILITY,
  SURPRISE_POOL_SIZE,
  SURPRISE_SKIP_TOP,
} from './constants.ts';
import { theoryPrior } from './prior.ts';
import type { ModeModel, Suggestion, SuggestParams, TransitionModel } from './types.ts';

function getModeModel(model: TransitionModel | null, key: Key): ModeModel | undefined {
  return model?.modes[key.scale];
}

/** Raw counts + total for whichever order (2, backing off to 1) has enough
 * evidence for this context, per MIN_ORDER2_TOTAL/MIN_ORDER1_TOTAL. Returns
 * null if neither order has enough — the corpus contributes nothing and the
 * candidate ranking falls back entirely to the prior. */
function corpusCountsForContext(
  modeModel: ModeModel,
  context: RelChord[],
): { counts: Record<string, number>; total: number } | null {
  if (context.length >= 2) {
    const key2 = `${stateKey(context[context.length - 2])}>${stateKey(context[context.length - 1])}`;
    const total2 = modeModel.totals2[key2];
    if (total2 !== undefined && total2 >= MIN_ORDER2_TOTAL) {
      return { counts: modeModel.order2[key2] ?? {}, total: total2 };
    }
  }
  if (context.length >= 1) {
    const key1 = stateKey(context[context.length - 1]);
    const total1 = modeModel.totals1[key1];
    if (total1 !== undefined && total1 >= MIN_ORDER1_TOTAL) {
      return { counts: modeModel.order1[key1] ?? {}, total: total1 };
    }
  }
  return null;
}

interface RankedCandidate {
  chord: RelChord;
  rawScore: number;
  fromCorpus: boolean;
}

/** Full, unnormalized, unlimited ranking — the shared core both `suggest`
 * and `surprise` build on. Normalization and slicing to `limit` happen in
 * `suggest` (SPEC.md: probabilities are "normalized over the returned
 * list," i.e. after slicing, not before). */
function rankAll(model: TransitionModel | null, key: Key, context: RelChord[]): RankedCandidate[] {
  const priorRaw = theoryPrior(key, context);
  let priorTotal = 0;
  for (const w of priorRaw.values()) priorTotal += w;

  const modeModel = getModeModel(model, key);
  const corpus = modeModel ? corpusCountsForContext(modeModel, context) : null;

  // Corpus probabilities, smoothed over the distinct next-states actually
  // observed for this context (CORPUS_SMOOTHING_ALPHA — see constants.ts).
  const corpusProb = new Map<string, number>();
  let confidence = 0;
  if (corpus) {
    const entries = Object.entries(corpus.counts);
    const vocab = entries.length;
    const denom = corpus.total + CORPUS_SMOOTHING_ALPHA * vocab;
    for (const [k, count] of entries) {
      corpusProb.set(k, (count + CORPUS_SMOOTHING_ALPHA) / denom);
    }
    confidence = corpus.total / (corpus.total + CONFIDENCE_HALF_COUNT);
  }

  // Candidate universe: every state the prior knows about (which, thanks to
  // its global floor, is every state in the v1 vocabulary) union every state
  // the corpus observed for this context (belt-and-suspenders in case a
  // corpus state ever falls outside that floor).
  const allKeys = new Set<string>(priorRaw.keys());
  for (const k of corpusProb.keys()) allKeys.add(k);

  const ranked: RankedCandidate[] = [];
  for (const k of allKeys) {
    const priorP = (priorRaw.get(k) ?? 0) / priorTotal;
    const corpusP = corpusProb.get(k) ?? 0;
    // Corpus-confidence blend: shrinks toward the prior when confidence is
    // low (sparse/unseen context), converges to the raw corpus probability
    // as confidence grows. At confidence 0 this reduces exactly to priorP,
    // so the whole pipeline degrades correctly to prior-only ranking
    // whenever there's no usable corpus (including model === null).
    const effectiveCorpusP = confidence * corpusP + (1 - confidence) * priorP;
    const rawScore = effectiveCorpusP ** BLEND_EXPONENT_CORPUS * priorP ** BLEND_EXPONENT_PRIOR;
    ranked.push({
      chord: parseStateKey(k),
      rawScore,
      fromCorpus: (corpus?.counts[k] ?? 0) > 0,
    });
  }

  ranked.sort((a, b) => b.rawScore - a.rawScore || stateKey(a.chord).localeCompare(stateKey(b.chord)));
  return ranked;
}

export function suggest(model: TransitionModel | null, p: SuggestParams): Suggestion[] {
  const ranked = rankAll(model, p.key, p.context);
  const limit = p.limit ?? DEFAULT_SUGGEST_LIMIT;
  const top = ranked.slice(0, Math.max(0, limit));
  const sum = top.reduce((s, c) => s + c.rawScore, 0);
  return top.map((c) => ({
    chord: c.chord,
    probability: sum > 0 ? c.rawScore / sum : 0,
    diatonic: isDiatonic(c.chord, p.key),
    fromCorpus: c.fromCorpus,
  }));
}

export function surprise(
  model: TransitionModel | null,
  p: SuggestParams,
  rng: () => number = Math.random,
): Suggestion | null {
  const list = suggest(model, { ...p, limit: SURPRISE_POOL_SIZE });
  if (list.length < 2) return null; // nothing beyond the top rank to surprise with

  const bandStart = Math.min(SURPRISE_SKIP_TOP, list.length - 1);
  let band = list.slice(bandStart).filter((s) => s.probability >= SURPRISE_MIN_PROBABILITY);
  if (band.length === 0) band = list.slice(bandStart); // floor too strict for this list: use what's left anyway
  if (band.length === 0) return null;

  const total = band.reduce((s, x) => s + x.probability, 0);
  let r = rng() * total;
  for (const s of band) {
    r -= s.probability;
    if (r <= 0) return s;
  }
  return band[band.length - 1];
}
