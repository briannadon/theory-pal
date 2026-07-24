"""PyTorch GPU accelerated entry point for theory-pal model training.

Fully vectorizes section key-estimation and transition accumulation on CUDA/GPU.

Usage:
    uv run python -m tp_data.pipeline_gpu --sample-size 10000 --max-order 3
    uv run python -m tp_data.pipeline_gpu --sample-size 0 --max-order 3
"""

from __future__ import annotations

import argparse
import json
import resource
import time
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq
import torch

from tp_data.chords import CHORD_TONE_INTERVALS, QUALITIES, ParsedChord, parse_chordonomicon_token
from tp_data.hf_source import CACHE_PATH, ensure_downloaded, iter_rows
from tp_data.keyest import (
    CHARACTERISTIC_CONSISTENCY_WEIGHT,
    CHARACTERISTIC_DEGREES,
    CHARACTERISTIC_INCONSISTENCY_WEIGHT,
    CHROMATIC_PENALTY,
    FIRST_CHORD_BONUS,
    LAST_CHORD_BONUS,
    OTHER_TONE_WEIGHT,
    PROFILE_SCORE_SCALE,
    ROOT_FREQUENCY_WEIGHT,
    ROOT_WEIGHT,
    SOFT_ASSIGNMENT_MIN_POSTERIOR,
    SOFT_ASSIGNMENT_TEMPERATURE,
    SOFT_ASSIGNMENT_TOP_K,
    SONG_FIRST_CHORD_BONUS,
    SONG_LAST_CHORD_BONUS,
    _quality_bucket,
)
from tp_data.scales import MODE_INFO, MODES
from tp_data.sections import split_sections
from tp_data.transitions import TransitionCounter

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_OUT = REPO_ROOT / "public" / "model" / "transitions.json"

MIN_SECTION_CHORDS = 2

QUALITY_LIST = list(QUALITIES)
QUALITY_TO_IDX = {q: i for i, q in enumerate(QUALITY_LIST)}
BUCKET_MAP = {"maj": 0, "min": 1, "dim": 2, "aug": 3}
QUALITY_BUCKET_ID = [BUCKET_MAP[_quality_bucket(q)] for q in QUALITY_LIST]


class VectorGPUKeyEstimator:
    """Fully vectorized GPU key hypothesis estimator using PyTorch batch tensors."""

    def __init__(self, device: torch.device) -> None:
        self.device = device
        self.mode_to_idx = {mode: i for i, mode in enumerate(MODES)}
        self.idx_to_mode = {i: mode for i, mode in enumerate(MODES)}

        # 1. Mode profiles [9, 12]
        profiles = torch.full((len(MODES), 12), -CHROMATIC_PENALTY, dtype=torch.float32, device=device)
        for i, mode in enumerate(MODES):
            info = MODE_INFO[mode]
            scale_set = set(info.intervals)
            dom_iv = info.intervals[4]
            sub_iv = info.intervals[3]
            for pc in range(12):
                if pc in scale_set:
                    if pc == 0:
                        profiles[i, pc] = 3.0
                    elif pc == dom_iv:
                        profiles[i, pc] = 2.0
                    elif pc == sub_iv:
                        profiles[i, pc] = 1.5
                    else:
                        profiles[i, pc] = 1.0
        self.profiles = profiles  # [9, 12]

        # 2. Chord tone mask per quality [Q, 12]
        tone_masks = torch.zeros((len(QUALITY_LIST), 12), dtype=torch.float32, device=device)
        for q_idx, q in enumerate(QUALITY_LIST):
            ivs = CHORD_TONE_INTERVALS[q]
            tone_masks[q_idx, 0] = ROOT_WEIGHT
            for iv in ivs[1:]:
                tone_masks[q_idx, iv % 12] += OTHER_TONE_WEIGHT
        self.tone_masks = tone_masks  # [Q, 12]

        # 3. Precompute rotation index matrix [12, 12]
        # rot_idx[t, r] = (r + t) % 12
        r_grid = torch.arange(12, device=device).unsqueeze(0)
        t_grid = torch.arange(12, device=device).unsqueeze(1)
        self.rot_idx = (r_grid + t_grid) % 12  # [12, 12]

        # Quality bucket IDs [Q]
        self.quality_bucket_tensor = torch.tensor(QUALITY_BUCKET_ID, dtype=torch.long, device=device)

    @torch.no_grad()
    def estimate_batch_vectorized(
        self,
        batch_parsed: list[list[ParsedChord]],
        batch_song_first: list[int | None],
        batch_song_last: list[int | None],
    ) -> list[list[tuple[int, str, float]]]:
        B = len(batch_parsed)
        if B == 0:
            return []

        lengths = [len(c) for c in batch_parsed]
        max_L = max(lengths)

        # Build padded CPU tensors then move to GPU
        pcs = torch.full((B, max_L), -1, dtype=torch.long)
        quals = torch.full((B, max_L), -1, dtype=torch.long)
        mask = torch.zeros((B, max_L), dtype=torch.bool)

        for b, chords in enumerate(batch_parsed):
            for i, c in enumerate(chords):
                pcs[b, i] = c.pitch_class
                quals[b, i] = QUALITY_TO_IDX.get(c.quality, 0)
                mask[b, i] = True

        pcs_gpu = pcs.to(self.device)
        quals_gpu = quals.to(self.device)
        mask_gpu = mask.to(self.device)
        lengths_gpu = torch.tensor(lengths, dtype=torch.float32, device=self.device)

        # 1. Pitch-class weights [B, 12]
        # For chord (b, i) with pc P and qual Q: weight added to pitch class (P + rel) is tone_masks[Q, rel]
        # So weight added to pitch class target_pc is tone_masks[Q, (target_pc - P) % 12]
        target_grid = torch.arange(12, device=self.device).view(1, 1, 12)  # [1, 1, 12]
        rel_pcs = (target_grid - pcs_gpu.unsqueeze(2)) % 12  # [B, max_L, 12]

        # tone_masks[quals_gpu, rel_pcs] -> [B, max_L, 12]
        chord_weights = self.tone_masks[quals_gpu.unsqueeze(2), rel_pcs]  # [B, max_L, 12]
        chord_weights = chord_weights * mask_gpu.unsqueeze(2)  # Zero out padding

        W = chord_weights.sum(dim=1)  # [B, 12]
        total_W = W.sum(dim=1, keepdim=True)  # [B, 1]
        valid_b = (total_W > 0).squeeze(1)  # [B]

        # 2. Rotated weights [B, 12, 12]
        # W_rot[b, t, r] = W[b, (r + t) % 12]
        W_rot = W.gather(1, self.rot_idx.unsqueeze(0).expand(B, -1, -1).reshape(B, 144)).reshape(B, 12, 12)

        # Profile scores [B, 12, 9]
        # Epsilon prevents division by zero for invalid rows
        safe_total = torch.where(total_W > 0, total_W, torch.ones_like(total_W))
        profile_scores = torch.einsum("btr,mr->btm", W_rot, self.profiles) / safe_total.unsqueeze(2) * PROFILE_SCORE_SCALE

        # 3. Disambiguation bonuses [B, 12, 9]
        bonus = torch.zeros((B, 12, len(MODES)), dtype=torch.float32, device=self.device)

        c0_pcs = pcs_gpu[:, 0]  # [B]
        cL_pcs = pcs_gpu[torch.arange(B, device=self.device), lengths_gpu.long() - 1]  # [B]

        b_idx = torch.arange(B, device=self.device)
        bonus[b_idx, c0_pcs, :] += FIRST_CHORD_BONUS
        bonus[b_idx, cL_pcs, :] += LAST_CHORD_BONUS

        for b in range(B):
            sf = batch_song_first[b]
            sl = batch_song_last[b]
            if sf is not None:
                bonus[b, sf, :] += SONG_FIRST_CHORD_BONUS
            if sl is not None:
                bonus[b, sl, :] += SONG_LAST_CHORD_BONUS

        # Root frequency bonus [B, 12, 1]
        # root_counts[b, pc]
        root_counts = torch.zeros((B, 12), dtype=torch.float32, device=self.device)
        valid_pcs = torch.where(pcs_gpu >= 0, pcs_gpu, 0)
        root_counts.scatter_add_(1, valid_pcs, mask_gpu.float())
        root_freq = ROOT_FREQUENCY_WEIGHT * (root_counts / lengths_gpu.unsqueeze(1))  # [B, 12]
        bonus += root_freq.unsqueeze(2)

        # Characteristic degree consistency / inconsistency
        # For each mode m, degree_idx in (1,3,4,6)
        qual_buckets = self.quality_bucket_tensor[quals_gpu]  # [B, max_L]

        for m_idx, mode in enumerate(MODES):
            info = MODE_INFO[mode]
            for deg_idx in CHARACTERISTIC_DEGREES:
                iv = info.intervals[deg_idx]
                expected_q = BUCKET_MAP[info.degree_triad_quality[deg_idx]]

                for t_pc in range(12):
                    target_pc = (t_pc + iv) % 12
                    match_root = (pcs_gpu == target_pc) & mask_gpu  # [B, max_L]
                    count_match = match_root.sum(dim=1).float()  # [B]

                    consistent = (match_root & (qual_buckets == expected_q)).sum(dim=1).float()
                    inconsistent = count_match - consistent

                    term = CHARACTERISTIC_CONSISTENCY_WEIGHT * (consistent / lengths_gpu) - CHARACTERISTIC_INCONSISTENCY_WEIGHT * (inconsistent / lengths_gpu)
                    term = torch.where(count_match > 0, term, torch.zeros_like(term))
                    bonus[:, t_pc, m_idx] += term

        total_scores = (profile_scores + bonus).view(B, 108)  # [B, 108]

        # 4. Top-k Softmax
        top_val, top_idx = torch.topk(total_scores, SOFT_ASSIGNMENT_TOP_K, dim=1)  # [B, 3]

        max_v = top_val[:, :1]
        exps = torch.exp((top_val - max_v) / SOFT_ASSIGNMENT_TEMPERATURE)
        posteriors = exps / exps.sum(dim=1, keepdim=True)  # [B, 3]

        # Extract results back to Python structures
        results = []
        top_val_cpu = top_val.cpu()
        top_idx_cpu = top_idx.cpu()
        posteriors_cpu = posteriors.cpu()
        valid_b_cpu = valid_b.cpu()

        for b in range(B):
            if not valid_b_cpu[b]:
                results.append([])
                continue

            b_hyps = []
            renorm = 0.0
            for idx, p in zip(top_idx_cpu[b].tolist(), posteriors_cpu[b].tolist()):
                if p >= SOFT_ASSIGNMENT_MIN_POSTERIOR:
                    t_pc = idx // len(MODES)
                    m_idx = idx % len(MODES)
                    b_hyps.append((t_pc, self.idx_to_mode[m_idx], p))
                    renorm += p

            if renorm > 0:
                results.append([(t, m, p / renorm) for t, m, p in b_hyps])
            else:
                results.append([])

        return results


def process_gpu(
    sample_size: int,
    out_path: Path,
    max_order: int = 3,
    gpu_batch_size: int = 2048,
    force_download: bool = False,
) -> dict:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Starting GPU training on device: {device} (batch_size={gpu_batch_size}, max_order={max_order})...")

    estimator = VectorGPUKeyEstimator(device=device)
    master_counter = TransitionCounter(max_order=max_order)

    t0 = time.perf_counter()
    parquet_path = ensure_downloaded(force=force_download)
    total_rows = pq.ParquetFile(parquet_path).metadata.num_rows

    seen_chord_hashes: set[int] = set()

    songs_seen = 0
    songs_processed = 0
    sections_processed = 0
    chord_tokens_seen = 0
    chord_tokens_dropped = 0
    duplicates_skipped = 0

    batch_parsed_sections: list[list[ParsedChord]] = []
    batch_song_first: list[int | None] = []
    batch_song_last: list[int | None] = []

    t_download_done = time.perf_counter()

    def flush_gpu_batch():
        nonlocal songs_processed, sections_processed
        if not batch_parsed_sections:
            return

        hyps_batch = estimator.estimate_batch_vectorized(
            batch_parsed_sections, batch_song_first, batch_song_last
        )

        for parsed, hyps in zip(batch_parsed_sections, hyps_batch):
            if hyps and len(parsed) >= MIN_SECTION_CHORDS:
                from tp_data.keyest import KeyHypothesis
                k_hyps = [KeyHypothesis(tonic_pc=t, mode=m, posterior=p) for t, m, p in hyps]
                master_counter.add_section(parsed, k_hyps)
                sections_processed += 1

        songs_processed += len(batch_parsed_sections)
        batch_parsed_sections.clear()
        batch_song_first.clear()
        batch_song_last.clear()

        elapsed = time.perf_counter() - t_download_done
        rate = songs_processed / elapsed if elapsed > 0 else 0
        pct = (songs_seen / total_rows * 100) if total_rows > 0 else 0
        print(
            f"  processed {songs_processed} songs "
            f"({pct:.1f}% of corpus, {rate:.1f} songs/sec, {elapsed:.1f}s elapsed)"
        )

    for row in iter_rows(parquet_path, batch_size=4096):
        songs_seen += 1
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

        for parsed in parsed_sections:
            if len(parsed) >= MIN_SECTION_CHORDS:
                batch_parsed_sections.append(parsed)
                batch_song_first.append(song_first_pc)
                batch_song_last.append(song_last_pc)

                if len(batch_parsed_sections) >= gpu_batch_size:
                    flush_gpu_batch()

        if sample_size and songs_seen >= sample_size:
            break

    flush_gpu_batch()

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
        "mode": f"gpu_torch_vectorized_{device.type}",
        "device": str(device),
        "gpu_batch_size": gpu_batch_size,
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
        "--max-order",
        type=int,
        default=3,
        help="Maximum Markov order (2 or 3). Default 3.",
    )
    parser.add_argument(
        "--gpu-batch-size",
        type=int,
        default=2048,
        help="Batch size for GPU estimation. Default 2048.",
    )
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Re-download the corpus parquet.",
    )
    args = parser.parse_args()

    stats = process_gpu(
        sample_size=args.sample_size,
        out_path=args.out,
        max_order=args.max_order,
        gpu_batch_size=args.gpu_batch_size,
        force_download=args.force_download,
    )
    print("\n--- GPU Pipeline Stats ---")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
