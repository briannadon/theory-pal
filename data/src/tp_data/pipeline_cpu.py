"""Multi-core CPU entry point for theory-pal model training.

Uses ProcessPoolExecutor to distribute song parsing, key estimation, and
transition accumulation across all available CPU cores.

Usage:
    uv run python -m tp_data.pipeline_cpu --sample-size 10000 --num-workers 8 --max-order 3
    uv run python -m tp_data.pipeline_cpu --sample-size 0 --max-order 3
"""

from __future__ import annotations

import argparse
import json
import os
import resource
import time
from concurrent.futures import ProcessPoolExecutor
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


def _process_song(row_dict: dict, max_order: int) -> tuple[TransitionCounter, int, int, int, int]:
    counter = TransitionCounter(max_order=max_order)
    chords_cell = row_dict.get("chords")
    if not chords_cell:
        return counter, 0, 0, 0, 0

    sections = split_sections(chords_cell)
    parsed_sections = []
    chord_tokens_seen = 0
    chord_tokens_dropped = 0

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

    sections_processed = 0
    sections_skipped_short = 0
    for parsed in parsed_sections:
        if len(parsed) < MIN_SECTION_CHORDS:
            sections_skipped_short += 1
            continue
        hyps = estimate_key_hypotheses(parsed, song_first_pc, song_last_pc)
        counter.add_section(parsed, hyps)
        sections_processed += 1

    return counter, 1 if sections_processed > 0 else 0, sections_processed, chord_tokens_seen, chord_tokens_dropped


def _process_chunk(chunk: list[dict], max_order: int) -> tuple[TransitionCounter, int, int, int, int]:
    merged_counter = TransitionCounter(max_order=max_order)
    total_songs = 0
    total_sections = 0
    total_seen = 0
    total_dropped = 0
    for row in chunk:
        cnt, s_ok, sec_ok, seen, dropped = _process_song(row, max_order)
        merged_counter.merge(cnt)
        total_songs += s_ok
        total_sections += sec_ok
        total_seen += seen
        total_dropped += dropped
    return merged_counter, total_songs, total_sections, total_seen, total_dropped


def detect_cpu_count() -> int:
    """Detect available logical CPU cores, respecting Linux affinity masks if set."""
    try:
        if hasattr(os, "sched_getaffinity"):
            return len(os.sched_getaffinity(0))
    except Exception:
        pass
    return os.cpu_count() or 4


def process_cpu(
    sample_size: int,
    out_path: Path,
    num_workers: int | None = None,
    max_order: int = 3,
    chunk_size: int = 250,
    force_download: bool = False,
) -> dict:
    available_cores = detect_cpu_count()
    if num_workers is None or num_workers == 0:
        num_workers = available_cores
    elif num_workers < 0:
        num_workers = max(1, available_cores + num_workers)

    t0 = time.perf_counter()
    parquet_path = ensure_downloaded(force=force_download)
    total_rows = pq.ParquetFile(parquet_path).metadata.num_rows

    print(
        f"Starting CPU multi-core training with {num_workers} worker processes "
        f"(system detected: {available_cores} cores, max_order={max_order})..."
    )

    master_counter = TransitionCounter(max_order=max_order)
    seen_chord_hashes: set[int] = set()

    songs_seen = 0
    songs_processed = 0
    sections_processed = 0
    chord_tokens_seen = 0
    chord_tokens_dropped = 0
    duplicates_skipped = 0

    chunk_buffer: list[dict] = []
    chunk_list: list[list[dict]] = []

    t_download_done = time.perf_counter()

    for row in iter_rows(parquet_path, batch_size=2048):
        songs_seen += 1
        chords_cell = row.get("chords")
        if not chords_cell:
            continue

        h = hash(chords_cell)
        if h in seen_chord_hashes:
            duplicates_skipped += 1
            continue
        seen_chord_hashes.add(h)

        chunk_buffer.append(row)
        if len(chunk_buffer) >= chunk_size:
            chunk_list.append(chunk_buffer)
            chunk_buffer = []

        if sample_size and (len(chunk_list) * chunk_size + len(chunk_buffer)) >= sample_size:
            break

    if chunk_buffer:
        chunk_list.append(chunk_buffer)

    print(f"Submitting {len(chunk_list)} chunks to {num_workers} workers...")

    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        futures = [executor.submit(_process_chunk, c, max_order) for c in chunk_list]
        for idx, fut in enumerate(futures):
            sub_cnt, s_ok, sec_ok, seen, dropped = fut.result()
            master_counter.merge(sub_cnt)
            songs_processed += s_ok
            sections_processed += sec_ok
            chord_tokens_seen += seen
            chord_tokens_dropped += dropped

            if (idx + 1) % max(1, len(futures) // 10) == 0:
                elapsed = time.perf_counter() - t_download_done
                rate = songs_processed / elapsed if elapsed > 0 else 0
                print(f"  completed chunk {idx+1}/{len(futures)} ({songs_processed} songs, {rate:.1f} songs/sec)")

    t_end = time.perf_counter()
    peak_rss_kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss

    modes = master_counter.to_json_modes()
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
        "mode": "cpu_multiprocessing",
        "num_workers": num_workers,
        "max_order": max_order,
        "total_rows_in_corpus": total_rows,
        "songs_seen": songs_seen,
        "songs_processed": songs_processed,
        "duplicates_skipped": duplicates_skipped,
        "sections_processed": sections_processed,
        "chord_tokens_seen": chord_tokens_seen,
        "chord_tokens_dropped": chord_tokens_dropped,
        "elapsed_download_sec": t_download_done - t0,
        "elapsed_processing_sec": elapsed_processing,
        "elapsed_total_sec": elapsed_total,
        "songs_per_sec": songs_per_sec,
        "peak_rss_mb": peak_rss_kb / 1024,
        "out_path": str(out_path),
        "out_size_bytes": out_path.stat().st_size,
        "modes_populated": sorted(modes.keys()),
    }
    return stats


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
        "--num-workers",
        type=int,
        default=None,
        help="Number of CPU worker processes. Default (0 or omitted) = auto-detect all available cores. Negative numbers (e.g. -2) leave cores free for OS.",
    )
    parser.add_argument(
        "--max-order",
        type=int,
        default=3,
        help="Maximum Markov order (2 or 3). Default 3.",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Re-download the corpus parquet.",
    )
    args = parser.parse_args()

    stats = process_cpu(
        sample_size=args.sample_size,
        out_path=args.out,
        num_workers=args.num_workers,
        max_order=args.max_order,
        force_download=args.force_download,
    )
    print("\n--- CPU Pipeline Stats ---")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
