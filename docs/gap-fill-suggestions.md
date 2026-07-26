# Gap-fill suggestions

Status: proposed, not built.

## The problem

`suggest` only ever answers one question: what follows the last chord you
played. `deriveContext` finds the last filled slot, walks back over the
contiguous run before it, and hands that to the model as history. Nothing in
the pipeline knows which slot you are trying to fill.

So when you clear a chord out of the middle of a progression and look at the
NEXT strip, you are reading suggestions for a slot past the end of the
progression, not for the hole. The hole is invisible to the engine. Filling it
well means conditioning on the chord that comes *after* it, and no part of
`model/` looks in that direction.

## The idea

For a first-order Markov chain, the middle state of `A ? B` has posterior

```
P(X | A, B) ∝ P(X | A) · P(B | X)
```

Both factors come out of the transition table we already ship. `P(X | A)` is
the forward lookup `suggest` already does. `P(B | X)` is the same table read
from the other side: the probability that a chord X is followed by B, which is
`order1[X][B]`. Nothing needs retraining and the model file format does not
change.

The normalizing term `P(B | A)` is constant across candidates, so ranking can
ignore it.

Two consequences shape the API. The first is that only the immediately
following chord matters. If the chords after the hole are B then C, the
backward factor is `P(B|X) · P(C|B)`, and `P(C|B)` has no X in it, so it
divides out of the ranking. At order 1 there is nothing to gain from looking
further ahead than one chord.

The second is that order 2 changes that a little. With forward context
`A_prev, A`, the backward factor is properly `P(B | A, X)`, which is
`order2["A>X"][B]`. That does depend on X, and we have the table for it. It
falls out of the implementation below rather than needing its own code path.

## Model layer

### `SuggestParams` gains one optional field

```ts
export interface SuggestParams {
  /** Chord history, oldest first, most recent last. May be empty. */
  context: RelChord[];
  /** The chord immediately after the slot being filled, when there is one.
   * Omitted for the common case of appending to the end of a progression,
   * where the ranking is forward-only and identical to before this existed. */
  following?: RelChord;
  key: Key;
  limit?: number;
}
```

`following` is a single chord, not an array, for the reason above. If the slot
after the hole is empty, pass nothing: a gap breaks the run in this direction
exactly as it already does in the other one, and for the same reason. Silence
reads as a phrase break, so a chord two slots away should not constrain what
goes in the hole.

### The scoring change

`rankAll` currently computes, per candidate:

```
score = effectiveCorpusP^BLEND_EXPONENT_CORPUS · priorP^BLEND_EXPONENT_PRIOR
```

Add one factor, and only when `following` is present:

```
score *= effectiveBackwardP^BLEND_EXPONENT_BACKWARD
```

The backward term is built the same way as the forward one, so both halves
respond to sparse data identically:

```ts
const hypothetical = [...context, candidateChord];
const back = corpusCountsForContext(modeModel, hypothetical);
```

`corpusCountsForContext` already walks the order 3 → 2 → 1 backoff ladder and
applies the `MIN_ORDER*_TOTAL` floors. Calling it with the context that *would*
exist if the candidate were placed gives the distribution over what comes next
after the candidate. Read `following`'s entry out of that distribution and you
have `P(following | ..., X)`, at whatever order the evidence supports. The
order-2 refinement described above is not a separate branch; it is what this
call returns whenever `context` is non-empty and the counts are there.

Smoothing, the confidence curve, and the prior blend all mirror the forward
path:

```ts
const backCorpusP  = smoothed(back, stateKey(following));   // same CORPUS_SMOOTHING_ALPHA
const backConf     = back ? back.total / (back.total + CONFIDENCE_HALF_COUNT) : 0;
const backPriorP   = normalized(theoryPrior(key, hypothetical)).get(stateKey(following)) ?? 0;
const effectiveBackwardP = backConf * backCorpusP + (1 - backConf) * backPriorP;
```

`theoryPrior` reads only the last chord of the context it is given, so passing
the hypothetical context asks it precisely the right question: given that X is
the current chord, how idiomatic is moving to `following`. When the corpus has
nothing, `backConf` is 0 and the backward term degrades to pure functional
harmony, the same way the forward term already does. `model === null` keeps
working with no special case.

### New constant

```ts
/** Exponent on the backward (what-follows-the-hole) probability. 1.0 is the
 * value the Bayes derivation implies: the forward and backward factors are
 * equally binding on the middle chord. Lower it to let the chord that already
 * follows the hole constrain the ranking less than the one before it. */
export const BLEND_EXPONENT_BACKWARD = 1.0;
```

### Cost

One `corpusCountsForContext` and one `theoryPrior` per candidate, against a
candidate universe of at most 12 roots × 13 qualities = 156. `theoryPrior` is
itself O(vocabulary), so the backward path is roughly 24k operations per call,
on a memoized `useMemo` that fires when the grid or key changes. Measure before
optimizing this.

### `fromCorpus` needs a documented answer

Today it means "corpus counts for the active context contributed a nonzero
observed count". With two directions in play it should become "either
direction contributed", and the doc comment on `Suggestion.fromCorpus` should
say so. The badge means "the corpus has seen this", and that stays true.

### `surprise` inherits this

It calls `suggest`, so a gap-aware `suggest` gives gap-aware surprises with no
change. Worth an explicit test that the parameter reaches it.

## UI layer

The model change is inert until something decides which slot you are filling.
That is the larger half of this work.

### Target slot selection

`TheoryPal` holds a `targetSlot: number | null`. Tapping an empty grid slot
selects it; tapping it again, or placing a chord, clears the selection. The
existing behavior is the case where nothing is selected, and it should be
expressed as exactly that rather than as a parallel path.

### Deriving both sides

A new function beside `deriveContext`, sharing its gap rule:

```ts
export function deriveSlotContext(
  slots: readonly (RelChord | null)[],
  target: number | null,
): { context: RelChord[]; following?: RelChord }
```

- `target === null` → today's `deriveContext(slots)`, no `following`.
- Otherwise `context` is the contiguous run of filled slots ending at
  `target - 1`, which is empty when the hole is at the start of the
  progression or preceded by another hole.
- `following` is `slots[target + 1]` when that slot is filled, and absent
  otherwise.

Keep `deriveContext` as it is and let `deriveSlotContext` call it, so the
existing tests keep covering the untargeted path unchanged.

### Making it visible

An empty slot needs to look selectable and look selected. The suggestion strip
should say what it is answering, because "what follows IVmaj7" and "what fits
between v7 and bVIImaj7" produce different lists and the user has no other way
to tell which one they are looking at. Something like `between v7 and bVIImaj7`
in the strip header, replacing `ranked by likelihood` while a target is
selected.

This also gives the mobile tap-to-place idea a home it did not have before.
Tapping a chord in the strip while a slot is selected has an unambiguous
meaning, which was the objection to adding it globally.

## Tests

The regression guarantee is the important one:

- `following` omitted produces output identical to the current engine, on the
  existing fixtures. This should be mechanical, not eyeballed.

Then the musical cases, all of which should hold on the prior alone so they do
not depend on corpus data existing:

- Hole between IV and I ranks V at or near the top. `IV V I` is the cadence the
  prior is built around, and forward-only ranking from IV does not favor V
  nearly as strongly.
- Hole between I and V ranks ii and IV above, say, vi. Both are normative
  predominants; vi is a weaker approach to V.
- Hole at the start of a progression, with `following` set and `context` empty:
  candidates that resolve well into `following` outrank ones that do not. This
  is the case that prompted the feature: clearing the first chord of a
  progression and wanting a replacement for it.
- A candidate that is strong forward but weak backward loses to one that is
  merely decent in both directions. This is the whole point of the change and
  deserves a test that would fail if the backward factor were dropped.
- `deriveSlotContext` respects the gap rule on both sides: a hole two slots
  before the next chord yields no `following`.

## What this does not do

It does not do voice leading, and it does not know or care whether the hole is
one bar or two. It ranks chords by transition plausibility, the same quantity
the engine already ranks by, now measured on both sides of the slot instead of
one.
