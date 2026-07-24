# data/ -- offline corpus pipeline

Turns the [Chordonomicon](https://huggingface.co/datasets/ailsntua/Chordonomicon)
corpus into `public/model/transitions.json`, the static file `src/model/` fetches at
runtime. This directory is a uv-managed Python project; nothing in it ships with the
web app (see the root `.gitignore`: `data/.venv`, `data/.cache/` and pytest caches are
excluded, but the checked-in code and `pyproject.toml`/`uv.lock` are not).

Authoritative contracts: `PLAN.md` ("Data pipeline") and `SPEC.md` ("Trained model
file" and "`data/` -- Key/mode estimation"). This README covers how to run the
pipeline and what came out of the runs so far; it does not restate the contracts.

## Setup

```bash
cd data
uv sync          # creates data/.venv, installs pyarrow/requests/tqdm/pytest
uv run pytest -q # 20 tests, all synthetic/unit -- no network required
```

## Running the pipeline

Training can be run via **Multi-Core CPU** (recommended default) or **Vectorized PyTorch GPU**.

### 1. Multi-Core CPU Training (Fast, multi-processed)
```bash
# Full corpus training (Order-3, auto-detects all CPU cores)
uv run python -m tp_data.pipeline_cpu --sample-size 0 --max-order 3

# Sample run (10,000 songs)
uv run python -m tp_data.pipeline_cpu --sample-size 10000 --max-order 3
```

### 2. PyTorch GPU Training (CUDA accelerated)
```bash
# Full corpus training (Order-3 on NVIDIA GPU)
uv run python -m tp_data.pipeline_gpu --sample-size 0 --max-order 3
```

### 3. Post-Training Model Compression (Required step)
Once training finishes, compress and prune the raw model payload for production web client delivery:
```bash
uv run python -m tp_data.compress_model
```
*Reduces model payload size by ~60% (from ~112 MB raw down to 45 MB uncompressed / ~10 MB gzipped over HTTP).*

### Pipeline Flags

| Flag | Default | Meaning |
|---|---|---|
| `--sample-size` | `10000` | Songs to process. `0` = full ~680k-row corpus. |
| `--max-order` | `3` | Maximum Markov order (2 or 3). |
| `--num-workers` | auto | `pipeline_cpu` only. Number of CPU workers. `0`/omitted = all cores; negative integers (e.g. `-2`) reserve cores for system responsiveness. |
| `--gpu-batch-size` | `2048` | `pipeline_gpu` only. Batch size for PyTorch CUDA key estimation. |
| `--out` | `public/model/transitions.json` | Output path for trained model JSON. |
| `--force-download` | off | Re-download the corpus parquet even if `data/.cache/` already has it. |

First run downloads a ~92MB parquet file (see "Where the corpus comes from" below)
to `data/.cache/chordonomicon_v2.parquet` and reuses it on later runs.

## Where the corpus comes from

`ailsntua/Chordonomicon` on Hugging Face ships one 264MB CSV (`chordonomicon_v2.csv`),
but Hugging Face's dataset-server auto-converts every public dataset to Parquet, and
that copy is ~92MB, columnar, and supports HTTP range requests. `tp_data/hf_source.py`
downloads that Parquet file directly (`.../api/datasets/ailsntua/Chordonomicon/parquet/default/train/0.parquet`)
instead of the raw CSV, and streams rows out of it via `pyarrow.ParquetFile.iter_batches`
so memory stays bounded regardless of corpus size -- a sample run never loads the
full table.

### Actual schema (verified against the live dataset, not assumed)

PLAN.md's caveat that Chordonomicon ships **no key annotation** is confirmed. The
real columns are:

| Column | Type | Notes |
|---|---|---|
| `id` | int64 | |
| `chords` | string | The chord chart, with inline structural tags -- see below. |
| `release_date` | string, nullable | |
| `genres` | string, nullable | Space-separated quoted genre tags. |
| `decade` | float64, nullable | |
| `rock_genre` | string, nullable | |
| `artist_id` | string | |
| `main_genre` | string, nullable | |
| `spotify_song_id` | string, nullable | |
| `spotify_artist_id` | string, nullable | |

No `key`, `mode`, or `tonic` column of any kind. There is also no separate
section/structure column -- section tags (`<verse_1>`, `<chorus_1>`, `<solo_1>`, ...)
are inline markers inside the `chords` string itself, e.g.:

```
<intro_1> C <verse_1> F C E7 Amin C F C G7 C ... <chorus_1> F C F C G C F C E7 Amin C ...
```

`tp_data/sections.py` splits on those markers to get per-section chord lists, which
feeds SPEC step 4 ("per-section, not per-song").

679,807 rows total (per the HF datasets-server `/size` endpoint) -- close to but not
exactly the "666,000" in the paper title; presumably later additions to the same repo.

## Chord notation and the collapse policy

Chordonomicon's `chords` column uses an ad hoc scraped notation: root letter + `s` for
sharp / `b` for flat, then a free-text quality suffix, then an optional `/bass`
(e.g. `Fsmin7` = F#m7, `Bbmin` = Bbm, `D/Fs` = D over F# bass, `Cadd9`, `Ano3d`). The
McGill Billboard validation corpus (below) instead uses standard Harte notation
(`A:min7`, `G:sus4(b7)`). Both notations funnel into one shared quality classifier
(`tp_data/chords.py:classify_quality`) so the collapse policy is applied identically.
Full policy with every case is documented in that module's docstring; summary:

- Bare triads pass through as `maj`/`min`/`dim`/`aug`.
- Anything with an explicit 7th (`min7`, `dom7`, `maj7`, `dim7`, `m7b5`/`hdim7`,
  `minMaj7`) maps directly onto that v1 vocabulary member.
- Extensions with a 7th present (`maj9`, `min11`, `13`, `7b9`, ...) collapse onto
  their 7th-chord base, keeping the 7th and dropping the color tone, per SPEC's
  "collapse onto the 7th/triad base."
- Extensions with **no** 7th (`add9`, `minadd13`, `maj6`, bare Harte `maj`) collapse
  onto the plain triad.
- `sus2`/`sus4` pass through; `7sus4` -> `dom7sus4` (the only sus+7 slot in the v1
  vocabulary); `7sus2` has no such slot and collapses down to plain `sus2`.
- **Dropped entirely**: no-third / power chords (`no3d` in Chordonomicon, bare `5`/`1`
  in Harte) -- there is no way to assign maj/min without a 3rd, and guessing would
  inject noise into both the key profile and the transition counts. Also dropped:
  genuinely unparseable tokens (typos, garbled scrape artifacts).
- The bass note in a slash chord (`D/Fs`, `C:maj/5`) is discarded -- the model tracks
  root + quality only, no inversion (matches `RelChord` in SPEC.md, which has no
  inversion field; `AbsChord.inversion` is a display/voicing concern in `theory/`).

Drop rate on the run that produced the shipped model: **1.28%** (16,075 of
1,255,543 chord tokens dropped -- no-third/power chords and unparseable tokens
combined).

## Key/mode estimation

Implements SPEC.md's numbered procedure in `tp_data/keyest.py`:

1. **Chord-content profile matching** (`_profile_score`): a 12-pitch-class weight
   vector per section, root weighted 3x, other chord tones 1x, scaled by occurrence.
   Scored against all 12 tonics x 9 modes (the 7 diatonic modes plus harmonic and
   melodic minor -- see `tp_data/scales.py` for why the pipeline stops there).
   Normalized by total weight so the score doesn't grow with section length (an
   earlier version of this normalization was missing and let long sections drown out
   the disambiguation features below).
2. **Tonic-disambiguation features** (`_disambiguation_bonus`): first/last chord of
   the section, a smooth reward proportional to how often each candidate tonic's
   pitch class is played as a root, plus a general "characteristic scale-degree"
   consistency check at scale degrees 2/4/5/7 (0-indexed 1/3/4/6) that subsumes every
   example SPEC lists as one mechanism -- dorian's major IV vs. aeolian's minor iv,
   phrygian's major bII, lydian's major "raised" ii, and a major V vs. the natural
   minor modes' minor v are all instances of "does this degree's observed chord
   quality match this mode's diatonic triad there." `pipeline.py` and
   `validate_billboard.py` also pass the whole song's opening/closing chord root as a
   smaller cross-section hint, since an individual bridge or solo section may not
   itself resolve to the tonic even when the song clearly does overall.
3. **Soft assignment**: top 3 (tonic, mode) hypotheses by score, softmax with a fixed
   temperature, hypotheses below 3% posterior dropped and the rest renormalized to
   sum to 1.0.
4. **Per-section, not per-song**: `pipeline.py` calls the estimator once per section
   (from `tp_data/sections.py`) and never counts a transition across a section
   boundary. Fractional (float) counts, weighted by each hypothesis's posterior, are
   what land in `transitions.json` -- nothing downstream needs to know a soft
   assignment happened.

This is a heuristic scorer, not a fitted model -- there's no large labeled corpus of
"chords -> correct key" to fit weights against. The constants live at the top of
`keyest.py` and were tuned by hand against the Billboard validation below (a grid
search over root-frequency weight, first/last-chord weight, and the
characteristic-degree weight, comparing tonic accuracy at each point). Two findings
from that search are worth calling out because they're not what naive intuition
would predict:

- Weighting a section's own **last** chord heavily hurts accuracy. Real chord
  charts include fadeouts, instrumental outros, and bridges that don't end on the
  tonic; over-trusting "the last chord in this chunk of text is the resolution"
  pulls predictions toward whatever a bridge or fadeout happens to land on. The
  *song's overall opening chord* (`SONG_FIRST_CHORD_BONUS`), by contrast, turned out
  to be a strong and reliable anchor, so it carries real weight while the
  song-level closing-chord hint (`SONG_LAST_CHORD_BONUS`) is disabled (`0.0`).
- Root frequency is a real signal but not a dominant one. Cranking
  `ROOT_FREQUENCY_WEIGHT` up (from ~3 to ~9) measurably hurt accuracy, because
  plenty of real songs vamp on V or IV more often than I -- the dominant or
  subdominant chord is sometimes the single most-frequent root even when the tonic
  is unambiguous by ear. A moderate weight beat an aggressive one.

## Validation against McGill Billboard

`scripts/validate_billboard.py` runs the estimator against the
[McGill Billboard](https://ddmal.music.mcgill.ca/research/The_McGill_Billboard_Project_(Chord_Analysis_Dataset)/)
corpus (890 songs, CC0, expert-annotated chord charts with a `# tonic:` header per
song). Get the data and run:

```bash
curl -L "https://www.dropbox.com/s/2lvny9ves8kns4o/billboard-2.0-salami_chords.tar.gz?dl=1" \
  -o data/.cache/billboard-salami_chords.tar.gz
tar xzf data/.cache/billboard-salami_chords.tar.gz -C data/.cache/
uv run python scripts/validate_billboard.py --corpus-dir .cache/McGill-Billboard
```

Billboard's annotation only gives the tonic pitch class (`# tonic: C`), not a
major/minor label -- there is no mode field in the source data. The validation script
derives a ground-truth major/minor bucket per song from the chart itself: the
majority quality (maj-ish vs. min-ish) among chords rooted at the annotated tonic.
That's a different, much cheaper signal than our estimator's own reasoning (a bare
majority vote on one pitch class, vs. profile matching plus several disambiguation
features), so grading against it isn't circular -- it's the closest thing to a mode
label this corpus actually contains. Songs where the tonic-rooted chord never appears,
or ties exactly, are excluded from the mode-accuracy denominator only.

**Results: 74.2% tonic accuracy (657/886), 89.0% major/minor mode accuracy
(784/881), over 886 songs scored** (4 of the 890 Billboard songs produced no
prediction -- every section too short to score -- and were excluded). SPEC's bar is
"under ~75% tonic accuracy... needs work before spending a full-corpus run"; 74.2%
lands right at that line, not comfortably above it. Worth being direct about what
that number means and doesn't: the remaining errors are structured, not random --
roughly 11% of misses are the estimator landing on the dominant or subdominant
instead of the true tonic (a fifth or fourth away), which is the classic failure
mode for any chord-root-frequency-based key finder, since real songs frequently
emphasize V or IV more than I. Getting meaningfully past this without audio-derived
pitch information (not available from Chordonomicon) would need a fundamentally
richer feature set than "reweight the same chord-content signals harder" -- that was
tried during tuning and hit diminishing returns. This is good enough to proceed to
the sample run SPEC calls for, but the full 666k-song run is a judgment call for
whoever is deciding to spend it, not a slam dunk.

## Sample run (this run)

The full 666k/680k-song corpus run happens later on the user's say-so; this run is a
small sample to validate the pipeline end-to-end and give real timing/memory numbers.
It is the run that produced the `public/model/transitions.json` currently checked in.

```
uv run python -m tp_data.pipeline --sample-size 15000
```

| Metric | Value |
|---|---|
| Songs processed | 15,000 (15,082 rows scanned, 0 exact-duplicate charts skipped) |
| Sections processed | 98,622 (3,415 sections skipped for having fewer than 2 chords) |
| Chord tokens seen / dropped | 1,255,543 / 16,075 (1.28%) |
| Wall time (processing only, after the one-time download) | 49.3s |
| Throughput | 304.1 songs/sec |
| Peak RSS | 142.6 MB |
| Output size | 2,922,632 bytes (2.9 MB) |
| Modes populated | all 9 (ionian, dorian, phrygian, lydian, mixolydian, aeolian, locrian, harmonicMinor, melodicMinor) |

(The one-time corpus download, a 92MB parquet file cached at
`data/.cache/chordonomicon_v2.parquet`, took under a second on a warm cache and is
excluded from the throughput figure above; expect ~10-15s on a cold cache depending
on network speed.)

### Full-corpus extrapolation

Linear extrapolation from the measured 304.1 songs/sec, to the full 679,807-row
corpus:

**Estimated full-corpus wall time: ~37 minutes (2,236s), plus the one-time ~10-15s
download.** That is a coffee-break job, not an overnight one, assuming throughput
holds -- see caveats below.

**Estimated full-corpus peak memory: roughly 400-700MB**, i.e. the measured 142.6MB
scaled by a rough 3-5x, not scaled linearly with the 45x increase in song count (680k
/ 15k). Reasoning: peak RSS here is dominated by the transitions dictionary, which
grows with the *number of distinct (mode, prev-state, next-state) combinations
discovered*, not with song count directly. The state space is bounded -- 13
qualities x 12 offsets per state, so at most ~156 order-1 states and low tens of
thousands of order-2 pairs per mode, across 9 modes -- and coverage saturates well
before 680k songs, since the same common transitions (I->IV, I->V, etc.) recur
constantly while genuinely novel states become rarer as corpus size grows. This
run measured a single data point (142.6MB at 15k songs), not a memory-vs-corpus-size
curve, so the 3-5x full-corpus figure is an informed estimate from the shape of that
growth curve, not a second measurement -- if it matters for planning the full run,
the honest move is to re-run at a larger sample (e.g. 100k) and check whether peak
RSS is actually flattening out as expected before committing to the 680k run
unsupervised.

Caveats on the time estimate:
- It is linear in song count; actual throughput should be roughly flat since the
  per-song cost (parse + score 108 key hypotheses per section + count transitions)
  doesn't depend on how many other songs have already been processed. The 15k run
  itself shows this: throughput was stable from 336 songs/sec in the first 2,000
  songs down to 301 songs/sec by 14,000 (see the per-2000-song progress log in the
  pipeline's own stdout), a mild slowdown consistent with a growing (but bounded)
  Python dict, not a runaway one.
- JSON serialization and the file write happen once at the end, not per-song, so
  they don't scale into this per-song rate at all; at full-corpus scale the output
  dict will be larger (more distinct states discovered) but still a single
  in-memory `json.dump` of a many-MB, not many-GB, structure.

## Licensing / attribution

Chordonomicon is licensed **CC-BY-NC-4.0**. That means:
- Attribution is required (this README, plus the app footer/about section) --
  citation: Kantarelis et al., "CHORDONOMICON: A Dataset of 666,000 Songs and their
  Chord Progressions," [arXiv:2410.22046](https://arxiv.org/abs/2410.22046).
- The **derived model** (`transitions.json`) inherits the NC restriction and cannot
  be used commercially. The app code itself is unaffected and can carry its own
  license (MIT, per PLAN.md) since NC binds the data, not the code.

McGill Billboard is CC0 (public domain) and used here only for validation; it is not
redistributed and no Billboard content lands in `transitions.json`.
