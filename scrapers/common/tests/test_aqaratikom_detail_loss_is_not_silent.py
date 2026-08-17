"""aqaratikom's detail fetch must not fail SILENTLY into a summary-only row (senior run #25, 2026-08-17).

THE DEFECT THIS LOCKS IN
------------------------
aqaratikom (nawait.sa) builds every row from TWO calls:

  POST /api/v1/ad          → the summary: price, area, category, city, media
  GET  /api/v1/ad/<uuid>   → the detail:  estate.details[] (عدد دورة المياه, عدد الصالات,
                             عرض الشارع, واجهة العقار, مصعد, مطبخ) AND `subtype`, the rent period

`map_listing` deliberately still emits a row when the detail call fails, so the listing is not lost
entirely. The bug was that NOTHING noticed: the row was upserted from the summary alone, missing
every detail-only field, and `end_run` reported ok=true. 24 of 132 active rows sat in that state,
8 of them searchable Rent apartments whose rent_period was NULL — so neither the annual nor the
monthly Filter chip could reach them (alert searchability_collapse:aqaratikom, 100% → 82.6%).

WHAT MADE IT STICKY, and the actual line that was wrong: `fetch_detail` returned None on the FIRST
attempt when a 200 response's body was unparseable or lacked the `data` object — no retry. A soft
block / WAF interstitial is exactly that shape, so an affected listing lost its detail record on
every single daily crawl, forever, while the run looked healthy.

WHY THIS IS NOT "the source doesn't publish it" (owner permanent rule #2, 2026-08-13): all 8 rows
were re-probed live through the scraper's OWN detail endpoint on 2026-08-17 and returned HTTP 200
with subtype=«سنوي» and a price matching the stored value exactly. Absence in our database was OURS.
Probes recorded in ops_rent_period_source_probe. Compare senior run #15, which made the opposite
mistake on this very platform: it called 13 rows a source limitation on absence alone, and the
source published «سنوي» on all 13.

THE TWO RULES GUARDED HERE ARE IN TENSION, WHICH IS THE POINT:
  1. A transient/ambiguous detail failure must be RETRIED, not accepted (this is the bug fixed).
  2. When the detail genuinely is unavailable, rent_period must stay NULL — never defaulted to
     'annual'. Manufacturing a period is the 12x-understatement defect fought on souq24, on aqar's
     retired annual default, and re-litigated in run #22. A fix for rule 1 must not "helpfully"
     violate rule 2.

Run: python -m pytest scrapers/common/tests/test_aqaratikom_detail_loss_is_not_silent.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.aqaratikom import run as aq  # noqa: E402


class _Resp:
    """Minimal stand-in for a curl_cffi response."""

    def __init__(self, status: int, payload=None, raise_json: bool = False):
        self.status_code = status
        self._payload = payload
        self._raise_json = raise_json

    def json(self):
        if self._raise_json:
            raise ValueError("not json")
        return self._payload


class _FakeSession:
    """Replays a scripted list of responses and counts the GETs it served."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def get(self, url, timeout=None):
        self.calls += 1
        if not self._responses:
            raise AssertionError("fetch_detail made more requests than the script provides")
        r = self._responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture(autouse=True)
def _no_sleep_no_throttle(monkeypatch):
    """Keep the retry backoff and the global rate limiter out of the test's wall clock."""
    monkeypatch.setattr(aq.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(aq, "_throttle", lambda: None)


def _install(monkeypatch, responses) -> _FakeSession:
    fake = _FakeSession(responses)
    monkeypatch.setattr(aq, "_session", lambda: fake)
    return fake


GOOD_DETAIL = {"data": {"id": "uuid-1", "type": "rent", "subtype": "سنوي",
                        "price": "85,000", "estate": {"area": 122, "category": "شقة"}}}


# ── Rule 1: an ambiguous failure is retried, not accepted ────────────────────────────────────────
def test_200_with_unexpected_shape_is_retried_and_can_still_succeed(monkeypatch):
    """THE REGRESSION. A 200 whose body lacks `data` used to return None immediately, with zero
    retries, permanently downgrading the listing to summary-only."""
    fake = _install(monkeypatch, [
        _Resp(200, {"message": "Unauthenticated."}),  # soft block / interstitial
        _Resp(200, GOOD_DETAIL),                      # the real record on retry
    ])
    got = aq.fetch_detail("uuid-1")
    assert fake.calls == 2, "a 200 with an unexpected shape must be retried, not trusted"
    assert got is not None and got.get("subtype") == "سنوي"


def test_unparseable_200_body_is_retried(monkeypatch):
    fake = _install(monkeypatch, [
        _Resp(200, raise_json=True),
        _Resp(200, GOOD_DETAIL),
    ])
    got = aq.fetch_detail("uuid-1")
    assert fake.calls == 2, "an unparseable 200 must be retried, not treated as authoritative"
    assert got is not None and got.get("subtype") == "سنوي"


def test_transient_5xx_is_retried(monkeypatch):
    fake = _install(monkeypatch, [_Resp(503), _Resp(200, GOOD_DETAIL)])
    assert aq.fetch_detail("uuid-1") is not None
    assert fake.calls == 2


def test_exhausted_retries_return_none_rather_than_a_partial_guess(monkeypatch):
    fake = _install(monkeypatch, [_Resp(200, {"message": "blocked"})] * 3)
    assert aq.fetch_detail("uuid-1") is None
    assert fake.calls == 3, "bounded at 3 attempts — no unbounded retry storm against the source"


# ── A 404 is terminal: the ad is gone, and that is not a capture failure ─────────────────────────
def test_404_is_terminal_and_not_retried(monkeypatch):
    fake = _install(monkeypatch, [_Resp(404, {"message": "No query results for model [Ad]"})])
    assert aq.fetch_detail("gone") is None
    assert fake.calls == 1, "a 404 means the ad no longer exists; retrying it only wastes budget"


# ── Rule 2: a missing detail must NEVER manufacture a rent period ────────────────────────────────
def test_missing_detail_leaves_rent_period_null_never_annual():
    """The fix for rule 1 must not tempt anyone into defaulting the period. An unknown period is
    honest NULL; 'annual' on a monthly ad understates the rent 12x."""
    ad = {"id": "uuid-1", "type": "rent", "price": "85,000",
          "estate": {"area": 122, "category": "شقة", "city": "الرياض",
                     "address": "الرياض الملقا", "title": "شقة فاخرة"}}
    row, _cat, _sold = aq.map_listing(ad, None)
    assert row is not None, "a detail failure must not silently drop the listing entirely"
    assert row["rent_period"] is None, "never default a period the source did not state"


def test_published_subtype_is_captured_as_annual():
    """The positive control: when the source DOES publish «سنوي», we must store it — this is the
    half that was failing in production and left 8 rentals unreachable by either period chip."""
    ad = {"id": "uuid-1", "type": "rent", "price": "85,000",
          "estate": {"area": 122, "category": "شقة", "city": "الرياض",
                     "address": "الرياض الملقا", "title": "شقة فاخرة"}}
    row, _cat, _sold = aq.map_listing(ad, {"id": "uuid-1", "type": "rent", "subtype": "سنوي"})
    assert row is not None
    assert row["rent_period"] == "annual"


@pytest.mark.parametrize("subtype,expected", [
    ("سنوي", "annual"), ("شهري", "monthly"), ("يومي", "daily"),
    ("", None), (None, None), ("نصف سنوي", None), ("ربع سنوي", None),
])
def test_rent_period_mapping_is_exact(subtype, expected):
    """«نصف سنوي»/«ربع سنوي» must NOT collapse into annual — Ezhalah has no canonical chip for
    them, and mapping them to annual would misstate the rent."""
    assert aq._rent_period(subtype) == expected
