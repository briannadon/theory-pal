"""Fetch the Chordonomicon corpus from Hugging Face.

The dataset repo (`ailsntua/Chordonomicon`) ships a single 264MB CSV, but HF's
dataset-server auto-converts every public dataset to Parquet, and the Parquet copy
is only ~92MB (columnar + compressed) and supports HTTP range requests. We download
that Parquet file once to a local cache (gitignored, never shipped) and then stream
row batches out of it via pyarrow, so a sample run never has to materialize the full
~680k-row table in memory.
"""

from __future__ import annotations

import pathlib

import pyarrow.parquet as pq
import requests

PARQUET_URL = (
    "https://huggingface.co/api/datasets/ailsntua/Chordonomicon/parquet/default/train/0.parquet"
)

CACHE_DIR = pathlib.Path(__file__).resolve().parent.parent.parent / ".cache"
CACHE_PATH = CACHE_DIR / "chordonomicon_v2.parquet"


def ensure_downloaded(force: bool = False) -> pathlib.Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if CACHE_PATH.exists() and not force:
        return CACHE_PATH
    tmp_path = CACHE_PATH.with_suffix(".part")
    with requests.get(PARQUET_URL, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        downloaded = 0
        with open(tmp_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                downloaded += len(chunk)
        print(f"Downloaded {downloaded / 1e6:.1f} MB (expected {total / 1e6:.1f} MB)")
    tmp_path.rename(CACHE_PATH)
    return CACHE_PATH


def iter_rows(path: pathlib.Path, batch_size: int = 2048):
    """Yield row dicts one at a time, streaming Arrow record batches so memory stays
    bounded regardless of corpus size."""
    pf = pq.ParquetFile(path)
    for batch in pf.iter_batches(batch_size=batch_size):
        cols = batch.to_pydict()
        n = len(cols["id"])
        for i in range(n):
            yield {k: cols[k][i] for k in cols}
