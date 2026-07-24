# theory-pal

A browser-based chord progression assistant: select a key and scale, get corpus-driven next-chord suggestions with probabilities, build progressions in a grid, hear them through a built-in piano sound, or send them to hardware or a DAW over MIDI.

## Features

- **Key and scale selection**: Major, minor, harmonic minor, melodic minor, and all seven diatonic modes.
- **In-key chord modifiers**: Stack sus2/sus4 (mutually exclusive), 7, and 9 onto the "In key" row; every diatonic chord re-renders with the modifiers applied.
- **Corpus-driven suggestions**: Next-chord recommendations ranked by probability, trained on a real chord progression corpus with an Order-3 Markov model and theory-rule fallback.
- **Non-diatonic chords**: Borrowed chords, secondary dominants, and modal mixture are always available, not filtered out.
- **Built-in piano sound**: Audition chords with Web Audio and a SoundFont player. Samples load on page open, so the first chord you click sounds immediately.
- **Live MIDI output**: Send chord progressions to a DAW or hardware synthesizer via Web MIDI.
- **Progression grid & direct chord editing**: Drag chords into a 4/8/16-slot grid, modify individual chord qualities directly via inline selectors, reorder slots, and hear the result.
- **Arpeggiator**: Play each bar as block chords or an arpeggio (up, down, up-down, down-up, random) at 1/4 through 1/16, including triplets.
- **Melody lane**: A piano-roll editor under the grid, with rows tinted by what each pitch means against the chord in that bar (chord tone, other scale tone, off-scale). Click to add, drag to move, drag a note's right edge to lengthen, click it to delete.
- **Procedural melody generation**: Generate a singable melody over the progression, with a single "surprise" slider that unlocks liberties in stages. Pitch choice ports Temperley's RPK model of melody perception (range, pitch proximity, and corpus key profiles, fit to the Essen Folksong Collection); harmony and rhythm rules sit on top. Not corpus-trained: the Chordonomicon data is chords only.
- **MIDI export**: Save progressions as `.mid` files, including arpeggios and the melody line.

## Running Locally

### Prerequisites

- Node.js 22 or later
- npm

### Installation

```bash
npm install
npm run dev
```

The app opens at `http://localhost:5173`.

### Building for Deployment

```bash
npm run build
```

Output is in `dist/`.

## Testing

Run the theory and model modules with Vitest:

```bash
npm run test
```

## Deployment

The app is deployed to GitHub Pages at [briannadon.github.io/theory-pal](https://briannadon.github.io/theory-pal). Pushes to the default branch trigger a GitHub Actions workflow that builds and deploys automatically.

To enable GitHub Pages deployment:
1. Go to repository settings.
2. Under "Pages", set the source to "GitHub Actions".

## Project Layout

```
src/
  theory/     Pure TypeScript: scales, chords, intervals, note spelling.
  model/      Suggestion engine with corpus transitions and theory priors.
  audio/      SoundFont piano player and lookahead scheduler.
  midi/       Web MIDI output and .mid file export.
  ui/         React components: key/scale picker, suggestion strips, grid, transport.
data/
  Python pipeline (offline) to build the model from the Chordonomicon corpus.
```

## Model Training & Compression

To re-train the Order-3 Markov model from the Chordonomicon corpus:

```bash
cd data
uv sync

# Train via GPU (CUDA) or Multi-Core CPU (auto-detects cores)
uv run python -m tp_data.pipeline_gpu --sample-size 0 --max-order 3
# or: uv run python -m tp_data.pipeline_cpu --sample-size 0 --max-order 3

# Prune and compress output model for production web delivery
uv run python -m tp_data.compress_model
```
Outputs the trained, compressed model payload to `public/model/transitions.json`. See [data/README.md](file:///home/bdn/repos/theory-pal/data/README.md) for full pipeline details and flags.

## Licensing

The code is licensed under the MIT License (see `LICENSE`). The trained model data is derived from the [Chordonomicon](https://huggingface.co/datasets/ailsntua/Chordonomicon) corpus, licensed under CC-BY-NC-4.0, so the model data cannot be used commercially. The NC restriction binds the data and the model derived from it, not the code.

## Attribution

Chord progression data comes from the Chordonomicon corpus (CC-BY-NC-4.0), published as [arXiv:2410.22046](https://arxiv.org/abs/2410.22046).
