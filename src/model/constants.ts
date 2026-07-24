// Every tuning knob for the suggestion engine lives in this one file, per
// SPEC.md's requirement that the blend constants be "exported and tunable in
// one place." Each constant documents what it controls and which direction to
// move it for which effect, so future tuning doesn't require re-deriving the
// reasoning from scratch.
//
// None of these are fit to real corpus data (there is none yet — `data/` is a
// concurrent, separate effort). They're hand-picked to produce musically
// sensible prior-only rankings (checked by eye via the dev harness in
// `harness.test.ts`) and a reasonable-looking blend once real counts exist.

// ---------------------------------------------------------------------------
// Corpus/prior blend (SPEC.md: `score = corpusProb^a * priorProb^b`)
// ---------------------------------------------------------------------------

/** Exponent `a` on the (confidence-weighted) corpus probability. Raise to let
 * the corpus dominate the ranking faster as it gains confidence; lower to
 * keep the prior's influence even when the corpus is confident. */
export const BLEND_EXPONENT_CORPUS = 1.0;

/** Exponent `b` on the theory-prior probability. Raise to keep the prior
 * pulling toward "functionally sensible" chords even when the corpus
 * disagrees; lower to let corpus data override the prior more freely once
 * there's any signal at all. */
export const BLEND_EXPONENT_PRIOR = 0.6;

/**
 * Confidence in the corpus counts for a given (context) state, as a function
 * of the total observed transition count for that context:
 *   confidence = total / (total + CONFIDENCE_HALF_COUNT)
 * so confidence = 0.5 when total === CONFIDENCE_HALF_COUNT, tending to 0 for
 * sparse/unseen contexts (lean on the prior) and to 1 for well-attested ones
 * (lean on the corpus). Raise this to require more corpus evidence before
 * trusting it; lower it to trust thin corpus data sooner. Counts may be
 * fractional (soft key-assignment in `data/`), hence a smooth curve rather
 * than a hard count threshold.
 */
export const CONFIDENCE_HALF_COUNT = 8;

/** Minimum total (possibly fractional) order-2 context count before it's
 * used at all; below this, back off to order-1. Guards against a context
 * seen essentially once producing a spuriously confident (if low-confidence)
 * distribution over just one or two next states. */
export const MIN_ORDER2_TOTAL = 1.5;

/** As MIN_ORDER2_TOTAL, but for order-1; below this, corpus is ignored
 * entirely and the prior alone drives the ranking for this candidate. */
export const MIN_ORDER1_TOTAL = 1.0;

/**
 * Additive (Laplace-style) smoothing constant applied to raw corpus counts
 * before normalizing them into probabilities, spread over the number of
 * distinct next-states actually observed for the context in play. Counts
 * from `data/` are raw and possibly fractional, so this is `model/`'s own
 * smoothing layer per SPEC.md. Raise to flatten corpus distributions
 * (guards against overconfidence from a handful of observed songs); lower to
 * trust the observed counts more literally.
 */
export const CORPUS_SMOOTHING_ALPHA = 0.5;

/** Default number of suggestions returned by `suggest` when `limit` is
 * omitted. */
export const DEFAULT_SUGGEST_LIMIT = 8;

// ---------------------------------------------------------------------------
// Theory prior: functional-harmony scoring
// ---------------------------------------------------------------------------

/**
 * Tonic/subdominant/dominant function bucket by *scale-degree index*
 * (0-6, position within the 7-note scale — NOT semitone offset), applied
 * uniformly to any mode. This is the standard pop/classical grouping
 * (T: I iii vi, S: ii IV, D: V vii) generalized across modes by degree
 * position rather than by hardcoded major-key quality: whatever chord
 * quality a given mode builds on scale-degree 5 (index 4), it still carries
 * dominant function for scoring purposes. This is what lets the same
 * function-transition logic work for e.g. phrygian's minor v as it does for
 * ionian's major V.
 */
export const DEGREE_FUNCTION: readonly ('T' | 'S' | 'D')[] = ['T', 'S', 'T', 'S', 'D', 'T', 'D'];

/**
 * Fallback function bucket by chromatic semitone offset from the tonic
 * (0-11), used when a chord (typically the previous chord in context) is
 * itself non-diatonic and so has no scale-degree index to look up in
 * DEGREE_FUNCTION. Hand-picked from standard chromatic-harmony usage: e.g.
 * bVII (10) most often behaves as a dominant substitute ("backdoor"
 * progression bVII-I), bII (1) as a subdominant substitute (Neapolitan).
 */
export const CHROMATIC_DEGREE_FUNCTION: readonly ('T' | 'S' | 'D')[] = [
  'T', // 0  tonic
  'S', // 1  bII (Neapolitan) - predominant substitute
  'S', // 2  supertonic-ish
  'T', // 3  bIII - mediant substitute
  'T', // 4  III - mediant
  'S', // 5  subdominant
  'D', // 6  #IV/bV - tritone, dominant-substitute color
  'D', // 7  dominant
  'T', // 8  bVI - submediant substitute
  'T', // 9  submediant
  'D', // 10 bVII - subtonic, "backdoor" dominant substitute
  'D', // 11 leading tone
];

/**
 * Weight of a candidate's function given the previous chord's function:
 * FUNCTION_TRANSITION[prevFunction][candidateFunction]. Rows/cols are T/S/D.
 * Values follow standard root-progression pedagogy (e.g. Piston's normative
 * chord-to-chord table): D->T (cadential resolution) is strongest; S->D
 * (predominant to dominant) next; T->S and T->D are both "normative"
 * continuations from tonic and roughly comparable; lateral motion within a
 * function (T->T, S->S) and retrogressions (D->S, D->D) are weakest.
 * Raise any cell to make that function-pair more common in the prior.
 */
export const FUNCTION_TRANSITION: Readonly<Record<'T' | 'S' | 'D', Readonly<Record<'T' | 'S' | 'D', number>>>> = {
  T: { T: 0.5, S: 0.7, D: 0.8 },
  S: { T: 0.55, S: 0.3, D: 0.85 },
  D: { T: 1.0, S: 0.2, D: 0.25 },
};

/**
 * Root-motion strength, indexed by `mod12(candidateRoot - previousRoot)`.
 * Backbone is the standard root-progression strength ordering: descending
 * fifth (equivalently ascending fourth, index 5 — e.g. V-I, ii-V, I-IV) is
 * the strongest and most normative motion in tonal harmony; descending
 * thirds (index 8, 9 — e.g. I-vi, IV-ii) are next; ascending step (index 2)
 * third; the remaining motions (ascending third, ascending fifth,
 * descending step, tritone) are progressively weaker. Same-root motion
 * (index 0) is deliberately not the weakest: a root held while the quality
 * changes is exactly how mixture/applied chords work (I-i, I-I7-IV), so it's
 * scored as a moderately strong "column" alongside descending thirds.
 */
export const ROOT_MOTION_WEIGHT: readonly number[] = [
  0.55, // 0  same root (mixture/applied-chord quality change)
  0.35, // 1  up m2
  0.55, // 2  up M2 (ascending step)
  0.3, // 3  up m3 (ascending third)
  0.3, // 4  up M3 (ascending third)
  1.0, // 5  up P4 / down P5 (strongest: descending-fifth family)
  0.2, // 6  tritone (weakest)
  0.55, // 7  up P5 / down P4 (ascending-fifth: I-V is nearly as normative as its inverse)
  0.55, // 8  up m6 / down M3 (descending third)
  0.55, // 9  up M6 / down m3 (descending third)
  0.3, // 10 up m7 / down M2 (descending step)
  0.3, // 11 up M7 / down m2 (descending step)
];

/** Multiplier applied to a diatonic (or mixture) candidate whose root,
 * third, or fifth sits on the scale tone that makes this mode distinctive
 * (see `characteristicIndices` in prior.ts) — e.g. dorian's natural 6th
 * (which colors both ii and IV), mixolydian's b7 (which colors both V and
 * bVII). Raise to push mode-flavor chords higher in the ranking. */
export const CHARACTERISTIC_BONUS = 1.35;

/**
 * Category weights: how strongly each *kind* of non-native (or, for
 * NATIVE_DIATONIC, native) chord competes once function/root-motion scoring
 * is applied. These encode "how idiomatic is this device in general,"
 * independent of the specific chord — the individual chord's function/root
 * motion score still varies per candidate. All non-diatonic categories are
 * < 1 so that, all else equal, a native diatonic chord outranks a chromatic
 * one reached via the same function/root-motion path; that's what makes
 * chromatic chords "present but appropriately deprioritized" rather than
 * genuinely competitive with the diatonic set. Raise a factor to make that
 * device more common in the prior; SECONDARY_DOMINANT > BORROWED >
 * NEAPOLITAN > CHROMATIC_MEDIANT reflects roughly descending real-world
 * frequency of these devices in tonal pop/classical harmony.
 */
export const SECONDARY_DOMINANT_FACTOR = 0.6;
export const BORROWED_FACTOR = 0.55;
export const NEAPOLITAN_FACTOR = 0.45;
export const CHROMATIC_MEDIANT_FACTOR = 0.3;

/**
 * Semitone offsets from the tonic, relative to the CURRENT chord's root is
 * not used here (mediants are scored relative to the tonic, treating them as
 * tonic-substitute color chords) — offsets for a chromatic-mediant
 * relationship: major or minor third away from the tonic in either
 * direction (3 = up minor 3rd, 4 = up major 3rd, 8 = down major 3rd/up minor
 * 6th, 9 = down minor 3rd/up major 6th). Both maj and min triads are tried
 * at each offset; whichever coincide with already-diatonic or already-
 * borrowed chords are skipped (see prior.ts) so this only ever adds genuinely
 * new color chords.
 */
export const CHROMATIC_MEDIANT_OFFSETS: readonly number[] = [3, 4, 8, 9];

/**
 * Flat weight given to every (degree, quality) combination that isn't
 * reached by any of the structured categories above. Guarantees the prior
 * map is never missing an entry a corpus-observed state might need (see
 * suggest.ts's union of prior/corpus states), and guarantees exotic chromatic
 * chords (e.g. #IV major with no other structural role) are always
 * reachable, satisfying "never filter to diatonic" — just ranked low. Keep
 * this well below every category factor above so it never competes with a
 * musically-motivated candidate.
 */
export const GLOBAL_FLOOR_WEIGHT = 0.02;

// ---------------------------------------------------------------------------
// `surprise()`: plausible-but-uncommon sampling band
// ---------------------------------------------------------------------------

/** How many top-ranked suggestions `surprise` skips before its sampling band
 * starts. Raise to make surprises more obscure; this also guarantees the
 * top-ranked chord itself is never returned (band starts at index >= 1). */
export const SURPRISE_SKIP_TOP = 3;

/** Size of the ranked pool `surprise` draws its candidate list from before
 * slicing off the skipped top and sampling. Larger pools reach further into
 * the long tail of chromatic possibilities. */
export const SURPRISE_POOL_SIZE = 24;

/** Floor probability (within the normalized pool) below which a candidate is
 * excluded from `surprise` as "nonsense" — implausible enough that even a
 * deliberately uncommon suggestion shouldn't include it. Lower to allow more
 * obscure suggestions through. */
export const SURPRISE_MIN_PROBABILITY = 0.01;
