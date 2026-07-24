"""Accumulate order-1 and order-2 transition counts per mode, in the exact shape
SPEC.md defines for `public/model/transitions.json`. Counts are floats because
soft key assignment (tp_data.keyest) contributes fractional counts across the
top 2-3 hypotheses rather than committing to one label per section.
"""

from __future__ import annotations

from collections import defaultdict

from tp_data.chords import ParsedChord, state_key
from tp_data.keyest import KeyHypothesis


def _nested_float_dict() -> dict[str, float]:
    return defaultdict(float)

def _nested_state_dict() -> dict[str, dict[str, float]]:
    return defaultdict(_nested_float_dict)

def _mode_dict() -> dict[str, dict[str, dict[str, float]]]:
    return defaultdict(_nested_state_dict)

def _float_dict() -> dict[str, float]:
    return defaultdict(float)

def _mode_total_dict() -> dict[str, dict[str, float]]:
    return defaultdict(_float_dict)


class TransitionCounter:
    def __init__(self, max_order: int = 3) -> None:
        self.max_order = max_order
        self.order1: dict[str, dict[str, dict[str, float]]] = _mode_dict()
        self.order2: dict[str, dict[str, dict[str, float]]] = _mode_dict()
        self.order3: dict[str, dict[str, dict[str, float]]] = _mode_dict()
        self.totals1: dict[str, dict[str, float]] = _mode_total_dict()
        self.totals2: dict[str, dict[str, float]] = _mode_total_dict()
        self.totals3: dict[str, dict[str, float]] = _mode_total_dict()

    def add_section(self, chords: list[ParsedChord], hypotheses: list[KeyHypothesis]) -> None:
        if len(chords) < 2 or not hypotheses:
            return
        for hyp in hypotheses:
            p = hyp.posterior
            if p <= 0:
                continue
            states = [
                state_key((c.pitch_class - hyp.tonic_pc) % 12, c.quality) for c in chords
            ]
            mode = hyp.mode
            for i in range(1, len(states)):
                prev, nxt = states[i - 1], states[i]
                self.order1[mode][prev][nxt] += p
                self.totals1[mode][prev] += p
            for i in range(2, len(states)):
                key = f"{states[i - 2]}>{states[i - 1]}"
                nxt = states[i]
                self.order2[mode][key][nxt] += p
                self.totals2[mode][key] += p
            if self.max_order >= 3:
                for i in range(3, len(states)):
                    key = f"{states[i - 3]}>{states[i - 2]}>{states[i - 1]}"
                    nxt = states[i]
                    self.order3[mode][key][nxt] += p
                    self.totals3[mode][key] += p

    def merge(self, other: TransitionCounter) -> None:
        for mode, prevs in other.order1.items():
            for prev, nxts in prevs.items():
                for nxt, c in nxts.items():
                    self.order1[mode][prev][nxt] += c
        for mode, keys in other.order2.items():
            for key, nxts in keys.items():
                for nxt, c in nxts.items():
                    self.order2[mode][key][nxt] += c
        for mode, keys in other.order3.items():
            for key, nxts in keys.items():
                for nxt, c in nxts.items():
                    self.order3[mode][key][nxt] += c
        for mode, pdict in other.totals1.items():
            for p, c in pdict.items():
                self.totals1[mode][p] += c
        for mode, kdict in other.totals2.items():
            for k, c in kdict.items():
                self.totals2[mode][k] += c
        for mode, kdict in other.totals3.items():
            for k, c in kdict.items():
                self.totals3[mode][k] += c

    def to_json_modes(self, round_ndigits: int = 4) -> dict:
        def r(x: float) -> float:
            return round(x, round_ndigits)

        modes_out = {}
        all_modes = set(self.order1) | set(self.order2) | set(self.order3)
        for mode in all_modes:
            m_dict = {
                "order1": {
                    prev: {nxt: r(c) for nxt, c in nexts.items()}
                    for prev, nexts in self.order1.get(mode, {}).items()
                },
                "order2": {
                    key: {nxt: r(c) for nxt, c in nexts.items()}
                    for key, nexts in self.order2.get(mode, {}).items()
                },
                "totals1": {p: r(c) for p, c in self.totals1.get(mode, {}).items()},
                "totals2": {k: r(c) for k, c in self.totals2.get(mode, {}).items()},
            }
            if self.max_order >= 3:
                m_dict["order3"] = {
                    key: {nxt: r(c) for nxt, c in nexts.items()}
                    for key, nexts in self.order3.get(mode, {}).items()
                }
                m_dict["totals3"] = {k: r(c) for k, c in self.totals3.get(mode, {}).items()}
            modes_out[mode] = m_dict
        return modes_out
