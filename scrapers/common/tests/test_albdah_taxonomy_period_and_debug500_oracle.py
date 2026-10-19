"""albdah's traps: the type lives ONLY on the site's own taxonomy pages, a monthly figure beside
«دفعة نصف سنوية» payment rows that are NOT the rent period, «مجدد» in the age slot, a town
to_catalog cannot place, a FAL licence that is not the ad licence, and a Django-DEBUG 500 that is
the removal oracle.

Fixtures are VERBATIM /property/<id>/details/ markup captured 2026-09-24 (ids 05WmN, 09zJt, 46XNr,
22UzT; trimmed to the blocks the code reads) plus the homepage counter line. Assertions run the
SHIPPING functions (run.parse_detail, run.map_listing, run.site_total, run._signal, run.main).
Offline: only to_catalog/find_district_in_text and db are stubbed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.albdah import run as R  # noqa: E402

HOME = '''<div class="hero-stats">
      <span><b class="num">10</b>عقار معروض</span>
</div><p class="sub"><span class="num">10</span> عقار متاح الآن في بريدة والقصيم.</p>
<a class="card" href="/property/05WmN/details/">x</a><a class="card" href="/property/22UzT/details/">y</a>'''

def _page(ref, h1, deal, loc, price, facts, rows, amen, desc, imgs):
    return f'''<div class="gal">
    <div class="main" onclick="lbOpen(0)">
      <img src="{imgs[0]}" alt="{h1}">
    </div>
    <div class="side">
    {''.join(f'<img src="{u}" alt="">' for u in imgs[1:])}
    </div>
  </div>
  <div class="layout">
    <div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <span class="bdg sale">{deal}</span>
        <span class="bdg">حصري</span>
      </div>
      <h1 style="font-size:clamp(22px,3vw,30px);color:var(--ink);line-height:1.45">{h1}</h1>
      <p class="loc" style="margin-top:10px;font-size:14.5px">
        {loc}
        <span class="s"></span><span class="ref">إعلان رقم {ref}</span>
        <span class="s"></span><span class="num">1,352</span> مشاهدة
      </p>
      <div class="facts">
        {''.join(f'<div class="fact"><svg viewBox="0 0 24 24"></svg><span class="v">{v}</span><span class="k">{k}</span></div>' for v, k in facts)}
      </div>
      <div class="sec-h" style="margin-top:8px"><h2>الوصف</h2><span class="line"></span></div>
      <div class="desc">{desc}</div>
      <div class="sec-h" style="margin-top:26px"><h2>المزايا</h2><span class="line"></span></div>
      <div class="amen">
        {''.join(f'<span>{a}</span>' for a in amen)}
      </div>
      <div class="box rows">
        {''.join(f'<div class="row"><span class="k">{k}</span><span class="v">{v}</span></div>' for k, v in rows)}
      </div>
      <div class="sec-h" style="margin-top:26px"><h2>فيديو العقار</h2><span class="line"></span></div>
      <video controls preload="metadata" playsinline class="vid">
        <source src="/media/rent/apartment/video/60af7363-4df4-4416-95e3-09400361aa38_OmYRhYf.mov">
      </video>
      <iframe src="https://maps.google.com/maps?q=26.362708297999486,43.929954213395916&z=15&output=embed"></iframe>
    </div>
    <aside class="side-box">
      <div class="box box-navy">
        <div class="price-big">
          {price}
        </div>
      </div>
    </aside>
  </div>'''

# 05WmN — furnished flat, «1,200 ﷼ / شهرياً», one payment row, «مجدد» age, «علوي» floor.
D_05WmN = _page("05WmN", "شقة مفروشة للإيجار في بريدة في حي المنتزة", "للإيجار",
                'بريدة\n        <span class="s"></span>حي المنتزة\n        <span class="s"></span>عزّاب',
                '<span class="num">1,200</span><span class="cur">﷼</span>\n          <span class="per">/ شهرياً</span>',
                [("100", "متر مربع"), ("1", "غرف نوم"), ("1", "صالات"), ("علوي", "الدور"), ("مجدد", "عمر العقار"), ("80", "عرض الشارع")],
                [("الماء", "متوفر"), ("الكهرباء", "متوفرة"), ("الصرف الصحي", "متوفر"), ("صفة المعلن", "مسوق"),
                 ("رخصة فال", '<span class="num">1200017006</span>'), ("تاريخ الإضافة", "2026/01/17"), ("دفعة شهرية", "متاح")],
                ["مكيفات"],
                '<p>شقه للإجار - حي مشعل </b></p>\n<ul>\n<li>غرفه  </b></li>\n<li>صالة </b> </li>\n<li>مطبخ  راكب </b></li>\n<li>شامل الاثاث  </b></li>\n</ul>\n',
                ["/media/property/images/IMG_7797.jpeg"])
# 09zJt — «20,000 ﷼ / سنوياً» with «دفعة نصف سنوية» AND «دفعة سنوية» payment rows: the period is the price's own token.
D_09zJt = _page("09zJt", "شقة للإيجار في بريدة في حي الروضة", "للإيجار",
                'بريدة\n        <span class="s"></span>حي الريان\n        <span class="s"></span>عوائل',
                '<span class="num">20,000</span><span class="cur">﷼</span>\n          <span class="per">/ سنوياً</span>',
                [("200", "متر مربع"), ("4", "غرف نوم"), ("1", "صالات"), ("3", "دورات مياه"), ("علوي", "الدور"), ("مجدد", "عمر العقار"), ("15", "عرض الشارع")],
                [("الماء", "متوفر"), ("الكهرباء", "متوفرة"), ("الصرف الصحي", "متوفر"), ("رخصة فال", '<span class="num">1200017006</span>'),
                 ("دفعة نصف سنوية", "متاح"), ("دفعة سنوية", "متاح")],
                ["مكيفات", "مدخل خاص"],
                '<p>دور علوي للإجار - حي الروضه</p><ul><li>4 غرف</li><li>صالة</li><li>مطبخ</li><li>3 دورات مياة</li><li>مدخل و سطح خاص</li></ul>',
                ["/media/property/images/IMG_5185.jpeg", "/media/property/images/IMG_5196.jpeg", "/media/property/images/IMG_5185.jpeg"])
# 46XNr — sale, no `per` span, «جديد» age, chips incl. مسبح/مفروش/مطبخ/ألعاب.
D_46XNr = _page("46XNr", "شاليه للبيع في بريدة في ضراس", "للبيع",
                'بريدة\n        <span class="s"></span>ضراس\n        <span class="s"></span>عزّاب',
                '<span class="num">320,000</span><span class="cur">﷼</span>',
                [("300", "متر مربع"), ("2", "غرف نوم"), ("1", "صالات"), ("3", "دورات مياه"), ("جديد", "عمر العقار"), ("15", "عرض الشارع")],
                [("الماء", "متوفر"), ("الكهرباء", "متوفرة"), ("الصرف الصحي", "متوفر"), ("رخصة فال", '<span class="num">1200017006</span>')],
                ["مسبح", "مفروش", "مطبخ", "ألعاب"],
                '<p>شاليه للبيع - حي البصر او ضراس</p><ul><li>ملحق غرفه نوم كامله</li><li>مسبح مستقل</li></ul>',
                ["/media/property/images/IMG_7851.jpeg"])
# 22UzT — land in «القرعاء» (loc prints ONLY the town), land rows الغرض/العرض/الطول.
D_22UzT = _page("22UzT", "أرض للبيع في القصيم في القرعاء", "للبيع", "القرعاء",
                '<span class="num">3,206,500</span><span class="cur">﷼</span>',
                [("58,300", "متر مربع"), ("30", "عرض الشارع")],
                [("العرض", "455 م"), ("الطول", "191 م"), ("الغرض", "تجاري وسكني"), ("الماء", "متوفر")],
                [], '<p>أرض خام تبعد 13 كيلو فقط عن قصر الرصافة</p>',
                ["/media/property/images/bb0cb37f-041c-486c-a3ac-cfa74ad98525.jpeg"])
GONE_500 = "<title>DoesNotExist at /property/ZZZZZ/details/</title><h1>DoesNotExist at /property/ZZZZZ/details/</h1>"


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda c, region_hint=None: (11, 4) if c == "بريدة" else (None, None))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: next((d for k, d in (("الصفراء", "حي الصفراء"), ("الريان", "حي الريان"), ("المنتزة", "حي منتزه"))
                                             if t and k in t), None))


def test_site_total_reads_the_counter_through_its_span():
    assert R.site_total(HOME) == 10
    assert R.site_total("<p>لا عقارات</p>") is None
    assert R._ids(HOME) == ["05WmN", "22UzT"]


def test_monthly_rent_is_x12_and_payment_rows_are_not_a_period():
    row, cat, why = R.map_listing("apartment", R.parse_detail(D_05WmN))
    assert why == "" and cat == "residential"
    assert row["ad_number"] == "BDH05WmN" and row["listing_url"] == "https://albdah.sa/property/05WmN/details/"
    assert row["rent_period"] == "monthly" and row["price_annual"] == 14400 and "price_total" not in row
    assert row["additional_info"]["payment_options"] == ["دفعة شهرية"]
    assert row["additional_info"]["source_price_raw"] == "1,200 ﷼ / شهرياً"
    # the age slot says «مجدد» (renovated) — not an age; the floor slot says «علوي» — not a number
    assert row["property_age"] is None and row["additional_info"]["property_age_raw"] == "مجدد"
    assert row["floor_number"] is None and row["additional_info"]["floor_label"] == "علوي"
    assert row["bedrooms"] == 1 and row["halls"] == 1 and row["bathrooms"] is None and row["street_width_m"] == 80
    assert row["area_m2"] == 100 and row["neighborhood"] == "حي المنتزة" and row["district_ar"] == "حي منتزه"
    assert row["additional_info"]["tenants"] == "عزّاب"


def test_annual_rent_beside_half_yearly_payment_rows_stays_annual():
    row, _, why = R.map_listing("apartment", R.parse_detail(D_09zJt))
    assert why == "" and row["rent_period"] == "annual" and row["price_annual"] == 20000
    assert row["additional_info"]["payment_options"] == ["دفعة نصف سنوية", "دفعة سنوية"]
    assert row["bathrooms"] == 3 and row["bedrooms"] == 4
    assert row["private_entrance"] is True and row["air_conditioner"] is True
    # a gallery file repeated on the page is one photo
    assert row["photo_urls"] == ["https://albdah.sa/media/property/images/IMG_5185.jpeg",
                                 "https://albdah.sa/media/property/images/IMG_5196.jpeg"]


def test_sale_has_no_period_and_type_comes_from_the_taxonomy_slug():
    row, cat, why = R.map_listing("chalet", R.parse_detail(D_46XNr))
    assert why == "" and row["property_type"] == "Chalet" and cat == "residential"
    assert row["price_total"] == 320000 and "rent_period" not in row and "price_annual" not in row
    assert row["property_age"] == 0                      # «جديد» is a lexical 0
    assert row["furnished"] is True and row["kitchen"] is True
    assert "elevator" not in row                         # silent → NULL, never False
    assert row["additional_info"]["amenity_chips"] == ["مسبح", "مفروش", "مطبخ", "ألعاب"]
    assert row["district_ar"] is None and row["neighborhood"] == "ضراس"


def test_fal_licence_is_never_the_ad_licence_and_utilities_are_tri_state():
    row, _, _ = R.map_listing("apartment", R.parse_detail(D_05WmN))
    assert row["license_number"] is None and row["additional_info"]["fal_licence"] == "1200017006"
    assert row["water_supply"] is True and row["electricity"] is True and row["sanitation"] is True
    page = D_05WmN.replace('<span class="k">الماء</span><span class="v">متوفر</span>',
                           '<span class="k">الماء</span><span class="v">غير متوفر</span>')
    assert R.map_listing("apartment", R.parse_detail(page))[0]["water_supply"] is False
    page = D_05WmN.replace('<div class="row"><span class="k">الماء</span><span class="v">متوفر</span></div>', "")
    assert "water_supply" not in R.map_listing("apartment", R.parse_detail(page))[0]


def test_office_sidebar_rows_never_overwrite_the_listings_own_facts():
    """Live 97AxA (2026-09-24) prints TWO «رخصة فال» rows: the listing's own inside
    `<div class="box rows">` (1100027006) and the office sidebar's identically-classed
    `<div class="row">` markup inside its own (unscoped) `<div class="rows">` box (1200017006).
    An unscoped rows regex let dict(rows) silently keep whichever came LAST in page order —
    the office's value, not the ad's — with no trace it had even happened."""
    office_box = '''
      <div class="box">
        <h3>مكتب البداح للعقارات</h3>
        <div class="rows">
          <div class="row"><span class="k">رخصة فال</span><span class="v"><span class="num">1200017006</span></span></div>
        </div>
      </div>'''
    page = D_05WmN.replace(
        '<span class="k">رخصة فال</span><span class="v"><span class="num">1200017006</span></span>',
        '<span class="k">رخصة فال</span><span class="v"><span class="num">1100027006</span></span>',
    ) + office_box
    d = R.parse_detail(page)
    assert dict(d["rows"])["رخصة فال"] == "1100027006"
    row, _, _ = R.map_listing("apartment", d)
    assert row["additional_info"]["fal_licence"] == "1100027006"


def test_unplaceable_town_unmapped_slug_and_auction_are_skipped_not_guessed():
    assert R.map_listing("land", R.parse_detail(D_22UzT))[2] == "city_not_in_catalog"
    assert R.map_listing("branch", R.parse_detail(D_05WmN))[2] == "type_unmapped_branch"
    assert R.map_listing("apartment", R.parse_detail(D_05WmN.replace("<h1", "<h1").replace(
        "شقة مفروشة للإيجار", "مزاد شقة مفروشة للإيجار")))[2] == "auction"
    assert R.map_listing("apartment", R.parse_detail(D_05WmN.replace("إعلان رقم 05WmN", "")))[2] == "no_id"


def test_pii_in_the_description_is_redacted():
    page = D_05WmN.replace("<li>شامل الاثاث  </b></li>", "<li>للتواصل 0565594599 او واتساب 0565594599</li>")
    row, _, _ = R.map_listing("apartment", R.parse_detail(page))
    assert "0565594599" not in json.dumps(row, ensure_ascii=False)
    assert "[redacted]" in row["description"]


def test_signal_only_a_django_debug_500_or_the_pages_own_ref_decides():
    assert R._signal(500, GONE_500, False) == "gone"
    assert R._signal(500, "<h1>Server Error (500)</h1>", False) is None      # DEBUG turned off → no opinion
    assert R._signal(200, D_05WmN, False) == "live"
    assert R._signal(200, "<html>maintenance</html>", False) is None
    assert R._signal(403, GONE_500, False) is None and R._signal(None, "", False) is None


def test_main_tallies_every_skip_and_requires_the_site_counter_to_prune(monkeypatch):
    calls: dict = {"batches": [], "prune": []}
    pages = {"05WmN": D_05WmN, "09zJt": D_09zJt, "46XNr": D_46XNr, "22UzT": D_22UzT, "AAAAA": D_05WmN}
    monkeypatch.setattr(sys, "argv", ["run.py"])
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_catalogue", lambda s: (
        {"05WmN": ["apartment"], "09zJt": ["apartment"], "46XNr": ["chalet"], "22UzT": ["land"], "AAAAA": ["branch"]},
        5, ["05WmN", "09zJt", "46XNr", "22UzT", "AAAAA"]))
    monkeypatch.setattr(R, "fetch_detail", lambda s, oid: R.parse_detail(pages[oid]))
    monkeypatch.setattr(R.db, "begin_run", lambda platform: 7)
    monkeypatch.setattr(R.db, "_wasalt_batch", lambda tbl, rows: calls["batches"].append((tbl, [r["ad_number"] for r in rows])))
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **kw: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, source, **kw: calls["prune"].append(tbl) or 0)
    monkeypatch.setattr(R.db, "end_run", lambda run_id, **kw: calls.update(end=kw) or True)
    assert R.main() == 0
    assert calls["batches"][0] == ("albdah_residential_listings", ["BDH05WmN", "BDH09zJt", "BDH46XNr"])
    assert calls["end"]["rows_seen"] == 5 and calls["end"]["rows_upserted"] == 3
    assert "city_not_in_catalogx1" in calls["end"]["notes"] and "type_unmapped_branchx1" in calls["end"]["notes"]
    assert "complete=True" in calls["end"]["notes"] and calls["prune"] == ["albdah_residential_listings", "albdah_commercial_listings"]
    assert calls["end"]["check_tables"] == ["albdah_residential_listings", "albdah_commercial_listings"]
    # the site says 10 but the type pages listed 5 → incomplete → NO prune
    calls["prune"].clear()
    monkeypatch.setattr(R, "fetch_catalogue", lambda s: (
        {"05WmN": ["apartment"], "09zJt": ["apartment"], "46XNr": ["chalet"], "22UzT": ["land"], "AAAAA": ["branch"]},
        10, ["05WmN"]))
    assert R.main() == 0 and calls["prune"] == [] and "complete=False" in calls["end"]["notes"]


def test_a_complete_positive_controlled_catalogue_is_the_second_death_limb(monkeypatch):
    """The law holds the measured Django DEBUG 500 as UNKNOWN; a removal is certified only when
    THIS run's complete catalogue no longer lists the id AND the in-run control reads live."""
    from scrapers.common import http_liveness as L
    monkeypatch.setattr(L.time, "sleep", lambda s: None)
    monkeypatch.setattr(R, "session", lambda: object())
    served = {"/property/05WmN/details/": (200, D_05WmN, False), "/property/9/details/": (500, GONE_500, False)}
    monkeypatch.setattr(L.LivenessProbe, "fetch", lambda self, url: served[url[len(R.BASE):]])
    control = {"ad_number": "BDH05WmN"}
    assert R._make_verify_gone(control, frozenset({"05WmN"}), True)("BDH9")[0] == "gone"
    assert R._make_verify_gone(control, frozenset({"05WmN", "9"}), True)("BDH9")[0] == "unknown"   # still listed
    assert R._make_verify_gone(control, frozenset({"05WmN"}), False)("BDH9")[0] == "unknown"       # incomplete run
    assert R._make_verify_gone(None, frozenset({"05WmN"}), True)("BDH9")[0] == "unknown"           # no control → closed
    assert R._make_verify_gone(control, frozenset({"05WmN"}), True)("BDH05WmN")[0] == "live"
