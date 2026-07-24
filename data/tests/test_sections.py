from tp_data.sections import split_sections


def test_split_sections_basic():
    cell = "<intro_1> C <verse_1> F C E7 Amin <chorus_1> F C F C G"
    sections = split_sections(cell)
    labels = [s.label for s in sections]
    assert labels == ["intro", "verse", "chorus"]
    assert sections[0].tokens == ["C"]
    assert sections[1].tokens == ["F", "C", "E7", "Amin"]
    assert sections[2].tokens == ["F", "C", "F", "C", "G"]


def test_split_sections_leading_content_before_first_tag():
    cell = "C G <verse_1> Amin F"
    sections = split_sections(cell)
    assert sections[0].label == "unlabeled"
    assert sections[0].tokens == ["C", "G"]
    assert sections[1].label == "verse"


def test_split_sections_empty():
    assert split_sections("") == []
