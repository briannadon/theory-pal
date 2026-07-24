"""End-to-end pipeline test on synthetic data -- no network access. Monkeypatches
the HF download/iterate functions the pipeline uses so the full download -> parse
-> key-estimate -> count -> emit path runs and produces a valid transitions.json
shape, per PLAN.md's "validate on a handful of songs end-to-end" convention.
"""

import json

import tp_data.pipeline as pipeline


SYNTHETIC_ROWS = [
    {
        "id": 1,
        "chords": (
            "<verse_1> C F G C F G Amin F G C "
            "<chorus_1> C F G C F G Amin F G C"
        ),
    },
    {
        "id": 2,
        "chords": (
            "<verse_1> Amin F C G Amin F C G Amin "
            "<chorus_1> Amin F C G Amin F C G Amin"
        ),
    },
    {
        "id": 3,
        "chords": "<intro_1> Dmin G Dmin G C Dmin <verse_1> Dmin G Dmin G C Dmin",
    },
    {"id": 4, "chords": "<intro_1> Xyzzy Nonsense123"},  # should be dropped entirely
    {"id": 5, "chords": ""},  # empty, skipped
    {"id": 1, "chords": "<verse_1> C F G C F G Amin F G C <chorus_1> C F G C F G Amin F G C"},  # dup of #1
]


def fake_ensure_downloaded(force=False):
    return "FAKE_PATH"


def fake_iter_rows(path, batch_size=2048):
    yield from SYNTHETIC_ROWS


def test_pipeline_end_to_end_synthetic(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "ensure_downloaded", fake_ensure_downloaded)
    monkeypatch.setattr(pipeline, "iter_rows", fake_iter_rows)
    monkeypatch.setattr(
        pipeline.pq,
        "ParquetFile",
        lambda p: type("FakeMeta", (), {"metadata": type("M", (), {"num_rows": len(SYNTHETIC_ROWS)})()})(),
    )

    out_path = tmp_path / "transitions.json"
    stats = pipeline.process(sample_size=0, out_path=out_path)

    assert out_path.exists()
    model = json.loads(out_path.read_text())

    assert model["version"] == 1
    assert model["source"].startswith("Chordonomicon")
    assert "generatedAt" in model
    assert model["songCount"] == 3  # rows 4 and 5 dropped, row 6 is a duplicate of row 1

    assert "ionian" in model["modes"]
    assert "aeolian" in model["modes"]

    ionian = model["modes"]["ionian"]
    assert "0:maj" in ionian["order1"]
    assert isinstance(ionian["order1"]["0:maj"]["5:maj"], float)
    assert ionian["totals1"]["0:maj"] > 0

    assert stats["songs_processed"] == 3
    assert stats["duplicates_skipped"] == 1
    assert stats["chord_tokens_dropped"] >= 2  # the two nonsense tokens
    assert stats["out_size_bytes"] > 0
    assert stats["songs_per_sec"] > 0
