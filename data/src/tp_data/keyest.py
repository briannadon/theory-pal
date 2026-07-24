"""Key/mode estimation per SPEC.md's numbered procedure.

1. Chord-content profile matching over the 12 pitch classes.
2. Tonic-disambiguation features layered on top as score bonuses/penalties.
3. Soft assignment: keep the top 2-3 (tonic, mode) hypotheses with posterior
   weights instead of committing to one label.
4. Called per section by the caller (pipeline.py) -- this module is agnostic to
   what a "section" is, it just scores one chord sequence at a time.

This is a heuristic, not a learned model: there is no labeled corpus of
"chord sequence -> correct key" large enough to fit weights against, so the scoring
constants below are hand-set from music-theory priors and tuned against the McGill
Billboard validation (see scripts/validate_billboard.py and data/README.md for the
resulting accuracy numbers). Treat the constants as a documented starting point,
not a claim of optimality.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from tp_data.chords import CHORD_TONE_INTERVALS, ParsedChord
from tp_data.scales import MODE_INFO, MODES

# --- scoring constants (single place to tune) --------------------------------

ROOT_WEIGHT = 3.0
OTHER_TONE_WEIGHT = 1.0
CHROMATIC_PENALTY = 1.0  # per unit of weight falling outside the candidate scale
PROFILE_SCORE_SCALE = 10.0  # rescales the normalized profile score to the same
# rough magnitude as _disambiguation_bonus, so section length doesn't drown out
# the tonic-disambiguation features

FIRST_CHORD_BONUS = 2.0
LAST_CHORD_BONUS = 2.0  # cadence helps, but a section's own last chord is often a
# bridge/solo/fadeout ending rather than a true resolution -- weighting it much
# higher than FIRST_CHORD_BONUS was tried and measurably hurt Billboard accuracy
# (see data/README.md), so the two are equal here.
ROOT_FREQUENCY_WEIGHT = 3.0  # scaled by this candidate's share of root occurrences,
# for *every* tonic candidate (not just the single most-frequent root) -- how often
# a pitch class is played as a root is a real tonic cue but not an overwhelming one:
# plenty of real songs vamp on V or IV more often than I, so this is deliberately
# modest rather than dominant (a much higher value was tried and also hurt accuracy).

# Song-level anchors: SPEC lists "first and last chord" as a tonic-disambiguation
# feature distinct from "section-final chords". Since estimation runs per section
# (SPEC step 4), the section's own edges are covered by FIRST/LAST_CHORD_BONUS
# above; these two constants let the caller (pipeline.py) additionally pass in the
# *whole song's* opening/closing chord root as a cross-section hint, since a bridge
# or solo section may not itself resolve to the tonic even when the song overall
# clearly does. Empirically (Billboard validation) the song's *opening* chord is a
# strong, reliable anchor; the song's *closing* chord is not (fadeouts and
# non-cadential outros are common), so only the "first" hint carries real weight.
SONG_FIRST_CHORD_BONUS = 2.0
SONG_LAST_CHORD_BONUS = 0.0

# Consistency bonus/penalty for observed chord quality vs. a mode's diatonic triad
# at scale degrees 1, 3, 4, 6 (0-indexed) -- this single mechanism implements every
# example SPEC lists: dorian's major IV vs aeolian's minor iv is degree 3; phrygian's
# major bII is degree 1; lydian's major "raised" II is also degree 1; a major V
# (vs. the natural-minor modes' minor v) is degree 4. Kept deliberately smaller than
# the root-frequency/cadence features: a chord "a 4th or 5th away from the tonic
# candidate" is consistent with several rotations of the same diatonic collection at
# once (that is exactly the ambiguity step 2 exists to resolve), so this term is a
# tie-breaker among otherwise-close candidates, not the primary signal.
CHARACTERISTIC_DEGREES = (1, 3, 4, 6)
CHARACTERISTIC_CONSISTENCY_WEIGHT = 0.5
CHARACTERISTIC_INCONSISTENCY_WEIGHT = 1.2

SOFT_ASSIGNMENT_TOP_K = 3
SOFT_ASSIGNMENT_TEMPERATURE = 2.0
SOFT_ASSIGNMENT_MIN_POSTERIOR = 0.03  # drop and renormalize hypotheses below this


@dataclass(frozen=True)
class KeyHypothesis:
    tonic_pc: int
    mode: str
    posterior: float


def _quality_bucket(quality: str) -> str:
    """Coarse maj/min/dim/aug bucket for comparing a real chord quality against a
    mode's diatonic triad quality (which is only ever maj/min/dim/aug)."""
    if quality in ("maj", "maj7", "dom7", "sus2", "sus4", "dom7sus4"):
        return "maj"
    if quality in ("min", "min7", "minMaj7"):
        return "min"
    if quality in ("dim", "dim7", "m7b5"):
        return "dim"
    if quality == "aug":
        return "aug"
    return "maj"


def _build_weight_vector(chords: list[ParsedChord]) -> list[float]:
    weights = [0.0] * 12
    for c in chords:
        intervals = CHORD_TONE_INTERVALS[c.quality]
        weights[c.pitch_class] += ROOT_WEIGHT
        for iv in intervals[1:]:
            weights[(c.pitch_class + iv) % 12] += OTHER_TONE_WEIGHT
    return weights


def _profile_score(weights: list[float], tonic_pc: int, mode: str) -> float:
    """Scale-fit score, normalized by total chord-tone weight so it stays on a scale
    comparable to `_disambiguation_bonus` regardless of section length -- otherwise
    the profile term (which grows with the number of chords) would swamp the
    tonic-disambiguation bonuses on longer sections and the relative-key tie SPEC
    describes would never get broken."""
    info = MODE_INFO[mode]
    scale_set = set(info.intervals)
    dominant_iv = info.intervals[4]
    subdominant_iv = info.intervals[3]
    in_w = 0.0
    out_w = 0.0
    total = sum(weights)
    if total <= 0:
        return 0.0
    for pc in range(12):
        w = weights[pc]
        if w == 0.0:
            continue
        rel = (pc - tonic_pc) % 12
        if rel in scale_set:
            if rel == 0:
                in_w += w * 3.0
            elif rel == dominant_iv:
                in_w += w * 2.0
            elif rel == subdominant_iv:
                in_w += w * 1.5
            else:
                in_w += w * 1.0
        else:
            out_w += w * CHROMATIC_PENALTY
    return (in_w - out_w) / total * PROFILE_SCORE_SCALE


def _disambiguation_bonus(
    chords: list[ParsedChord],
    tonic_pc: int,
    mode: str,
    song_first_pc: int | None = None,
    song_last_pc: int | None = None,
) -> float:
    if not chords:
        return 0.0
    info = MODE_INFO[mode]
    bonus = 0.0

    if chords[0].pitch_class == tonic_pc:
        bonus += FIRST_CHORD_BONUS
    if chords[-1].pitch_class == tonic_pc:
        bonus += LAST_CHORD_BONUS
    if song_first_pc is not None and song_first_pc == tonic_pc:
        bonus += SONG_FIRST_CHORD_BONUS
    if song_last_pc is not None and song_last_pc == tonic_pc:
        bonus += SONG_LAST_CHORD_BONUS

    freq: dict[int, int] = {}
    for c in chords:
        freq[c.pitch_class] = freq.get(c.pitch_class, 0) + 1
    bonus += ROOT_FREQUENCY_WEIGHT * (freq.get(tonic_pc, 0) / len(chords))

    for degree_idx in CHARACTERISTIC_DEGREES:
        iv = info.intervals[degree_idx]
        expected = info.degree_triad_quality[degree_idx]
        target_pc = (tonic_pc + iv) % 12
        count_matching_root = sum(1 for c in chords if c.pitch_class == target_pc)
        if count_matching_root == 0:
            continue
        consistent = sum(
            1
            for c in chords
            if c.pitch_class == target_pc and _quality_bucket(c.quality) == expected
        )
        inconsistent = count_matching_root - consistent
        bonus += CHARACTERISTIC_CONSISTENCY_WEIGHT * (consistent / len(chords))
        bonus -= CHARACTERISTIC_INCONSISTENCY_WEIGHT * (inconsistent / len(chords))

    return bonus


def estimate_key_hypotheses(
    chords: list[ParsedChord],
    song_first_pc: int | None = None,
    song_last_pc: int | None = None,
) -> list[KeyHypothesis]:
    """Score all 12 tonics x 9 modes for the given chord sequence (one section's
    worth), then soft-assign to the top few hypotheses with posterior weights that
    sum to 1.0. Returns an empty list if `chords` is empty.

    `song_first_pc`/`song_last_pc` are optional whole-song anchors (see
    SONG_FIRST/LAST_CHORD_BONUS above) -- pass the root of the first and last chord
    of the *entire song* (across all sections), distinct from this section's own
    first/last chord which is already scored unconditionally.
    """
    if not chords:
        return []

    weights = _build_weight_vector(chords)
    scores: list[tuple[int, str, float]] = []
    for tonic_pc in range(12):
        for mode in MODES:
            base = _profile_score(weights, tonic_pc, mode)
            bonus = _disambiguation_bonus(chords, tonic_pc, mode, song_first_pc, song_last_pc)
            scores.append((tonic_pc, mode, base + bonus))

    scores.sort(key=lambda x: x[2], reverse=True)
    top = scores[:SOFT_ASSIGNMENT_TOP_K]

    max_score = top[0][2]
    exps = [math.exp((s - max_score) / SOFT_ASSIGNMENT_TEMPERATURE) for _, _, s in top]
    total = sum(exps)
    posteriors = [e / total for e in exps]

    hyps = [
        KeyHypothesis(tonic_pc=t, mode=m, posterior=p)
        for (t, m, _), p in zip(top, posteriors)
        if p >= SOFT_ASSIGNMENT_MIN_POSTERIOR
    ]
    renorm = sum(h.posterior for h in hyps)
    if renorm <= 0:
        return []
    return [
        KeyHypothesis(tonic_pc=h.tonic_pc, mode=h.mode, posterior=h.posterior / renorm)
        for h in hyps
    ]
