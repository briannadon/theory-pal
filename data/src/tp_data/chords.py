"""Chord symbol parsing -> (pitch_class, quality) in the v1 vocabulary from SPEC.md.

Two source notations are handled, because the Chordonomicon corpus and the McGill
Billboard validation corpus use different chord-chart conventions:

- Chordonomicon: ad hoc scraped notation, root letter + 's' for sharp / 'b' for flat +
  a free-text quality suffix (e.g. "Fsmin7", "Bbmin", "G/B", "Cadd9", "Ano3d").
- Harte (McGill Billboard): the standard MIREX/Harte chord notation, root + ':' +
  shorthand/interval list + optional '/bass' (e.g. "A:min7", "G:sus4(b7)", "N").

Both funnel into the same `classify_quality` decision table so the collapse policy
(SPEC v1 quality vocabulary) is applied identically regardless of source.

Collapse policy (documented here as the single source of truth; see data/README.md
for the human-readable version):

- Bare triad -> maj/min/dim/aug as written.
- Any quality carrying an explicit major-7th marker ("maj7", "maj9", "maj13", ...)
  collapses onto `maj7` (the 7th is structurally more important than 9/11/13 color
  tones, per SPEC's "collapse onto the 7th/triad base"). Exception: a bare "maj"
  (Harte's plain-major-triad shorthand) and "maj6"/"maj6(9)" have no 7th at all, so
  they collapse onto the `maj` triad instead.
- Plain "7"/"9"/"11"/"13" (no maj/min prefix) implies a dominant 7th chord (standard
  lead-sheet convention) -> `dom7`.
- "min7"/"min9"/"min11"/"min13" -> `min7`. "minadd9"/"minadd11"/"minadd13" have no
  7th (explicitly an added tone on a triad) -> `min` triad.
  "add9"/"add11"/"add13" (no min prefix) -> `maj` triad, same reasoning.
- "dim" + any 7th/extension marker -> `dim7`; bare "dim" -> `dim`.
- "hdim7" / "m7b5" (half-diminished 7) -> `m7b5`.
- "minmaj7" / "minMaj7" -> `minMaj7`.
- "aug" combined with a major-7th marker -> `maj7` (drop the #5 alteration, keep the
  7th, consistent with the "keep the 7th" rule above); combined with a plain 7 ->
  `dom7`; bare "aug" -> `aug`.
- "sus2"/"sus4" -> as written. "sus4" + a flat-7 marker ("7sus4", "sus4(b7)") ->
  `dom7sus4` (the only sus+7 combo in the v1 vocabulary). "sus2" + a 7 has no vocabulary
  slot, so it collapses down to plain `sus2` (drop the 7).
- Power chords / no-third chords ("no3d" in Chordonomicon, "5" or "1" shorthand in
  Harte) are **dropped**: without a 3rd there is no way to assign maj/min, and
  guessing would inject noise into both the key-profile and the transition counts.
  These chords still exist in the raw text but contribute no root/quality state.
- Anything else unparsed (typos, garbled tokens) is dropped and counted so the run
  report shows the drop rate.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

PITCH_CLASS_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_NOTE_LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

# v1 quality vocabulary, verbatim from SPEC.md. Order is not meaningful.
QUALITIES = frozenset(
    {
        "maj",
        "min",
        "dim",
        "aug",
        "maj7",
        "min7",
        "dom7",
        "m7b5",
        "dim7",
        "minMaj7",
        "sus2",
        "sus4",
        "dom7sus4",
    }
)


def pitch_class_from_letter_accidental(letter: str, accidental: str) -> int:
    pc = _NOTE_LETTER_PC[letter]
    if accidental == "#" or accidental == "s":
        pc += 1
    elif accidental == "b":
        pc -= 1
    return pc % 12


def classify_quality(suffix: str) -> Optional[str]:
    """Map a free-text quality suffix (already root/bass-stripped) onto the v1
    vocabulary, or None if it should be dropped. See module docstring for policy."""
    s = suffix.lower()

    # No-third / power-chord / bare-note markers: quality is fundamentally
    # unknowable (no 3rd present), always drop.
    if "no3d" in s:
        return None
    if s in ("5", "1", "1(b3", "b3"):
        return None

    has_sus2 = "sus2" in s
    has_sus4 = "sus4" in s
    has_bare_sus = "sus" in s and not has_sus2 and not has_sus4
    has_seven_marker = bool(re.search(r"(?<!\d)7", s)) or "b7" in s or "(b7" in s
    has_min = "min" in s
    has_majmarker = "maj" in s
    has_dim = "dim" in s or "hdim" in s
    has_aug = "aug" in s
    has_add = "add" in s
    has_extension_digit = bool(re.search(r"(9|11|13)", s))

    if has_sus2 or has_sus4 or has_bare_sus:
        if (has_sus4 or has_bare_sus) and has_seven_marker:
            return "dom7sus4"
        if has_sus2:
            return "sus2"
        return "sus4"

    if "minmaj" in s:
        return "minMaj7"

    if has_dim:
        if "hdim" in s:
            return "m7b5"  # half-diminished-7, distinct from full dim7
        if has_seven_marker or has_extension_digit:
            return "dim7"
        return "dim"

    if has_aug:
        if has_majmarker:
            return "maj7"
        if has_seven_marker:
            return "dom7"
        return "aug"

    if has_min:
        if has_add and not has_seven_marker:
            return "min"
        if has_seven_marker or has_extension_digit:
            return "min7"
        return "min"

    if has_majmarker:
        if s == "maj":
            return "maj"  # bare Harte "maj" shorthand = plain major triad, no 7th
        if "6" in s and not has_seven_marker:
            return "maj"  # maj6 (and maj6(9)) has no 7th, collapse to the triad
        return "maj7"

    if has_add and not has_seven_marker:
        return "maj"

    if s == "":
        return "maj"

    if has_seven_marker or has_extension_digit:
        return "dom7"

    return None


# --- Chordonomicon notation -------------------------------------------------

_CHORDONOMICON_ROOT_RE = re.compile(r"^[A-G]")


@dataclass(frozen=True)
class ParsedChord:
    pitch_class: int
    quality: str


def parse_chordonomicon_token(token: str) -> Optional[ParsedChord]:
    """Parse one whitespace-delimited chord token from the Chordonomicon `chords`
    column, e.g. "Fsmin7", "D/Fs", "Bbmin", "Cadd9", "Ano3d". Bass note after '/' is
    discarded (the model tracks root+quality only, no inversion)."""
    if not token or token.startswith("<"):
        return None
    chord_part = token.split("/", 1)[0]
    if not chord_part or not _CHORDONOMICON_ROOT_RE.match(chord_part):
        return None
    letter = chord_part[0]
    rest = chord_part[1:]
    accidental = ""
    if rest.startswith("s") and not rest.startswith("su"):
        accidental = "#"
        rest = rest[1:]
    elif rest.startswith("b"):
        accidental = "b"
        rest = rest[1:]
    quality = classify_quality(rest)
    if quality is None:
        return None
    pc = pitch_class_from_letter_accidental(letter, accidental)
    return ParsedChord(pitch_class=pc, quality=quality)


# --- Harte notation (McGill Billboard validation only) ----------------------

_HARTE_RE = re.compile(r"^([A-G])([#b]*)(?::([^/]*))?(?:/.*)?$")


def parse_harte_chord(token: str) -> Optional[ParsedChord]:
    """Parse one Harte-notation chord token, e.g. "A:min7", "G:sus4(b7)", "N", "X"."""
    token = token.strip()
    if not token or token in ("N", "X"):
        return None
    m = _HARTE_RE.match(token)
    if not m:
        return None
    letter, accidentals, shorthand = m.group(1), m.group(2), m.group(3)
    accidental = ""
    for a in accidentals:
        if a == "#":
            accidental = "#" if accidental != "b" else ""
        elif a == "b":
            accidental = "b" if accidental != "#" else ""
    shorthand = shorthand if shorthand is not None else "maj"
    quality = classify_quality(shorthand)
    if quality is None:
        return None
    pc = pitch_class_from_letter_accidental(letter, accidental)
    return ParsedChord(pitch_class=pc, quality=quality)


# --- Chord-tone intervals, for key-profile weighting -------------------------

CHORD_TONE_INTERVALS: dict[str, tuple[int, ...]] = {
    "maj": (0, 4, 7),
    "min": (0, 3, 7),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
    "maj7": (0, 4, 7, 11),
    "min7": (0, 3, 7, 10),
    "dom7": (0, 4, 7, 10),
    "m7b5": (0, 3, 6, 10),
    "dim7": (0, 3, 6, 9),
    "minMaj7": (0, 3, 7, 11),
    "sus2": (0, 2, 7),
    "sus4": (0, 5, 7),
    "dom7sus4": (0, 5, 7, 10),
}


def state_key(pitch_class_offset: int, quality: str) -> str:
    return f"{pitch_class_offset % 12}:{quality}"
