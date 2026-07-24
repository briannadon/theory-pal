import math

from tp_data.chords import ParsedChord as PC
from tp_data.keyest import estimate_key_hypotheses


def test_hypotheses_posteriors_sum_to_one():
    chords = [PC(0, "maj"), PC(5, "maj"), PC(7, "maj"), PC(0, "maj")]
    hyps = estimate_key_hypotheses(chords)
    assert 1 <= len(hyps) <= 3
    total = sum(h.posterior for h in hyps)
    assert math.isclose(total, 1.0, abs_tol=1e-6)


def test_empty_input():
    assert estimate_key_hypotheses([]) == []


def test_clear_c_ionian_progression():
    # I IV V I IV V vi IV V I in C major, unambiguous cadence + most-frequent tonic.
    chords = [
        PC(0, "maj"), PC(5, "maj"), PC(7, "maj"), PC(0, "maj"),
        PC(5, "maj"), PC(7, "maj"), PC(9, "min"), PC(5, "maj"),
        PC(7, "maj"), PC(0, "maj"),
    ]
    hyps = estimate_key_hypotheses(chords)
    top = max(hyps, key=lambda h: h.posterior)
    assert top.tonic_pc == 0
    assert top.mode == "ionian"


def test_relative_minor_disambiguated_by_cadence_and_frequency():
    # i bVI bIII bVII i bVI bIII bVII i in A aeolian. Same pitch-class content as
    # C ionian (A/F/C/G triads, all natural) -- profile matching alone should tie;
    # first/last chord + most-frequent-root bonuses must break the tie toward A.
    a, f, c, g = 9, 5, 0, 7
    chords = [
        PC(a, "min"), PC(f, "maj"), PC(c, "maj"), PC(g, "maj"),
        PC(a, "min"), PC(f, "maj"), PC(c, "maj"), PC(g, "maj"),
        PC(a, "min"),
    ]
    hyps = estimate_key_hypotheses(chords)
    top = max(hyps, key=lambda h: h.posterior)
    assert top.tonic_pc == a
    assert top.mode == "aeolian"


def test_dorian_vs_aeolian_major_iv():
    # i IV i IV bVII i in D, with a MAJOR IV (G) -- the defining dorian trait
    # (natural aeolian's iv would be minor). Same pitch classes as C ionian, but the
    # tonic-disambiguation bonuses (cadence + frequency on D) should win, and among
    # D-tonic hypotheses the major-IV consistency check should favor dorian over
    # aeolian.
    d, g, c = 2, 7, 0
    chords = [
        PC(d, "min"), PC(g, "maj"), PC(d, "min"), PC(g, "maj"),
        PC(c, "maj"), PC(d, "min"),
    ]
    hyps = estimate_key_hypotheses(chords)
    top = max(hyps, key=lambda h: h.posterior)
    assert top.tonic_pc == d
    assert top.mode == "dorian"
