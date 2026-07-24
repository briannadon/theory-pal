# theory-pal

A browser-based chord progression assistant: select a key and scale, get corpus-driven next-chord suggestions with probabilities, build progressions in a grid, hear them through a built-in piano sound, or send them to hardware or a DAW over MIDI.

## Features

- **Key and scale selection**: Major, minor, harmonic minor, melodic minor, and all seven diatonic modes.
- **Corpus-driven suggestions**: Next-chord recommendations ranked by probability, trained on a real chord progression corpus with a theory-rule fallback for sparse data.
- **Non-diatonic chords**: Borrowed chords, secondary dominants, and modal mixture are always available, not filtered out.
- **Built-in piano sound**: Audition chords with Web Audio and a SoundFont player.
- **Live MIDI output**: Send chord progressions to a DAW or hardware synthesizer via Web MIDI.
- **Progression grid**: Drag chords into a 4/8/16-slot grid, reorder them, and hear the result.
- **MIDI export**: Save progressions as `.mid` files.

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

## Licensing

The code is licensed under the MIT License (see `LICENSE`). The trained model data is derived from the [Chordonomicon](https://huggingface.co/datasets/ailsntua/Chordonomicon) corpus, licensed under CC-BY-NC-4.0, so the model data cannot be used commercially. The NC restriction binds the data and the model derived from it, not the code.

## Attribution

Chord progression data comes from the Chordonomicon corpus (CC-BY-NC-4.0), published as [arXiv:2410.22046](https://arxiv.org/abs/2410.22046).
