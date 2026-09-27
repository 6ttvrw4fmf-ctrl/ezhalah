"""Nawafeth (نوافذ الوطن): the owner's two rules (2026-09-26) and the page traps, on the REAL scraper.

  · «سعر الوحدة» on a plot is a PER-m² rate → price_per_meter, price_total NULL (never ppm × area);
    on every other type it is the total. A plot figure above 50,000/m² is not stored at all.
  · the deal is ONLY the title's sale/rent word; neither or both → skipped. «الربيع» is not «بيع».
  · «عدد الغرف» is total rooms — never bedrooms.
  · a page without the licence block is not a listing, whatever its HTTP status.
  · the responsible employee's name and mobile never reach the row.
"""
import json
from datetime import date

import pytest

import scrapers.nawafeth.run as R

TODAY = date(2026, 9, 26)
NAME, MOBILE = "ماجد علي هلال البعيجي", "0552410839"


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, r=None: (3, 1) if c == "الرياض" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text", lambda t, cid: None)


def _page(**kw):
    kv = {"عنوان الإعلان": "ارض للبيع بدخنه", "رقم ترخيص الإعلان": "7100294956",
          "تاريخ انتهاء رخصة الاعلان": "2027-01-23", "المدينة": "الرياض", "الحي": "حي القدس",
          "نوع العقار": "ارض", "سعر الوحدة": "120 ر.س", "مساحة العقار": "210", "عدد الغرف": "0",
          "اسم الموظف المسؤول عن الاعلان": NAME, "رقم الموظف المسؤول عن الاعلان": MOBILE}
    kv.update(kw)
    body = "".join(f'<p>{k}: <span class="text-primary">{v}</span></p>' for k, v in kv.items())
    return f'<p>الإسم: {NAME}</p>{body}'


def _map(**kw):
    return R.map_listing(156, _page(**kw), TODAY)


def test_land_price_is_per_metre_and_no_total_is_made():
    (row, _), why = _map()
    assert why == "" and row["price_per_meter"] == 120 and row["price_total"] is None
    assert row["price_evidence"]["unit"] == "per_meter"


def test_a_built_unit_price_is_the_total():
    (row, _), _ = _map(**{"نوع العقار": "فيلا", "سعر الوحدة": "5500000 ر.س",
                          "عنوان الإعلان": "فيلا للبيع", "عدد الغرف": "7"})
    assert row["price_total"] == 5500000 and row["price_per_meter"] is None


def test_an_implausible_land_rate_is_skipped_not_stored():
    got, why = _map(**{"سعر الوحدة": "141750 ر.س"})
    assert got is None and why == "land_price_ambiguous"


@pytest.mark.parametrize("title,deal", [
    ("ارض للبيع بدخنه", "Buy"), ("مكاتب للايجار - العارض", "Rent"), ("شقة للإيجار", "Rent")])
def test_the_deal_is_the_titles_one_word(title, deal):
    (row, _), _ = _map(**{"عنوان الإعلان": title, "نوع العقار": "شقة", "سعر الوحدة": "1500 ر.س"})
    assert row["transaction_type"] == deal


@pytest.mark.parametrize("title", [
    "فيلا في الربيع ٥٠٠م بسعر ٥.٥٠٠.٠٠٠",                        # «الربيع» holds «بيع» — not a sale
    "ارض تجاريه للاستثمار بالفرسان بالدمام",
    "فيلا مساحتها 557م للبيع أو الاستئجار الاستثماري - الدمام"])   # both → not stated
def test_no_single_deal_in_the_title_is_skipped(title):
    got, why = _map(**{"عنوان الإعلان": title})
    assert got is None and why == "deal_not_stated"


def test_a_rent_with_no_stated_period_keeps_the_price_and_no_period():
    (row, _), _ = _map(**{"عنوان الإعلان": "مكاتب للايجار", "نوع العقار": "مكتب", "سعر الوحدة": "1500 ر.س"})
    assert row["rent_period"] is None and row["price_annual"] == 1500


def test_total_rooms_never_become_bedrooms():
    (row, _), _ = _map(**{"نوع العقار": "مكتب", "عنوان الإعلان": "مكاتب للايجار", "عدد الغرف": "150"})
    assert row["bedrooms"] is None and row["additional_info"]["total_rooms"] == 150


def test_a_page_without_the_licence_block_is_not_a_listing():
    assert R.map_listing(159, "<html><body><h1>200 OK, nothing here</h1></body></html>", TODAY) \
        == (None, "not_a_listing")


def test_an_expired_licence_is_excluded():
    assert _map(**{"تاريخ انتهاء رخصة الاعلان": "25/06/2026"}) == (None, "licence_expired")


def test_the_employee_name_and_mobile_never_reach_the_row():
    (row, _), _ = _map()
    dump = json.dumps(row, ensure_ascii=False)
    assert NAME not in dump and MOBILE not in dump and "البعيجي" not in dump
