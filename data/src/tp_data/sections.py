"""Split a Chordonomicon `chords` cell into ordered sections.

Chordonomicon has no separate structural-annotation column: section tags are
inline markers within the `chords` string itself, e.g.:

    "<intro_1> C <verse_1> F C E7 Amin C F ... <chorus_1> F C F C G C ..."

SPEC.md step 4 requires per-section key estimation ("do not count transitions
across section boundaries"), so this module's only job is turning that string
into `[Section(label, [tokens...]), ...]` in order.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_TAG_RE = re.compile(r"<([a-zA-Z]+)_?\d*>")


@dataclass
class Section:
    label: str
    tokens: list[str]


def split_sections(chords_cell: str) -> list[Section]:
    if not chords_cell:
        return []
    sections: list[Section] = []
    current_label = "unlabeled"
    current_tokens: list[str] = []

    pos = 0
    for m in _TAG_RE.finditer(chords_cell):
        pre = chords_cell[pos : m.start()].split()
        current_tokens.extend(pre)
        if current_tokens:
            sections.append(Section(current_label, current_tokens))
        current_label = m.group(1)
        current_tokens = []
        pos = m.end()
    tail = chords_cell[pos:].split()
    current_tokens.extend(tail)
    if current_tokens:
        sections.append(Section(current_label, current_tokens))

    return sections
