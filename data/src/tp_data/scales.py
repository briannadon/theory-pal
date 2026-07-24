"""Scale interval tables for the 9 modes the key-estimator scores candidates over.

Mirrors the `ScaleId` union in SPEC.md's `src/theory/`. The corpus pipeline only
needs the 7 diatonic modes plus harmonic and melodic (ascending/jazz) minor as
*tonic-estimation* candidates -- the further harmonic/melodic-minor modes SPEC
mentions are a `theory/` display concern (data-driven scale definitions for the UI),
not additional buckets this pipeline needs to separate a real-world pop/rock corpus
into. If validation ever shows songs that need e.g. lydian-dominant as a distinct
corpus bucket, add it here and it flows through untouched.
"""

from __future__ import annotations

from dataclasses import dataclass

# Scale degree semitone offsets above tonic, ascending, 7 entries, starting at 0.
SCALE_INTERVALS: dict[str, tuple[int, ...]] = {
    "ionian": (0, 2, 4, 5, 7, 9, 11),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
    "lydian": (0, 2, 4, 6, 7, 9, 11),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "aeolian": (0, 2, 3, 5, 7, 8, 10),
    "locrian": (0, 1, 3, 5, 6, 8, 10),
    "harmonicMinor": (0, 2, 3, 5, 7, 8, 11),
    "melodicMinor": (0, 2, 3, 5, 7, 9, 11),
}

MODES: tuple[str, ...] = tuple(SCALE_INTERVALS.keys())

# Bucket used for major/minor validation accuracy (McGill Billboard only records
# tonic pitch class, not mode, so we grade coarsely -- see data/README.md).
MAJOR_FAMILY = {"ionian", "lydian", "mixolydian"}
MINOR_FAMILY = {"dorian", "phrygian", "aeolian", "locrian", "harmonicMinor", "melodicMinor"}


def _triad_quality(root_iv: int, third_iv: int, fifth_iv: int) -> str:
    third = (third_iv - root_iv) % 12
    fifth = (fifth_iv - root_iv) % 12
    if (third, fifth) == (4, 7):
        return "maj"
    if (third, fifth) == (3, 7):
        return "min"
    if (third, fifth) == (3, 6):
        return "dim"
    if (third, fifth) == (4, 8):
        return "aug"
    # Shouldn't happen for the diatonic modes above, but stay defensive.
    return "maj"


@dataclass(frozen=True)
class ModeInfo:
    intervals: tuple[int, ...]
    degree_triad_quality: tuple[str, ...]  # quality of the diatonic triad on each of the 7 degrees


def _build_mode_info(intervals: tuple[int, ...]) -> ModeInfo:
    n = len(intervals)
    qualities = []
    for i in range(n):
        root = intervals[i]
        third = intervals[(i + 2) % n] + (12 if (i + 2) >= n else 0)
        fifth = intervals[(i + 4) % n] + (12 if (i + 4) >= n else 0)
        qualities.append(_triad_quality(root, third, fifth))
    return ModeInfo(intervals=intervals, degree_triad_quality=tuple(qualities))


MODE_INFO: dict[str, ModeInfo] = {mode: _build_mode_info(iv) for mode, iv in SCALE_INTERVALS.items()}
