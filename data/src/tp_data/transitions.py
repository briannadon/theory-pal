"""Accumulate order-1 and order-2 transition counts per mode, in the exact shape
SPEC.md defines for `public/model/transitions.json`. Counts are floats because
soft key assignment (tp_data.keyest) contributes fractional counts across the
top 2-3 hypotheses rather than committing to one label per section.
"""

from __future__ import annotations

from collections import defaultdict

from tp_data.chords import ParsedChord, state_key
from tp_data.keyest import KeyHypothesis


class TransitionCounter:
    def __init__(self) -> None:
        # mode -> prev_state -> next_state -> count
        self.order1: dict[str, dict[str, dict[str, float]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(float))
        )
        # mode -> "prev2>prev1" -> next_state -> count
        self.order2: dict[str, dict[str, dict[str, float]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(float))
        )
        self.totals1: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        self.totals2: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))

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

    def to_json_modes(self, round_ndigits: int = 4) -> dict:
        def r(x: float) -> float:
            return round(x, round_ndigits)

        modes_out = {}
        all_modes = set(self.order1) | set(self.order2)
        for mode in all_modes:
            modes_out[mode] = {
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
        return modes_out
