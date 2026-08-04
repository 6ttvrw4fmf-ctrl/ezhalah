"""PRICE = SOURCE invariant — one pinned case per bug class found live on 2026-08-04.

Owner rule: «THE PRICE ON THE SOURCE WEBSITE = THE PRICE EZHALAH STORES.» Never calculate, infer,
normalize into a different economic value, or guess. A weird source price is not ours to correct;
a stored price that disagrees with the source IS our bug.

Every string below is the real shape from the listing that was repaired — not an invented sample.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.common import db, normalize  # noqa: E402


# ── Layer 1: evidence is captured, and is a witness only ─────────────────────────────────────────
def test_price_evidence_is_folded_into_capture_and_never_becomes_a_column():
    row = {
        "listing_url": "https://sa.aqar.fm/ad/1",
        "description": "شقة",
        "price_total": 440000,
        "price_evidence": normalize.price_evidence(
            field="price slot", raw="440,000 §", stored=440000, kind="total"),
    }
    db._ensure_capture(row)
    assert "price_evidence" not in row, "must not survive as a top-level key (there is no such column)"
    ev = row["source_capture"]["price_evidence"]
    assert ev["raw"] == "440,000 §" and ev["stored"] == 440000
    assert ev["found"] is True and ev["unit"] == "total"
    # The witness must not alter the price it describes.
    assert row["price_total"] == 440000


def test_price_evidence_records_absence_as_evidence():
    ev = normalize.price_evidence(field="offers.price", raw=None, stored=None)
    assert ev["found"] is False, "«the source showed no price» is itself evidence, not a missing key"


def test_price_evidence_refuses_prose_origin():
    # Layer 2 at the API level: a scraper cannot even DECLARE a prose price.
    try:
        normalize.price_evidence(field="description", raw="السعر 500000", origin="description")
    except ValueError as e:
        assert "banned" in str(e)
    else:
        raise AssertionError("origin='description' must raise")


def test_capture_without_evidence_still_works():
    # Scrapers not yet migrated must keep ingesting — evidence is additive, never a hard gate.
    row = {"listing_url": "https://x/1", "description": "بيت", "price_total": 1}
    db._ensure_capture(row)
    assert row["source_capture"] and "price_evidence" not in row["source_capture"]


# ── Layer 2/4: aqar's price scan must ignore prose numbers and per-metre rates ────────────────────
# The scan region (price_text) is rebuilt here exactly as enrich_residential builds it, so these
# assert the shipped strips — the ones that let 47 prose rows and 20 rate rows through until
# 2026-08-04.
def _strip(price_text: str) -> str:
    price_text = re.sub(r"ابتداء\S*\s*من\s*\d[\d,]*\s*[§ر﷼]?\s*شهري\w*", " ", price_text)
    price_text = re.sub(r"(?:سعر\s*)?(?:ال)?متر[\s:]{0,6}\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)", " ", price_text)
    price_text = re.sub(r"\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)\s*(?:لل|ال)?\s*متر", " ", price_text)
    price_text = re.sub(
        r"(?:الدخل|دخل|عائد|إيراد|ايراد|رهن|قسط|دفعة|تأمين|عربون|عمولة)"
        r"[^0-9\n]{0,25}\d[\d,]*(?:\.\d+)?\s*(?:§|ريال|﷼)?", " ", price_text)
    return price_text


def _first_total(price_text: str):
    """The shipped Buy scan, verbatim (enrich_residential.py)."""
    for pat in (r"(\d{1,3}(?:,\d{3}){2,3})\s*[§ر﷼]",
                r"(\d{1,3}(?:,\d{3}){1,3})\s*[§ر﷼]",
                r"(\d{6,9})\s*[§﷼]"):
        m = re.search(pat, price_text)
        if m:
            v = int(m.group(1).replace(",", ""))
            if v >= 50_000:
                return v
    return None


def test_rental_income_in_prose_is_not_the_sale_price():
    # aqar id 19010 — stored 67,500; the page price was 3,700,000.
    txt = "فيلا للبيع 3,700,000 § مؤجرة بالكامل الدخل السنوي ( 67,500 ريال )"
    assert _first_total(_strip(txt)) == 3_700_000
    # and with the price absent, the income must NOT become the price
    assert _first_total(_strip("فيلا للبيع مؤجرة الدخل السنوي ( 67,500 ريال )")) is None


def test_mortgage_amount_in_prose_is_not_the_sale_price():
    # aqar id 32000 — stored 70,000; the page price was 4,000,000.
    txt = "فيلا 4,000,000 § يوجد رهن بقيمة 70,000 ريال"
    assert _first_total(_strip(txt)) == 4_000_000


def test_total_rental_income_phrase_is_not_the_sale_price():
    # aqar id 21118 — stored 594,000; the page price was 6,500,000.
    txt = "عمارة 6,500,000 § مؤجر بالكامل بإجمالي دخل 594,000 ريال"
    assert _first_total(_strip(txt)) == 6_500_000


def test_per_metre_rate_never_becomes_the_total():
    # aqar id 52069 — stored 5,000 (the rate); the page total was 6,125,000.
    assert _first_total(_strip("أرض 6,125,000 § سعر المتر 5,000 ريال")) == 6_125_000
    # rate-only ad → honest None, never the rate promoted to a total
    assert _first_total(_strip("أرض للبيع سعر المتر 5,000 ريال")) is None
    assert _first_total(_strip("أرض للبيع 900 ريال للمتر")) is None


def test_a_real_price_still_parses_unharmed():
    # The strips must not eat ordinary listings — the regression risk of this change.
    assert _first_total(_strip("شقة للبيع 440,000 §")) == 440_000
    assert _first_total(_strip("فيلا 1,200,000 ريال")) == 1_200_000
    assert _first_total(_strip("أرض 34,500,000 § سعر المتر 11,500 ريال")) == 34_500_000


# ── Layer 3: the sanctioned annualization is the ONLY arithmetic allowed on a price ───────────────
def test_annualize_rent_is_the_only_sanctioned_price_arithmetic():
    assert normalize.annualize_rent(3500, "monthly") == 42000     # eastabha 595411 shape
    assert normalize.annualize_rent(150000, "annual") == 150000   # already annual → untouched
    assert normalize.annualize_rent(None, "monthly") is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("✓ PRICE = SOURCE invariant pinned (evidence, prose, per-metre, sanctioned arithmetic)")
