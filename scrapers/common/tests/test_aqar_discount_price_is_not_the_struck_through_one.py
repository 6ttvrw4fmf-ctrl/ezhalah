"""On a DISCOUNTED aqar listing the prose scan returns the struck-through price. The payload wins.

aqar renders a discounted Buy listing as

    … إعجاب  60,000,000 §   45,000,000 §   خصم 25 %

— the original first, the real asking price second, then the discount badge. Every price pattern in
enrich_residential is first-match-wins over that text, so prose yields the PRE-DISCOUNT number. No
aqar code recognises «خصم» at all; the RSC payload is the only thing that carries the real figure.

Until 2026-09-19 the Buy prose block ran unconditionally, AFTER the structured read, so it
overwrote the payload and the listing was stored 33% too expensive. Measured live that day on a
12-row random sample of active rows: ads 6708444 (payload 45,000,000, prose 60,000,000, «خصم 25 %»)
and 6674913 (1,200,000 vs 1,250,000, «خصم 4 %») — 2 of 12, both returned struck-through by
enrich_residential. The sibling enricher scrapers/aqar/enrich.py never had the bug: its
`if price is None:` at line 135 has always made prose the fallback. This makes the two agree.

Run: python -m pytest scrapers/common/tests/test_aqar_discount_price_is_not_the_struck_through_one.py -v
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.aqar.enrich_residential as E  # noqa: E402  -- the REAL module, never a copy

URL = "https://sa.aqar.fm/عمائر-للبيع/مكة-المكرمة/حي-الهجرة/x-6708444"
CHROME = "الإعلانات المشاريع الحجوزات الرئيسية عمائر للبيع الصور ( 17 ) مشاركة حفظ إعجاب "
# The exact rendering that causes it: struck-through original, then the real price, then the badge.
DISCOUNT_SLOT = "60,000,000 § 45,000,000 § خصم 25 %"


class _Resp:
    def __init__(self, text): self.text = text


def _page(slot: str, rsc: dict | None = None) -> str:
    blob = ""
    if rsc is not None:
        inner = json.dumps(rsc, ensure_ascii=False)
        blob = f"<script>self.__next_f.push([1,{json.dumps(inner, ensure_ascii=False)}])</script>"
    return (f"<html><body><div>{CHROME}</div><div>{slot}</div>"
            f"<div>تفاصيل الإعلان المساحة 2300 م²</div>{blob}</body></html>")


def _run(html, monkeypatch, slug="building"):
    monkeypatch.setattr(E, "get", lambda *a, **k: _Resp(html))
    return E.enrich_residential(URL, type_slug=slug, deal_slug="sale")


def test_discounted_listing_stores_the_asking_price_not_the_struck_through_one(monkeypatch):
    rsc = {"listing": {"id": 6708444, "price": 45000000, "published": True}}
    row = _run(_page(DISCOUNT_SLOT, rsc), monkeypatch)
    assert row["price_total"] == 45000000, (
        "stored the pre-discount price — the Buy prose block is overriding the payload again"
    )
    assert row["price_total"] != 60000000


def test_the_prose_scan_really_would_pick_the_wrong_one(monkeypatch):
    """Negative control. Without this, the test above could pass because prose happens to agree.

    Strip the payload and prose is all that is left — it must yield the struck-through 60,000,000,
    which is exactly the number the fix exists to stop being stored.
    """
    row = _run(_page(DISCOUNT_SLOT), monkeypatch)
    assert row["price_total"] == 60000000, \
        "prose no longer picks the struck-through price — this test's premise moved"
    assert row["price_evidence"]["origin"] == "spec_table"


def test_prose_is_still_the_fallback_when_there_is_no_payload(monkeypatch):
    """The fix must not disable prose — only demote it."""
    row = _run(_page("1,750,000 §"), monkeypatch)
    assert row["price_total"] == 1750000
    assert row["price_evidence"]["origin"] == "spec_table"


def test_source_saying_there_is_NO_price_is_not_an_invitation_to_scan_prose(monkeypatch):
    """The other direction of "the payload is the last word".

    published:false is aqar stating the listing has no price («طلب تسويق»). Prose must not go
    hunting — a neighbouring card's figure is not this listing's price.

    ASSERTED VIA THE EVIDENCE, not via price_total, and that distinction is the whole test: the
    returned price_total is db.AUTHORITATIVE_NULL here regardless, so a value assertion passes even
    when prose DID run and the sentinel simply overwrote it afterwards. The first version of this
    test checked the value and the "forgot the not s_authoritative guard" mutant survived it. The
    evidence is what records whether the prose scan actually fired.
    """
    rsc = {"listing": {"id": 6708444, "price": None, "published": False}}
    row = _run(_page("60,000,000 §", rsc), monkeypatch)
    ev = row["price_evidence"]
    assert ev.get("authoritative_absent") is True, "aqar's 'no price' must be recorded as a fact"
    assert ev["raw"] is None, (
        f"prose scanned a page aqar says has no price — evidence carries {ev['raw']!r}"
    )
    assert ev["found"] is False, "found must be false when the source publishes no price"
