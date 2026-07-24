"""Validate the key/mode estimator (tp_data.keyest) against the McGill Billboard
corpus (CC0, expert-annotated), per SPEC.md's mandate:

    "Validate against McGill Billboard (expert key annotations) before the full
    run. Report tonic accuracy and mode accuracy. Under ~75% tonic accuracy on
    major/minor means the estimator needs work before spending a full-corpus run."

McGill Billboard's `salami_chords.txt` files only annotate the tonic pitch class
(`# tonic: C`), not major/minor -- there is no mode field. We derive a ground-truth
major/minor bucket per song from the annotated chord chart itself: the majority
quality bucket (maj-ish vs. min-ish) among chords whose root is the annotated
tonic. That is not circular with our own estimator -- it reads a different, cheap
signal (bare majority vote on one pitch class) straight from the same expert
annotations, standing in for the mode label Billboard doesn't provide. Songs where
the tonic-rooted chord never appears, or ties exactly maj/min, are excluded from
the mode-accuracy denominator (but still count toward tonic accuracy).

Usage (from data/):
    uv run python scripts/validate_billboard.py --corpus-dir .cache/McGill-Billboard
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from tp_data.chords import parse_harte_chord  # noqa: E402
from tp_data.keyest import estimate_key_hypotheses  # noqa: E402
from tp_data.scales import MAJOR_FAMILY, MINOR_FAMILY  # noqa: E402

TONIC_LETTER_PC = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4,
    "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10,
    "Bb": 10, "B": 11, "Cb": 11,
}

_SECTION_START_RE = re.compile(r"^[A-Za-z][A-Za-z0-9']*,\s*[a-zA-Z0-9_' ]+,")
_TONIC_RE = re.compile(r"^#\s*tonic:\s*(\S+)")

MIN_SECTION_CHORDS = 2


def _quality_bucket(quality: str) -> str:
    if quality in ("maj", "maj7", "dom7", "sus2", "sus4", "dom7sus4", "aug"):
        return "maj"
    return "min"


def parse_salami_file(path: Path):
    tonic_pc = None
    sections: list[list] = []
    current: list = []

    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        m = _TONIC_RE.match(raw_line)
        if m:
            letter = m.group(1)
            tonic_pc = TONIC_LETTER_PC.get(letter)
            continue
        if not raw_line.strip() or raw_line.startswith("#"):
            continue

        parts = raw_line.split("\t", 1)
        if len(parts) < 2:
            continue
        rest = parts[1]

        if _SECTION_START_RE.match(rest):
            if current:
                sections.append(current)
                current = []
        elif not rest.startswith("|"):
            # "silence" / "end" marker lines carry no chords.
            continue

        for tok in rest.replace("|", " ").split():
            c = parse_harte_chord(tok)
            if c is not None:
                current.append(c)

    if current:
        sections.append(current)

    return tonic_pc, sections


def predict_song_key(sections: list[list]):
    """Run the estimator per section (mirrors the real pipeline), then combine by a
    chord-count-weighted vote over each section's top hypothesis to get one
    song-level (tonic, mode) prediction to compare against Billboard's one
    song-level ground truth."""
    all_chords = [c for section in sections for c in section]
    if not all_chords:
        return None
    song_first_pc = all_chords[0].pitch_class
    song_last_pc = all_chords[-1].pitch_class

    votes: Counter = Counter()
    for chords in sections:
        if len(chords) < MIN_SECTION_CHORDS:
            continue
        hyps = estimate_key_hypotheses(chords, song_first_pc, song_last_pc)
        if not hyps:
            continue
        top = max(hyps, key=lambda h: h.posterior)
        votes[(top.tonic_pc, top.mode)] += len(chords)
    if not votes:
        return None
    return max(votes, key=lambda k: votes[k])


def ground_truth_mode_bucket(tonic_pc: int, sections: list[list]) -> str | None:
    counts = Counter()
    for chords in sections:
        for c in chords:
            if c.pitch_class == tonic_pc:
                counts[_quality_bucket(c.quality)] += 1
    if not counts:
        return None
    (top_bucket, top_n), = counts.most_common(1)
    total = sum(counts.values())
    if counts[top_bucket] == total - counts[top_bucket]:
        return None  # exact tie, ambiguous
    return top_bucket


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-dir", type=Path, default=Path(".cache/McGill-Billboard"))
    args = parser.parse_args()

    song_dirs = sorted(p for p in args.corpus_dir.iterdir() if p.is_dir())
    print(f"Found {len(song_dirs)} song directories in {args.corpus_dir}")

    n_total = 0
    n_tonic_correct = 0
    n_mode_gradable = 0
    n_mode_correct = 0
    skipped_no_tonic = 0
    skipped_no_prediction = 0

    for song_dir in song_dirs:
        chords_file = song_dir / "salami_chords.txt"
        if not chords_file.exists():
            continue
        tonic_pc, sections = parse_salami_file(chords_file)
        if tonic_pc is None:
            skipped_no_tonic += 1
            continue

        prediction = predict_song_key(sections)
        if prediction is None:
            skipped_no_prediction += 1
            continue
        pred_tonic, pred_mode = prediction

        n_total += 1
        if pred_tonic == tonic_pc:
            n_tonic_correct += 1

        gt_bucket = ground_truth_mode_bucket(tonic_pc, sections)
        if gt_bucket is not None:
            pred_bucket = "maj" if pred_mode in MAJOR_FAMILY else "min"
            assert pred_mode in MAJOR_FAMILY or pred_mode in MINOR_FAMILY
            n_mode_gradable += 1
            if pred_bucket == gt_bucket:
                n_mode_correct += 1

    print(f"Skipped (no '# tonic:' header): {skipped_no_tonic}")
    print(f"Skipped (estimator produced no prediction): {skipped_no_prediction}")
    print(f"Songs scored: {n_total}")
    if n_total:
        print(f"Tonic accuracy: {n_tonic_correct}/{n_total} = {n_tonic_correct / n_total:.1%}")
    if n_mode_gradable:
        print(
            f"Mode (major/minor) accuracy: {n_mode_correct}/{n_mode_gradable} "
            f"= {n_mode_correct / n_mode_gradable:.1%}"
        )


if __name__ == "__main__":
    main()
