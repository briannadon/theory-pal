// Translating between a chord and the controls the chord editor shows for it:
// the modifier toggles, the quality row, and the degree grid.
//
// The awkward part this hides: sus lives in two places. `sus2`, `sus4` and
// `dom7sus4` are members of the closed `ChordQuality` vocabulary (the model
// counts them, and the corpus contains them), while the strip and the grid
// popover apply sus as a `ChordMods` flag on top of some other quality. Both
// spell the same chord. `normalizeChord` rewrites the quality form into the
// mods form so the toggles have exactly one representation to reason about,
// and every toggle becomes a flag flip.
//
// The seventh is the exception, and stays one: which seventh a chord takes is
// a fact about the key, not about the chord, so it moves the `quality` rather
// than setting a flag (see `withSeventh`).
import {
  chordShape,
  hasSeventh,
  qualityAtDegree,
  withSeventh,
  withoutSeventh,
  type ChordMods,
  type ChordQuality,
  type Key,
  type RelChord,
} from '../../theory/index.ts';
import { NO_MODIFIERS, type ChordModifier, type ModifierState } from '../components/ModifierBar.tsx';

/** Sus qualities rewritten as (quality, sus flag) pairs. */
const SUS_QUALITY_FORM: Partial<Record<RelChord['quality'], { quality: RelChord['quality']; mods: ChordMods }>> = {
  sus2: { quality: 'maj', mods: { sus2: true } },
  sus4: { quality: 'maj', mods: { sus4: true } },
  dom7sus4: { quality: 'dom7', mods: { sus4: true } },
};

/** The same chord with any sus carried by `mods` rather than by `quality`. */
export function normalizeChord(chord: RelChord): RelChord {
  const form = SUS_QUALITY_FORM[chord.quality];
  if (!form) return chord;
  return {
    ...chord,
    quality: form.quality,
    mods: { ...chord.mods, ...form.mods },
  };
}

/** Which toggles are lit for this chord, however it happens to be spelled. */
export function modifierState(chord: RelChord): ModifierState {
  const shape = chordShape(chord.quality, chord.mods);
  return {
    sus2: shape.third === 'sus2' || shape.third === 'sus2/4',
    sus4: shape.third === 'sus4' || shape.third === 'sus2/4',
    sixth: shape.sixth,
    seventh: shape.seventh !== null,
    ninth: shape.ninth,
    eleventh: shape.eleventh,
    thirteenth: shape.thirteenth,
  };
}

const MOD_FLAGS: Record<Exclude<ChordModifier, 'seventh'>, keyof ChordMods> = {
  sus2: 'sus2',
  sus4: 'sus4',
  sixth: 'sixth',
  ninth: 'ninth',
  eleventh: 'eleventh',
  thirteenth: 'thirteenth',
};

/** Flip one modifier on a chord, in the key that decides what "add the 7th"
 * means. Returns a new chord; `mods` is dropped entirely when nothing is left
 * set, so an unmodified chord stays byte-identical to one that never had
 * modifiers. */
export function toggleModifier(chord: RelChord, key: Key, modifier: ChordModifier): RelChord {
  const normalized = normalizeChord(chord);
  const state = modifierState(normalized);

  if (modifier === 'seventh') {
    return state.seventh ? withoutSeventh(normalized) : withSeventh(normalized, key);
  }

  const flag = MOD_FLAGS[modifier];
  const mods: ChordMods = { ...normalized.mods, [flag]: !state[modifier] };
  for (const k of Object.keys(mods) as (keyof ChordMods)[]) {
    if (!mods[k]) delete mods[k];
  }
  const { mods: _dropped, ...rest } = normalized;
  return Object.keys(mods).length > 0 ? { ...rest, mods } : rest;
}

/**
 * Move a chord to another chromatic degree, keeping everything about it that
 * is not tied to its root.
 *
 * The quality *is* tied to the root — vii° is diminished because of where it
 * sits, not because the user asked for a diminished chord — so it re-snaps to
 * whatever that degree naturally takes in this key (`qualityAtDegree`), which
 * is why picking VII in C major gives vii° rather than VII. Whether the chord
 * has a seventh is a separate choice the user already made, so it survives the
 * move and is re-derived for the new degree: V7 dragged to IV becomes IVmaj7,
 * not a IV triad and not a IV dominant. Extensions ride along untouched.
 */
export function setDegree(chord: RelChord, key: Key, degree: number): RelChord {
  const normalized = normalizeChord(chord);
  const moved: RelChord = { ...normalized, degree, quality: qualityAtDegree(key, degree) };
  return hasSeventh(normalized.quality) ? withSeventh(moved, key) : moved;
}

/** The base quality the quality row shows as selected: sus spelled in the
 * quality slot is a modifier as far as this editor is concerned, so it reports
 * the triad or seventh underneath it. */
export function baseQuality(chord: RelChord): ChordQuality {
  return normalizeChord(chord).quality;
}

/**
 * Set the chord's quality outright — the one edit that is *not* re-derived
 * from the key, because it is the user overruling what the degree implies
 * (a major III in a minor key, a dim7 anywhere).
 *
 * Sevenths live in the quality vocabulary rather than in `mods`, so choosing a
 * triad here drops the seventh and choosing a seventh adds one; that is the
 * same control the 7 toggle drives, and they stay consistent because both read
 * back through `modifierState`.
 */
export function setQuality(chord: RelChord, quality: ChordQuality): RelChord {
  return { ...normalizeChord(chord), quality };
}

export { NO_MODIFIERS };
