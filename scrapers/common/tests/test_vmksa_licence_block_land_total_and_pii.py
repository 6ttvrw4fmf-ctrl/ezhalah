"""vm-ksa: the traps measured at onboarding (2026-09-26), each on the REAL scraper functions.

  · RSC text rows `<id>:T<hexlen>,<text>` carry NO newline — a line reader never resolves them.
  · For LAND the headline price is PER m²; the licence states the total, and that total is stored.
  · The licence block names the ad officer and his mobile — never stored anywhere.
  · The category bucket may contradict the deal; the enum + licence purpose decide, a conflict skips.
"""
import json

import pytest

import scrapers.vmksa.run as R


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (15, 4) if c else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: "حي النور" if t else None)


def _opt(i, name, value):
    return f'{i}:' + json.dumps({"id": i, "option": name, "selected_value": value}, ensure_ascii=False, separators=(",", ":")) + "\n"


def _flight(desc: str, options: dict[str, str], ad: dict) -> str:
    rows, ptrs = "", []
    for n, (k, v) in enumerate(options.items(), start=0x50):
        rows += _opt(n, k, v).replace(f"{n}:", f"{n:x}:", 1)
        ptrs.append(f"${n:x}")
    body = desc.encode()
    rows += "40:" + json.dumps(ptrs) + "\n"
    rows += f"37:T{len(body):x}," + desc           # a TEXT row: no newline after it
    rows += '38:{"name":"جدة"}\n'
    return rows + json.dumps(ad, ensure_ascii=False, separators=(",", ":"))   # RSC is compact JSON


def _ad(**kw):
    ad = {"id": 844, "title": "أرض للبيع", "description": "$37", "options": "$40", "city": "$38",
          "price": "SAR 1,550.00", "price_without_format": "1550", "property_type_enum": "sale",
          "images_ads": ["https://x/1.jpg"]}
    ad.update(kw)
    return ad


LAND = {"نوع العقار": "ارض", "غرض الاعلان": "بيع", "مساحة العقار": "600",
        "أجمالي سعر بيع الأرض": "930000", "مسؤول الاعلان": "سلطان عبد الله",
        "رقم مسؤول الاعلان": "0592431010", "رقم صك الملكية": "20895740573"}


def test_a_text_row_without_a_newline_resolves():
    raw = _flight("وصف طويل\nبسطرين", LAND, _ad())
    rows = R.rows_of(raw)
    assert rows["37"] == "وصف طويل\nبسطرين"
    assert rows["38"] == {"name": "جدة"}                 # the row AFTER the text row still parses


def test_land_stores_the_licence_total_not_the_per_metre_headline():
    raw = _flight("أرض", LAND, _ad())
    (row, _), why = R.map_ad(R.main_ad(raw, 844), R.rows_of(raw))
    assert why == ""
    assert row["price_total"] == 930000 and row["price_per_meter"] == 1550


def test_the_ad_officer_and_deed_are_never_stored():
    raw = _flight("أرض", LAND, _ad())
    (row, _), _ = R.map_ad(R.main_ad(raw, 844), R.rows_of(raw))
    blob = json.dumps(row, ensure_ascii=False, default=str)
    for secret in ("سلطان عبد الله", "0592431010", "20895740573"):
        assert secret not in blob


def test_a_deal_conflict_between_enum_and_licence_is_skipped():
    opts = dict(LAND, **{"غرض الاعلان": "إيجار"})
    raw = _flight("أرض", opts, _ad())
    got, why = R.map_ad(R.main_ad(raw, 844), R.rows_of(raw))
    assert got is None and why.startswith("deal_conflict")
