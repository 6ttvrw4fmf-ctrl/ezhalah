"""KSA Aqar: an ad whose own title places it abroad is not only skipped — its STORED row is retired,
with an evidence row naming the place word.

THE GAP THIS PINS (2026-09-28). PR #5205 made the scraper skip abroad ads, but nothing retired the 11
rows stored before the skip (Cairo, Dubai, Marrakech, Aqaba, Aswan…): they stayed active and
searchable as Riyadh / Makkah / Abha listings. The removal step (#5608) cannot either — it hides only
an ad whose own page is gone, and these pages still render. The run now pins them through the shared evidenced pin,
as eastabha's country gate does. The evidence note carries the place word only — one of these
titles is a phone number («… في الأردن للبيع هاتف 00962…»), and the ledger must not copy it.

Run: python -m pytest scrapers/common/tests/test_ksaaqar_retires_its_stored_abroad_rows.py -q
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Hermetic: db.py must import with no credentials and no network.
_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

import scrapers.ksaaqar.run as K  # noqa: E402

ABROAD = {"id": 7, "slug": "jordan", "link": "https://ksaaqar.com/ad/jordan/",
          "title": {"rendered": "عقارات فلل قصور مزارع اراضي في الأردن للبيع هاتف 00962788170529"},
          "content": {"rendered": ""}}
SAUDI = {"id": 8, "slug": "riyadh", "link": "https://ksaaqar.com/ad/riyadh/",
         "title": {"rendered": "مقاول بناء في الرياض"}, "content": {"rendered": ""}}


def test_a_run_retires_the_stored_rows_its_own_titles_place_abroad(monkeypatch):
    pins: list[tuple] = []

    class _Q:
        def __getattr__(self, name):
            return lambda *a, **k: self

    stored_active = {"ksaaqar_residential_listings": [K.ad_number(ABROAD)],
                     "ksaaqar_commercial_listings": []}
    last_table: list[str] = []
    monkeypatch.setattr(K.db, "sb", lambda: type("C", (), {
        "table": lambda self, t: last_table.append(t) or _Q()})())
    monkeypatch.setattr(K.db, "_execute", lambda q, what="": type("Res", (), {
        "data": [{"ad_number": a} for a in stored_active.get(last_table[-1], [])]})())
    monkeypatch.setattr(K.sold_pin, "pin_source_confirmed_gone",
                        lambda table, ads, **kw: pins.append((table, list(ads), kw)) or list(ads))
    monkeypatch.setattr(K, "fetch_listings", lambda s, limit=0: [ABROAD, SAUDI])
    monkeypatch.setattr(K, "fetch_detail", lambda s, link: "<html><body>page</body></html>")
    monkeypatch.setattr(K.db, "begin_run", lambda platform: 1)
    monkeypatch.setattr(K.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(K.db, "end_run", lambda *a, **kw: True)
    monkeypatch.setattr(sys, "argv", ["run"])

    assert K.main() == 0

    retired = {t: ads for t, ads, _ in pins if ads}
    assert retired == {"ksaaqar_residential_listings": [K.ad_number(ABROAD)]}
    (_t, _ads, kw), = [p for p in pins if p[1]]
    assert kw["oracle"] == "ksaaqar.abroad_gate.title"
    note = kw["notes"][K.ad_number(ABROAD)]
    assert "الأردن" in note
    assert "00962" not in note, "the evidence ledger must never copy a phone number out of a title"
