"""maqrat: absence never hides — no own-page removal signal exists (measured 2026-10-07).

oracle-feasibility-probe run 37618176662: the 3 hidden ads' pages answer 200 exactly like 10 live
ones, so the absence-only prune hid ads whose pages still render (P1 unknown_treated_as_dead).

2026-11-03: the one statement maqrat does publish, each ad's own licence end date, retires an ad the
complete list stopped serving — the fleet default (db._published_end_passed). Six of the eleven ads held
at 9-30 strikes left the list on their licence end date to the day. Anything else stays UNKNOWN.
"""
from __future__ import annotations

from scrapers.maqrat import run as R


def test_the_oracle_never_says_gone():
    assert R.no_removal_signal("MQR36")[0] == "unknown"


def _oracle(row):
    return R.licence_end_oracle("maqrat_residential_listings", lookup=lambda _a: row)


def test_a_passed_licence_end_date_is_gone():
    verdict, why = _oracle({"license_expiry": "2026/10/03"})("MQR36")
    assert verdict == "gone" and "2026/10/03" in why


def test_a_future_licence_end_date_stays_unknown():
    assert _oracle({"license_expiry": "2099/07/27"})("MQR10115")[0] == "unknown"


def test_no_date_unreadable_date_or_failed_lookup_stays_unknown():
    assert _oracle({"license_expiry": None})("MQR1")[0] == "unknown"
    assert _oracle({"license_expiry": "قريباً"})("MQR1")[0] == "unknown"
    assert _oracle(None)("MQR1")[0] == "unknown"


def test_the_oracle_never_says_live():
    # a licence still running is not proof the ad is on the site: the page is indistinguishable
    assert _oracle({"license_expiry": "2099/01/01"})("MQR1")[0] != "live"


def test_the_prune_is_handed_the_licence_oracle():
    src = open(R.__file__, encoding="utf-8").read()
    assert "verify_gone=licence_end_oracle(tbl))" in src
    assert "verify_gone=no_removal_signal)" not in src
    assert 'db.prune_unseen(tbl, {r["ad_number"] for r in rr}, source=SOURCE)\n' not in src
