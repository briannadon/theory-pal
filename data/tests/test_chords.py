from tp_data.chords import (
    classify_quality,
    parse_chordonomicon_token,
    parse_harte_chord,
    pitch_class_from_letter_accidental,
    state_key,
)


def test_pitch_class_basic():
    assert pitch_class_from_letter_accidental("C", "") == 0
    assert pitch_class_from_letter_accidental("C", "#") == 1
    assert pitch_class_from_letter_accidental("C", "b") == 11
    assert pitch_class_from_letter_accidental("A", "") == 9


def test_classify_quality_triads():
    assert classify_quality("") == "maj"
    assert classify_quality("min") == "min"
    assert classify_quality("dim") == "dim"
    assert classify_quality("aug") == "aug"


def test_classify_quality_sevenths():
    assert classify_quality("7") == "dom7"
    assert classify_quality("min7") == "min7"
    assert classify_quality("maj7") == "maj7"
    assert classify_quality("dim7") == "dim7"
    assert classify_quality("hdim7") == "m7b5"
    assert classify_quality("minmaj7") == "minMaj7"


def test_classify_quality_sus():
    assert classify_quality("sus2") == "sus2"
    assert classify_quality("sus4") == "sus4"
    assert classify_quality("7sus4") == "dom7sus4"
    assert classify_quality("sus4(b7)") == "dom7sus4"
    assert classify_quality("7sus2") == "sus2"  # no vocab slot, collapse down


def test_classify_quality_extensions_collapse_to_base():
    assert classify_quality("add9") == "maj"
    assert classify_quality("minadd9") == "min"
    assert classify_quality("9") == "dom7"
    assert classify_quality("min9") == "min7"
    assert classify_quality("maj9") == "maj7"
    assert classify_quality("13") == "dom7"
    assert classify_quality("maj13") == "maj7"
    assert classify_quality("min13") == "min7"


def test_classify_quality_aug_combinations():
    assert classify_quality("augmaj7") == "maj7"
    assert classify_quality("aug(b7)") == "dom7"


def test_classify_quality_no3d_dropped():
    assert classify_quality("no3d") is None
    assert classify_quality("7no3d") is None


def test_parse_chordonomicon_token_basic():
    c = parse_chordonomicon_token("C")
    assert c.pitch_class == 0 and c.quality == "maj"

    c = parse_chordonomicon_token("Amin")
    assert c.pitch_class == 9 and c.quality == "min"

    c = parse_chordonomicon_token("Fsmin")
    assert c.pitch_class == 6 and c.quality == "min"  # F# = 6

    c = parse_chordonomicon_token("Bbmin")
    assert c.pitch_class == 10 and c.quality == "min"  # Bb = 10

    c = parse_chordonomicon_token("G7")
    assert c.pitch_class == 7 and c.quality == "dom7"

    c = parse_chordonomicon_token("Bsus4")
    assert c.pitch_class == 11 and c.quality == "sus4"  # root stays B, not B#

    c = parse_chordonomicon_token("Cadd9")
    assert c.pitch_class == 0 and c.quality == "maj"


def test_parse_chordonomicon_token_slash_bass_and_no3d():
    c = parse_chordonomicon_token("D/Fs")
    assert c.pitch_class == 2 and c.quality == "maj"  # bass dropped, root stays D

    assert parse_chordonomicon_token("Ano3d") is None
    assert parse_chordonomicon_token("<verse_1>") is None
    assert parse_chordonomicon_token("") is None


def test_parse_harte_chord():
    c = parse_harte_chord("A:min")
    assert c.pitch_class == 9 and c.quality == "min"

    c = parse_harte_chord("G:sus4(b7)")
    assert c.pitch_class == 7 and c.quality == "dom7sus4"

    c = parse_harte_chord("C:maj/5")
    assert c.pitch_class == 0 and c.quality == "maj"

    c = parse_harte_chord("Bb:hdim7")
    assert c.pitch_class == 10 and c.quality == "m7b5"

    assert parse_harte_chord("N") is None
    assert parse_harte_chord("X") is None
    assert parse_harte_chord("C:5") is None  # power chord, no 3rd


def test_state_key_format():
    assert state_key(0, "maj") == "0:maj"
    assert state_key(10, "maj") == "10:maj"
    assert state_key(9, "min7") == "9:min7"
