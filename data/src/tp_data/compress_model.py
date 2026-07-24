"""Post-training compression script for theory-pal transitions model.

Applies multi-stage compression to trained transition models:
1. Frequency & backoff threshold pruning (drops zero-information/sparse counts).
2. Context cleaning (drops un-evidenced contexts below threshold).
3. Float quantization (rounds counts to reduce text representation size).

Usage:
    uv run python -m tp_data.compress_model
    uv run python -m tp_data.compress_model --in-path public/model/transitions.json --out-path public/model/transitions.json
"""

from __future__ import annotations

import argparse
import gzip
import json

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_MODEL = REPO_ROOT / "public" / "model" / "transitions.json"


def compress_model_data(
    model: dict,
    min_count_order3: float = 0.5,
    min_count_order2: float = 0.3,
    min_count_order1: float = 0.1,
    min_total_order3: float = 2.0,
    min_total_order2: float = 1.5,
    min_total_order1: float = 1.0,
    round_ndigits: int = 2,
) -> dict:
    """Applies pruning, context cleanup, and float quantization to raw model dict."""
    modes = model.get("modes", {})
    compressed_modes = {}

    def r(val: float) -> float:
        return round(val, round_ndigits)

    for mode_name, mode_data in modes.items():
        o1 = mode_data.get("order1", {})
        o2 = mode_data.get("order2", {})
        o3 = mode_data.get("order3", {})

        new_o1: dict[str, dict[str, float]] = {}
        new_tot1: dict[str, float] = {}

        new_o2: dict[str, dict[str, float]] = {}
        new_tot2: dict[str, float] = {}

        new_o3: dict[str, dict[str, float]] = {}
        new_tot3: dict[str, float] = {}

        # 1. Compress Order-1
        for prev, nexts in o1.items():
            filtered = {nxt: r(c) for nxt, c in nexts.items() if c >= min_count_order1}
            tot = sum(filtered.values())
            if tot >= min_total_order1 and filtered:
                new_o1[prev] = filtered
                new_tot1[prev] = r(tot)

        # 2. Compress Order-2
        for key, nexts in o2.items():
            filtered = {nxt: r(c) for nxt, c in nexts.items() if c >= min_count_order2}
            tot = sum(filtered.values())
            if tot >= min_total_order2 and filtered:
                new_o2[key] = filtered
                new_tot2[key] = r(tot)

        # 3. Compress Order-3
        for key, nexts in o3.items():
            filtered = {nxt: r(c) for nxt, c in nexts.items() if c >= min_count_order3}
            tot = sum(filtered.values())
            if tot >= min_total_order3 and filtered:
                new_o3[key] = filtered
                new_tot3[key] = r(tot)

        mode_out = {
            "order1": new_o1,
            "order2": new_o2,
            "totals1": new_tot1,
            "totals2": new_tot2,
        }
        if new_o3:
            mode_out["order3"] = new_o3
            mode_out["totals3"] = new_tot3

        compressed_modes[mode_name] = mode_out

    compressed_model = dict(model)
    compressed_model["modes"] = compressed_modes
    compressed_model["compressed"] = True
    return compressed_model


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--in-path",
        type=Path,
        default=DEFAULT_MODEL,
        help=f"Path to input model JSON. Default {DEFAULT_MODEL}",
    )
    parser.add_argument(
        "--out-path",
        type=Path,
        default=DEFAULT_MODEL,
        help=f"Path to write compressed JSON. Default {DEFAULT_MODEL}",
    )
    parser.add_argument("--min-count-order3", type=float, default=0.5)
    parser.add_argument("--min-count-order2", type=float, default=0.3)
    parser.add_argument("--min-count-order1", type=float, default=0.1)
    parser.add_argument("--round-digits", type=int, default=2)

    args = parser.parse_args()

    if not args.in_path.exists():
        print(f"Error: Input model file does not exist: {args.in_path}")
        return

    raw_bytes = args.in_path.read_bytes()
    orig_size = len(raw_bytes)
    orig_gzip = len(gzip.compress(raw_bytes))

    print(f"Loading raw model from {args.in_path} ({orig_size / (1024*1024):.2f} MB)...")
    model_data = json.loads(raw_bytes)

    compressed_data = compress_model_data(
        model_data,
        min_count_order3=args.min_count_order3,
        min_count_order2=args.min_count_order2,
        min_count_order1=args.min_count_order1,
        round_ndigits=args.round_digits,
    )

    out_bytes = json.dumps(compressed_data, separators=(",", ":")).encode("utf-8")
    new_size = len(out_bytes)
    new_gzip = len(gzip.compress(out_bytes))

    args.out_path.parent.mkdir(parents=True, exist_ok=True)
    args.out_path.write_bytes(out_bytes)

    reduction_pct = (1 - (new_size / orig_size)) * 100 if orig_size > 0 else 0
    gzip_reduction_pct = (1 - (new_gzip / orig_gzip)) * 100 if orig_gzip > 0 else 0

    print("\n=== Model Compression Results ===")
    print(f"Original Size:     {orig_size / (1024*1024):.2f} MB (Gzip: {orig_gzip / (1024*1024):.2f} MB)")
    print(f"Compressed Size:   {new_size / (1024*1024):.2f} MB (Gzip: {new_gzip / (1024*1024):.2f} MB)")
    print(f"Size Reduction:    {reduction_pct:.1f}% raw reduction ({gzip_reduction_pct:.1f}% gzipped reduction)")
    print(f"Saved to:          {args.out_path}")


if __name__ == "__main__":
    main()
