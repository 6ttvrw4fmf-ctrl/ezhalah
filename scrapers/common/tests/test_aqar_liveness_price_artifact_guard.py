"""aqar liveness PRICE REFRESH artifact guard (P1, 2026-08-11).

Root cause / evidence: the liveness price-refresh (owner-approved 2026-08-04) re-corrupted 5
already SQL-side-repaired rows during the 2026-08-11 01:00 UTC sweep — `price_from_body()` takes
the FIRST `"price":N` match in the raw page body, the same "first currency-marked number wins"
failure shape as the already-documented `aqar_parse()` bug (migrations 20260810122200 /
20260810202219). Live proof: ids 7026223 / 7032586 (an 11,000,000 SAR building served at its
2,690 SAR per-meter/financing-teaser figure) and 1015536 / 1017694 / 1019212 (price == area, the
same area-artifact class PR#440 had already NULLed) all show `last_seen_at` bumped to 2026-08-11
01:00 with the artifact price re-written, exactly matching that sweep's `scrape_runs.notes`
`price_updated` counts.

`is_price_refresh_artifact()` is a stopgap: it rejects a refreshed price that matches either
proven-live artifact signature (price == area, or price == price_per_meter) using only data the
sweep already holds in memory — no live page fetch needed to verify it (this sandbox got HTTP 403
fetching aqar.fm directly, so the regex's scoping itself could not be confirmed/fixed here; that
remains open for a session with real page access).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.aqar.liveness import is_price_refresh_artifact, price_from_body  # noqa: E402


def test_rejects_price_equal_to_area_m2():
    # id 1017694 live shape: refreshed price == area_m2 (3,000,000 == 3,000,000), no ppm signal.
    assert is_price_refresh_artifact(3_000_000, 3_000_000, None) is True


def test_rejects_price_equal_to_price_per_meter():
    # ids 7026223 / 7032586 live shape: refreshed price == price_per_meter (2,690 == 2,690),
    # while the page's real labeled total was 11,000,000.
    assert is_price_refresh_artifact(2690, 2091, 2690) is True
    assert is_price_refresh_artifact(2690, 2000, 2690) is True


def test_accepts_a_price_matching_neither_signature():
    # A normal, correct refresh: price differs from both area and ppm.
    assert is_price_refresh_artifact(11_000_000, 2091, 2690) is False


def test_accepts_when_area_or_ppm_are_unknown():
    # Rows missing area_m2/price_per_meter (NULL) must never be treated as a false match.
    assert is_price_refresh_artifact(850_000, None, None) is False


def test_price_from_body_still_reads_a_normal_labeled_price():
    # Guard rejects the VALUE, not the extraction — price_from_body itself is unchanged.
    assert price_from_body('<script>{"offers":{"price":850000}}</script>') == 850000
