"""maqrat: absence never hides — no own-page removal signal exists (measured 2026-10-07).

oracle-feasibility-probe run 37618176662: the 3 hidden ads' pages answer 200 exactly like 10 live
ones, so the absence-only prune hid ads whose pages still render (P1 unknown_treated_as_dead).
"""
from __future__ import annotations

from scrapers.maqrat import run as R


def test_the_oracle_never_says_gone():
    assert R.no_removal_signal("MQR36")[0] == "unknown"


def test_the_prune_is_handed_the_withholding_oracle():
    src = open(R.__file__, encoding="utf-8").read()
    assert "verify_gone=no_removal_signal)" in src
    assert 'db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)\n' not in src
