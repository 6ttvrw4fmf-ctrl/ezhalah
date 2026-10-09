"""abralosol: an ad in المبرز is served under المبرز, not under the office's default الهفوف.

Measured 2026-10-09 (QA, backlog 206): every abralosol ad outside Dammam/Khobar was booked as
«Hofuf». ~330 active ads sit in المبرز neighbourhoods (جوهرة الهادي 61, الغسانية ٢ 52, الجابرية 39,
الراجحي 38, …): a customer searching المبرز never found them and their districts never resolved,
because the catalog attests those names only in المبرز. Every text below is copied verbatim from a
live ad body on 2026-10-09; every assertion runs the SHIPPING `run._city`.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.abralosol import run as R  # noqa: E402


def test_ad_text_naming_mubarraz_wins():
    t = "🟨 المساحة 217 م بيت عربي في المبرز حي الحزم خلف شارع الموسى"
    assert R._city("الحزم", t)[::2] == ("Mubarraz", "ad_text")
    t2 = "📍 أرض مميزة للبيع – حي الغسانية ٢، المبرز – الأحساء"
    assert R._city("الغسانية ٢", t2)[0] == "Mubarraz"


def test_evidenced_mubarraz_district_without_text():
    city, region, basis = R._city("الغسانية ٢", "أرض للبيع رقم 195")
    assert (city, region, basis) == ("Mubarraz", "Eastern Province", "district_mubarraz")
    assert R._city("جوهرة الهادي", None)[0] == "Mubarraz"
    assert R._city("حي الراجحي", "")[0] == "Mubarraz"


def test_hofuf_stays_hofuf():
    # ضاحية هجر is a Hofuf suburb: 0 of 146 ads name المبرز.
    assert R._city("ضاحية هجر", "أرض سكنية للبيع")[::2] == ("Hofuf", "office_default")
    # A single-confirmation name is NOT promoted.
    assert R._city("المصطفى", "للبيع")[0] == "Hofuf"
    # An ad naming both cities is ambiguous: office default, never a guess.
    assert R._city("المحدود", "بين الهفوف و المبرز")[0] == "Hofuf"


def test_district_token_still_first():
    assert R._city("الخبر الشمالية", "المبرز")[0] == "Khobar"


def test_mutation_without_mubarraz_bases_falls_back_to_hofuf(monkeypatch):
    # Proves the tests above can fail: with the المبرز bases removed, the evidenced district is
    # booked as Hofuf again — the defect this file exists for.
    monkeypatch.setattr(R, "MUBARRAZ_DISTRICTS", frozenset())
    assert R._city("الغسانية ٢", "أرض للبيع")[0] == "Hofuf"
