"""aqar's REGA advertisement licence comes from its own payload field `listing.ad_license_number`.

Blind spot 1356 (2026-11-06): 0 of 999 aqar arrivals in 24 h served a licence while Deal App and Property
Finder served 100 %. The page's licence block is rendered client-side, so the stored visible text never held
it, and the parse trigger read it only from that text. A CI re-read of the real pages (run 42298616610)
printed the field: 96046 → 7200958887, 102675 → 7200887930 (the seller's own text on 102675 states the same
number). The scraper now reads that field verbatim, writes it to `license_number` and to
`source_capture.ad_license_number` (which trg_aqar_parse reads first), and the upsert copies it into
`additional_info.rega_ad_license_number`, the card's «رقم رخصة الإعلان».

Run: python -m pytest scrapers/common/tests/test_aqar_ad_licence_from_payload.py -v
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import scrapers.aqar.enrich_residential as E  # noqa: E402  -- the REAL module, never a copy
from scrapers.common import db  # noqa: E402

URL = "https://sa.aqar.fm/أراضي-للبيع/الدمام/حي-المنتزه/x-6698125"


class _Resp:
    def __init__(self, text): self.text = text


def _page(listing: dict) -> str:
    inner = json.dumps({"listing": listing}, ensure_ascii=False)
    blob = f"<script>self.__next_f.push([1,{json.dumps(inner, ensure_ascii=False)}])</script>"
    return ("<html><body><div>أرض للبيع 2,100,360 §</div><div>تفاصيل الإعلان المساحة 690 م²</div>"
            f"{blob}</body></html>")


def _run(listing, monkeypatch):
    monkeypatch.setattr(E, "get", lambda *a, **k: _Resp(_page(listing)))
    return E.enrich_residential(URL, type_slug="land", deal_slug="sale")


BASE = {"id": 6698125, "price": 2100360, "published": True, "location": {"lat": 26.43, "lng": 50.05}}


def test_payload_licence_is_stored_and_reaches_the_card(monkeypatch):
    row = _run({**BASE, "ad_license_number": "7200958887", "rega_licensed": True}, monkeypatch)
    assert row["license_number"] == "7200958887", "the payload's REGA ad licence was not captured"
    assert row["source_capture"]["ad_license_number"] == "7200958887", "trg_aqar_parse cannot keep it"
    db._unknown_must_not_overwrite_known(row)
    db._licence_on_card(row)
    assert row["additional_info"]["rega_ad_license_number"] == "7200958887", "the card would not show it"
    assert row["additional_info"]["latitude"] == 26.43, "the stored pin must survive"


def test_a_numeric_licence_is_kept_verbatim(monkeypatch):
    row = _run({**BASE, "ad_license_number": 7200887930}, monkeypatch)
    assert row["license_number"] == "7200887930"


def test_silent_or_malformed_licence_is_unknown_never_a_guess(monkeypatch):
    for bad in (None, "", "N/A", "12345", True, "72009588871"):
        row = _run({**BASE, "ad_license_number": bad}, monkeypatch)
        assert row["license_number"] is None, f"{bad!r} must stay unknown"
        assert "ad_license_number" not in row["source_capture"]
    row = _run(dict(BASE), monkeypatch)
    assert row["license_number"] is None
