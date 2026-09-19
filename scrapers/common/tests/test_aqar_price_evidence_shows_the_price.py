"""aqar's price_evidence must show the PRICE — not the first 120 characters of the page.

Found 2026-09-19 while adjudicating a located_row_unreachable P1 on ad 6876143 (2,300,000,000 over
360 m²). The row's own stored evidence read:

    "raw": "فيلا للبيع في شارع الروابي... | تطبيق عقار الإعلانات المشاريع الحجوزات الخريطة إضا",
    "found": true, "origin": "spec_table", "stored": 2300000000

— the nav menu and the H1, containing no digits at all, while `found` said true. The price slot on
that page renders «2,300,000,000» and aqar's own JSON-LD carries offers.price=2300000000, so the
stored number was right; the EVIDENCE for it was worthless. That is worse than empty evidence,
because a later session reads `found:true` and believes the number was checked.

Two causes, both fixed in enrich_residential.py, both evidence-only (no parse, no price moved):
  1. `raw` was `price_text[:120]`, and price_text is the whole pre-«تفاصيل الإعلان» prefix — the
     comment 250 lines above the evidence block says so in as many words. Its first 120 chars are
     structurally always chrome; the price sits later. Now a window around the actual match.
  2. `origin` was hardcoded "spec_table" even when _structured_price() produced the number. Since
     2026-08-09 the RSC payload is the PRIMARY path, so the field named the wrong source on exactly
     the rows whose provenance was best.

Run: python -m pytest scrapers/common/tests/test_aqar_price_evidence_shows_the_price.py -v
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.aqar.enrich_residential as E  # noqa: E402  -- the REAL module, never a copy

URL = "https://sa.aqar.fm/فلل-للبيع/الدمام/حي-السيف/x-6876143"

# The shape that produced the bug: a long nav/H1 run BEFORE the price, exactly as aqar renders it.
CHROME = ("الإعلانات المشاريع الحجوزات بحث الكل شقق للإيجار أراضي للبيع فلل للبيع دور للإيجار "
          "فلل للإيجار شقق للبيع عمائر للبيع محلات للإيجار استراحة للبيع مكتب تجاري للإيجار "
          "الرئيسية فلل للبيع الدمام حي السيف فيلا للبيع في شارع الروابي, حي السيف, مدينة الدمام "
          "الصور مشاركة حفظ إعجاب ")


def _page(price_html: str, rsc: dict | None = None) -> str:
    blob = ""
    if rsc is not None:
        blob = f'<script>self.__next_f.push([1,{json.dumps(json.dumps(rsc), ensure_ascii=False)}])</script>'
    return (f"<html><body><div>{CHROME}</div><div>{price_html}</div>"
            f"<div>تفاصيل الإعلان المساحة 360 م²</div>{blob}</body></html>")


class _Resp:
    def __init__(self, text): self.text = text


def _run(monkey_html, monkeypatch):
    monkeypatch.setattr(E, "get", lambda *a, **k: _Resp(monkey_html))
    return E.enrich_residential(URL, type_slug="villa", deal_slug="sale")


def test_evidence_contains_the_price_digits_not_the_nav_menu(monkeypatch):
    row = _run(_page("2,300,000 §"), monkeypatch)
    ev = row["price_evidence"]
    assert row["price_total"] == 2300000, "parse behaviour must be unchanged by this fix"
    assert ev["raw"], "evidence must not be empty when a price was found"
    assert "2,300,000" in str(ev["raw"]), f"evidence does not show the price: {ev['raw']!r}"


def test_evidence_is_not_the_head_of_the_blob(monkeypatch):
    """The precise defect: a head slice of price_text is chrome, every time."""
    ev = _run(_page("2,300,000 §"), monkeypatch)["price_evidence"]
    assert "الإعلانات المشاريع" not in str(ev["raw"]), "evidence is still the nav menu"
    assert "الرئيسية" not in str(ev["raw"])


def test_found_is_never_true_without_digits(monkeypatch):
    """`found:true` is the part that makes bad evidence dangerous — it reads as proof."""
    ev = _run(_page("2,300,000 §"), monkeypatch)["price_evidence"]
    if ev["found"]:
        assert any(c.isdigit() for c in str(ev["raw"])), \
            f"found=true but the evidence carries no digits: {ev['raw']!r}"


def test_structured_payload_is_named_as_the_source_it_came_from(monkeypatch):
    """When the RSC payload is what SET the price, the evidence must say structured.

    Asserted unconditionally, deliberately: the first draft hedged with `if origin == "structured"
    … else …`, and the "origin is hardcoded again" mutant survived by taking the else branch. A
    test that accepts either answer tests nothing.

    The page carries NO «§» price in its prose, so the Buy prose scan finds nothing and the
    structured value is what stands — see the precedence note in the module docstring below.
    """
    rsc = {"listing": {"id": 6876143, "price": 2300000, "published": True}}
    row = _run(_page("السعر عند الطلب", rsc=rsc), monkeypatch)
    ev = row["price_evidence"]
    assert row["price_total"] == 2300000
    assert ev["origin"] == "structured", \
        f"RSC payload set the price but evidence says origin={ev['origin']!r}"
    assert ev["raw"] == row["price_total"], "structured evidence must BE the published number"
    assert "RSC" in (ev["field"] or ""), "field must name the payload, not the rendered slot"


def test_prose_fallback_still_says_spec_table(monkeypatch):
    """The other direction: with no readable payload, evidence must not claim structured."""
    ev = _run(_page("2,300,000 §"), monkeypatch)["price_evidence"]
    assert ev["origin"] == "spec_table"
    assert "2,300,000" in str(ev["raw"])


def test_evidence_names_whichever_path_actually_set_the_price(monkeypatch):
    """OBSERVED PRECEDENCE, recorded because the fix made it visible rather than causing it.

    For a Buy listing the prose scan runs OUTSIDE the `if s_authoritative:` branch, so when both a
    readable payload and a «N §» prose price exist, prose writes price_total last. The module's own
    comment says the payload should be "the last word in BOTH directions", so that is a real latent
    defect — but it is a PRICE-behaviour defect, out of scope for an evidence-only change, and
    fixing it here would move stored prices.

    What this pins is only the evidence contract: whatever path actually set the price is what the
    evidence must name. If someone later makes the payload win for Buy, this assertion flips to
    "structured" and should simply be updated — it is not an endorsement of the precedence.
    """
    rsc = {"listing": {"id": 6876143, "price": 9999999, "published": True}}
    row = _run(_page("2,300,000 §", rsc=rsc), monkeypatch)
    ev = row["price_evidence"]
    assert ev["stored"] == row["price_total"], "evidence must describe the price actually stored"
    if row["price_total"] == 2300000:          # prose won (today's behaviour)
        assert ev["origin"] == "spec_table" and "2,300,000" in str(ev["raw"])
    else:                                       # payload won (if the precedence is ever fixed)
        assert ev["origin"] == "structured" and ev["raw"] == row["price_total"]
