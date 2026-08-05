"""Regression tests for the 2026-08-03 senior-audit fix: the shared upsert path must NEVER hide a
listing because of its price.

Owner rule (2026-07-30, extreme-price verify-then-preserve, implemented for dealapp in PR#277): a
source-published price — however unrealistic — is stored EXACTLY and the row stays active; a price
is bug-class ONLY with pipeline proof that the source shows something different.

The defect this guards against: scrapers/common/db.py::_sanitize_price set active=False for
price_total>1B / price_per_meter>300k / price_annual>100M on EVERY upsert path (all platforms).
PR#277 removed the identical hide from dealapp/run.py but missed this shared clause, so the crawl
re-killed extreme-price rows that the guarded recovery job had just source-verified as live
(2026-08-03: 9 InStock dealapp rows killed 90 minutes after recovery — the standing "unpinned
killer" from senior audit run #2, now pinned here).

Run: python -m pytest scrapers/common/tests/test_sanitize_price_never_inactivates.py -v
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, ".")

from scrapers.common.db import _sanitize_price  # noqa: E402

DB_PY = (Path(__file__).resolve().parents[1] / "db.py").read_text(encoding="utf-8")


def _row(**over):
    base = {"ad_number": "T1", "active": True, "price_total": 500_000,
            "price_per_meter": 2_000, "price_annual": None}
    base.update(over)
    return base


def test_extreme_total_price_stays_active_and_exact():
    r = _row(price_total=196_000_000_000)  # the real 196B dealapp value killed on 2026-08-03
    _sanitize_price(r)
    assert r["active"] is True
    assert r["price_total"] == 196_000_000_000


def test_extreme_ppm_stays_active_and_exact():
    r = _row(price_per_meter=1_200_000)
    _sanitize_price(r)
    assert r["active"] is True
    assert r["price_per_meter"] == 1_200_000


def test_extreme_annual_stays_active_and_exact():
    r = _row(price_annual=3_550_000_000, price_total=None)
    _sanitize_price(r)
    assert r["active"] is True
    assert r["price_annual"] == 3_550_000_000


def test_normal_row_untouched():
    r = _row()
    before = dict(r)
    _sanitize_price(r)
    assert r == before


def test_no_price_based_inactivation_anywhere_in_db_py():
    # The whole class must stay dead: no CODE path in _sanitize_price may flip `active` based on a
    # price band. (String-level guard on top of the behavioral tests above; the docstring — which
    # narrates the removed clause — is stripped before matching.)
    body = DB_PY[DB_PY.index("def _sanitize_price"):]
    body = body[:body.index("\ndef ")]
    code = re.sub(r'"""[\s\S]*?"""', "", body)
    assert 'r["active"] = False' not in code
    assert re.search(r"active.{0,40}=\s*False", code) is None


if __name__ == "__main__":
    test_extreme_total_price_stays_active_and_exact()
    test_extreme_ppm_stays_active_and_exact()
    test_extreme_annual_stays_active_and_exact()
    test_normal_row_untouched()
    test_no_price_based_inactivation_anywhere_in_db_py()
    print("OK — shared upsert path never inactivates on price; source values preserved exactly")
