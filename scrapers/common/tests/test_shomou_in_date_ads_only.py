"""Shomou: only an ad inside its OWN end date is a listing; the price is the one its label names (per-m²
never becomes a total, «على السوم» is not a figure); the page's related-listings table is never read."""
import datetime
import json

import pytest

import scrapers.shomou.run as R

T = datetime.date(2026, 9, 28)


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (3677, 5) if c else (None, None))
    monkeypatch.setattr(R, "resolve_district", lambda t: {"المشرفة": "حي مشرفة"}.get(t))


def _page(nid="8395", end="2026-12-26", deal="للايجار", typ="شقة", cls="سكنية", label="السعر", price="14000"):
    return f'''<div class="alert alert-info">إعلان {nid} - 27/09/2026<br>رقم الترخيص: 2100000432<br>
    رقم رخصة فال 1200008944<br>someone@hotmail.com البريد الإلكتروني</div>
    <article data-history-node-id="{nid}" role="article"><span property="schema:name" content="{typ} {cls} {deal} في المشرفة" class="hidden"></span>
    <div class="text-right h1">{typ}</div>
    <div class="text-right h1">{cls}</div>
    <div class="text-right h1">{deal}</div>
    <div class="text-right h1">المنطقة: الشرقية</div>
    <div class="text-right h1">المحافظة: الأحساء</div>
    <div class="text-right h1">في المشرفة</div>
    <div class="text-right h1">المساحة 111 م</div>
    <div class="text-right h1">واجهة العقار: شرق</div>
    <div class="text-right h1">الخدمات المتعلقة بالعقار: كهرباء وماء</div>
    <div class="text-right h2">الدور الثاني</div>
    <div class="text-right h2">فوق مكتبة الفرزدق بالدور الثاني ثلاث غرف ومجلس للتواصل 0553928287</div>
    <div class="text-right h2">{label}</div>
    <div content="{price}" class="text-right h2">{price} ريال</div>
    <div class="text-right h1"><div>تاريخ إنتهاء الإعلان</div><div><time datetime="{end}T12:00:00Z">{end}</time></div></div>
    </article>
    <table><tr><td>السعر 22,000</td><td>المساحة 592م</td></tr></table>'''


def _map(**kw):
    return R.map_detail(R.parse_detail(kw.pop("nid", "8395"), _page(**kw)), T)


def test_an_in_date_rent_keeps_its_price_and_no_invented_period():
    row, cat, why = _map()
    assert why == "" and cat == "residential" and row["transaction_type"] == "Rent"
    assert (row["price_annual"], row["rent_period"], row["price_total"]) == (14000, None, None)
    assert row["district_ar"] == "حي مشرفة" and row["area_m2"] == 111 and row["direction"] == "شرق"
    assert row["electricity"] is True and row["water_supply"] is True and row["license_number"] is None


def test_an_ad_past_its_own_end_date_or_with_an_unreadable_one_is_never_a_listing():
    assert _map(end="2026-09-27")[2] == "ad_end_date_expired"
    assert _map(end="1433-02-11")[2] == "ad_end_date_unknown"


def test_the_label_decides_the_price_column():
    row, _, _ = _map(deal="للبيع", typ="أرض", label="المتر", price="1650")
    assert (row["price_per_meter"], row["price_total"]) == (1650, None)          # never × area
    row, _, _ = _map(deal="للبيع", label="على السوم", price="1")
    assert (row["price_total"], row["price_per_meter"]) == (None, None)          # a bid invitation, not 1 SAR
    row, _, _ = _map(deal="للبيع", typ="بيت", label="السعر", price="900000")
    assert row["price_total"] == 900000


def test_no_deal_word_is_skipped_and_a_foreign_node_is_refused():
    assert _map(deal="جاهز")[2] == "no_deal_stated"
    assert R.parse_detail("9999", _page(nid="8395")) is None


def test_the_related_table_and_the_page_chrome_never_reach_the_row():
    row, _, _ = _map()
    blob = json.dumps(row, ensure_ascii=False)
    assert "22,000" not in blob and "592" not in blob
    assert "0553928287" not in blob and "hotmail" not in blob


# ── amenities from the ad's own description, yes or nothing (🔬 AF engineer, 2026-10-08) ─────────
def test_the_description_states_a_kitchen_and_a_negation_is_not_a_no(monkeypatch):
    page = _page().replace("ثلاث غرف ومجلس للتواصل", "ثلاث غرف ومجلس ومطبخ راكب لا يوجد مصعد للتواصل")
    row, _cat, _why = R.map_detail(R.parse_detail("8395", page), T)
    assert row["kitchen"] is True
    assert row.get("elevator") is None, "prose never says no (SOURCE_TRUTH §2)"


def test_no_amenity_words_write_nothing():
    row, _cat, _why = _map()
    assert "kitchen" not in row and "elevator" not in row
