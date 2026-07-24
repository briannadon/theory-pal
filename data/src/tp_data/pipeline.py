"""CLI entry point: Chordonomicon -> public/model/transitions.json.

Usage (from data/):

    uv run python -m tp_data.pipeline --sample-size 10000
    uv run python -m tp_data.pipeline --sample-size 0   # 0 = no limit, full corpus

See data/README.md for flags, timing/memory numbers from the sample run, and the
full-corpus extrapolation.
"""

from __future__ import annotations

import argparse
import json
import resource
import time
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq

from tp_data.chords import parse_chordonomicon_token
from tp_data.hf_source import CACHE_PATH, ensure_downloaded, iter_rows
from tp_data.keyest import estimate_key_hypotheses
from tp_data.sections import split_sections
from tp_data.transitions import TransitionCounter

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_OUT = REPO_ROOT / "public" / "model" / "transitions.json"

MIN_SECTION_CHORDS = 2
MIN_SONG_CHORDS = 2


def process(
    sample_size: int,
    out_path: Path,
    force_download: bool = False,
    batch_size: int = 2048,
    progress_every: int = 2000,
) -> dict:
    t0 = time.perf_counter()
    parquet_path = ensure_downloaded(force=force_download)
    total_rows = pq.ParquetFile(parquet_path).metadata.num_rows

    counter = TransitionCounter()
    seen_chord_hashes: set[int] = set()

    songs_processed = 0
    songs_seen = 0
    sections_processed = 0
    sections_skipped_short = 0
    chord_tokens_seen = 0
    chord_tokens_dropped = 0
    duplicates_skipped = 0

    t_download_done = time.perf_counter()

    for row in iter_rows(parquet_path, batch_size=batch_size):
        songs_seen += 1
        if sample_size and songs_processed >= sample_size:
            break

        chords_cell = row.get("chords")
        if not chords_cell:
            continue

        h = hash(chords_cell)
        if h in seen_chord_hashes:
            duplicates_skipped += 1
            continue
        seen_chord_hashes.add(h)

        sections = split_sections(chords_cell)

        parsed_sections = []
        for section in sections:
            parsed = []
            for tok in section.tokens:
                chord_tokens_seen += 1
                pc = parse_chordonomicon_token(tok)
                if pc is None:
                    chord_tokens_dropped += 1
                    continue
                parsed.append(pc)
            parsed_sections.append(parsed)

        all_chords = [c for parsed in parsed_sections for c in parsed]
        song_first_pc = all_chords[0].pitch_class if all_chords else None
        song_last_pc = all_chords[-1].pitch_class if all_chords else None

        song_had_content = False
        for parsed in parsed_sections:
            if len(parsed) < MIN_SECTION_CHORDS:
                sections_skipped_short += 1
                continue
            hyps = estimate_key_hypotheses(parsed, song_first_pc, song_last_pc)
            counter.add_section(parsed, hyps)
            sections_processed += 1
            song_had_content = True

        if song_had_content:
            songs_processed += 1

        if songs_processed % progress_every == 0 and songs_processed > 0:
            elapsed = time.perf_counter() - t0
            rate = songs_processed / elapsed
            print(
                f"  processed {songs_processed} songs "
                f"({rate:.1f} songs/sec, {elapsed:.1f}s elapsed)"
            )

    t_end = time.perf_counter()
    peak_rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss  # KB on Linux

    modes = counter.to_json_modes()
    model = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Chordonomicon v2 (CC-BY-NC-4.0)",
        "songCount": songs_processed,
        "modes": modes,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(model, f, separators=(",", ":"))

    elapsed_processing = t_end - t_download_done
    elapsed_total = t_end - t0
    songs_per_sec = songs_processed / elapsed_processing if elapsed_processing > 0 else 0.0

    stats = {
        "total_rows_in_corpus": total_rows,
        "songs_seen": songs_seen,
        "songs_processed": songs_processed,
        "duplicates_skipped": duplicates_skipped,
        "sections_processed": sections_processed,
        "sections_skipped_short": sections_skipped_short,
        "chord_tokens_seen": chord_tokens_seen,
        "chord_tokens_dropped": chord_tokens_dropped,
        "drop_rate": chord_tokens_dropped / chord_tokens_seen if chord_tokens_seen else 0.0,
        "elapsed_download_sec": t_download_done - t0,
        "elapsed_processing_sec": elapsed_processing,
        "elapsed_total_sec": elapsed_total,
        "songs_per_sec": songs_per_sec,
        "peak_rss_mb": peak_rss_kb / 1024,
        "out_path": str(out_path),
        "out_size_bytes": out_path.stat().st_size,
        "modes_populated": sorted(modes.keys()),
    }

    if songs_per_sec > 0:
        est_full_sec = total_rows / songs_per_sec
        stats["full_corpus_estimate_sec"] = est_full_sec
        stats["full_corpus_estimate_human"] = _human_duration(est_full_sec)

    return stats


def _human_duration(seconds: float) -> str:
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    if h >= 1:
        return f"{int(h)}h {int(m)}m"
    if m >= 1:
        return f"{int(m)}m {int(s)}s"
    return f"{s:.1f}s"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sample-size",
        type=int,
        default=10000,
        help="Number of songs to process. 0 = no limit (full corpus). Default 10000.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output path for transitions.json. Default {DEFAULT_OUT}",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Re-download the corpus parquet even if a local cache exists.",
    )
    parser.add_argument("--batch-size", type=int, default=2048)
    args = parser.parse_args()

    print(f"Cache: {CACHE_PATH}")
    stats = process(
        sample_size=args.sample_size,
        out_path=args.out,
        force_download=args.force_download,
        batch_size=args.batch_size,
    )
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
