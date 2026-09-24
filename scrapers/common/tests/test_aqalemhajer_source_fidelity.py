"""مكتب أقاليم هجر (aqalemhajer.com) — the traps this Drupal/Views source sets, each pinned to a
measurement over the WHOLE catalogue (1,229 listings) on 2026-09-23.

Every fixture is markup copied VERBATIM from the live pages named in each test (index rows for nids
3817 / 5433 / 4891, whatsapp blocks for nids 3817 / 5351 / 5229 / 4178 / 3009, the themed 404 for
/3820), trimmed to the elements the code reads. Offline: no network; the ONLY stubs are the two
catalog helpers (to_catalog / find_district_in_text, seeded with a slice of the real Al-Ahsa
district catalog read through the public anon key on 2026-09-23) and, for the main() test, R.db.

Run: python -m pytest scrapers/common/tests/test_aqalemhajer_source_fidelity.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
# The REAL scrapers.common.db is imported (it needs no env until sb() is called); the main() test
# swaps it for a fake through monkeypatch. No sys.modules stub, so this file can never poison
# test_retire_superseded_siblings when it is collected first in the shared run.

import scrapers.common.arabic_location as _al  # noqa: E402
from scrapers.aqalemhajer import run as R  # noqa: E402

_HOFUF, _MUBARRAZ, _UYUN = 12, 2748, 2038
_AHSA, _EASTERN = 3677, 5
# Real rows of loc_catalog_district (anon-key read, 2026-09-23). «حي الرياض» under الهفوف is the
# point: the office's «مخطط الرياض» (64 rows) is THIS district, 400 km from the capital.
_CATALOG = {
    _HOFUF: ["حي الرياض", "حي الدانة", "حي المباركية", "حي الملك فهد", "حي النسيم", "حي الرابية"],
    _MUBARRAZ: ["حي الرابية", "حي النسيم"],
    _UYUN: ["حي الاسكان"],
    _AHSA: [],   # the governorate carries no districts — resolve_district() exists for this
}


@pytest.fixture(autouse=True)
def _seed_catalog(monkeypatch):
    monkeypatch.setitem(_al._CITY, "_stub_", [(1, 1)])
    for cid, districts in _CATALOG.items():
        monkeypatch.setitem(_al._DISTRICT_BY_CITY, cid,
                            {_al.norm_district_tok(d) for d in districts})
        for d in districts:
            monkeypatch.setitem(_al._DISTRICT_AR_BY_NORM, _al.norm_district_tok(d), d)
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: (
        (_AHSA, _EASTERN) if city_ar == R.OFFICE_CITY_AR else (None, None)))
    monkeypatch.setattr(R, "find_district_in_text", _al.find_district_in_text)
    monkeypatch.setattr(_al, "_load", lambda: None)


# ── VERBATIM markup (bytes from the live site; only the values vary) ────────────────────────────
_ROW = ('<tr>\n<td headers="view-field-als-r-table-column" class="views-field views-field-field-als-r '
        'views-align-center"><strong>\n                              {price}<br>\n\n\n\n'
        '<i class="fa fa-eye" aria-hidden="true"></i>\n{views}\n'
        '<a href="https://wa.me/?text=%20https://aqalemhajer.com/{nid}" target="_blank">'
        '<i class="fa fa-whatsapp text-success" title="مشاركة"></i></a>\n\n\n'
        '                            </strong>          </td>\n'
        '<td headers="view-nothing-1-table-column" class="views-field views-field-nothing-1 '
        'views-align-center"><strong>\n                              {area}\n\n'
        '                            </strong>          </td>\n'
        '<td headers="view-field-tags-table-column" class="views-field views-field-field-tags '
        'views-align-center"><strong>\n                                  {tags}<br>\n\n\n\n\n'
        '                            </strong>          </td>\n'
        '<td headers="view-nothing-table-column" class="views-field views-field-nothing '
        'views-align-center"><strong>\n                              <a href="/{nid}" target="_blank" '
        'hreflang="en">{typedeal}\n<i class="fa fa-external-link-square" aria-hidden="true"></i></a><br>\n\n'
        '<a href="/{nid}"><img src="{img}" width="60" height="50" class="img-rounded"></a><br>\n'
        '<div class="badge">{date}</div><br>\n{badge}\n'
        '                            </strong>          </td>\n              </tr>')


def _row(nid="3817", price="المتر\n1,000", area="المساحة\n455م\n\n<br>شارع\n15",
         tags="شرق شرق الحديقة", typedeal="أرض&nbsp;\n\n\nللبيع",
         img="/sites/default/files/2025-09/IMG_4897.jpeg", date="23/09/2026", views="49",
         badge=None):
    badge = f'<div class="badge by">اعلان {nid}</div>' if badge is None else badge
    return _ROW.format(nid=nid, price=price, area=area, tags=tags, typedeal=typedeal, img=img,
                       date=date, views=views, badge=badge)


_FIELD = '<div class="views-field views-field-field-{name}"><div class="field-content">{value}</div></div>'
_PAGE = ('<html><body><h1><span property="schema:name">{h1}</span>\n</h1>'
         '<article data-history-node-id="{nid}" role="article" class="node node--type-article">'
         '<div class="container-inline img-rounded text-center field field--name-field-image">'
         '{photos}</div></article>'
         '<div class="views-element-container h1 block block-views block-views-blockwhatsapp-block-1" '
         'id="block-views-block-whatsapp-block-1">\n      <div class="content">\n      <div><div class="rtl">'
         '\n      <div class="views-row">\n    <div class="views-field views-field-nid"><span class="field-content">'
         ' 🔔\nرقم الإعــلان:\n{nid}</span></div>{fields}'
         '<div class="views-field views-field-nid-1"><span class="field-content"> 🌐\nرابط الإعلان\n'
         'https://aqalemhajer.com/{nid}</span></div>'
         '<div class="views-field views-field-nothing"><span class="field-content"><div class="word-wrap">\n'
         '🏷️\nرخصة فال\n1200020821\n<br>\n☎️\nللتواصل والاستفسارات\n<br>\n *مكتب اقاليم هجر للخدمات العقارية* '
         '\n<br>\n0507130880\n<br>0502140063\n<br>===========<br><br></div></span></div>'
         '<div class="views-field views-field-field-sahb-al-qar"><strong class="field-content rtl text-danger">'
         'سعود العبدالله</strong></div>'
         '<div class="views-field views-field-field-mlahzat"><strong class="field-content rtl text-danger">'
         '{notes}</strong></div>\n  </div>\n</div>\n</div>\n    </div>\n  </div>\n'
         # The related-ads block: OTHER listings' prices. Nothing may ever be read out of it.
         '<div class="views-element-container hidden-print block block-views block-views-blockrelated-ads-block-1" '
         'id="block-views-block-related-ads-block-1"><table><tr><td class="views-field views-field-field-als-r">'
         '<strong>السعر\n9,999,999</strong></td><td class="views-field views-field-field-tags"><strong>'
         'الدانة</strong></td></tr></table></div></body></html>')
_PHOTO = ('<div class="field__item"><a class="lightbox" data-imagelightbox="g" href="{url}">'
          '<img class="imagelightbox" src="/sites/default/files/styles/large/public/x.jpeg?itok=2iVu1U21" '
          'width="650" height="400" alt="" typeof="foaf:Image" />\n </a></div>')


def _page(nid="3817", h1="أرض    للبيع في     شرق شرق الحديقة 103 أ  ", notes="", photos=None, **fields):
    """A detail page in the site's own shape; `fields` are (machine name → field-content text)."""
    fields = {"nw-al-qar": "📜\nأرض\nللبيع\nفي\n    شرق شرق الحديقة\n/\nأ",
              "almsaha": "▪\nالمساحة\n455\nم", "shar-rd": "▪\nشارع عرض\n15", "alwajht": "▪\nالواجهة\nغرب",
              "als-r": "💵\nالمتر\n1,000", **fields}
    fields = {k: v for k, v in fields.items() if v is not None}     # None = the page has no such field
    photos = ["https://aqalemhajer.com/sites/default/files/2025-09/IMG_4897.jpeg"] if photos is None else photos
    return _PAGE.format(nid=nid, h1=h1, notes=notes,
                        photos="".join(_PHOTO.format(url=u) for u in photos),
                        fields="".join(_FIELD.format(name=k, value=v) for k, v in fields.items()))


# The themed page the office serves for a deleted node — HTTP 404, no node id, no whatsapp block.
_DEAD_BODY = ('<html><head><title>عذرا ... تم بيع العقار أو تأجيرة | مكتب اقاليم هجر للخدمات العقارية'
              '</title></head><body><h1>عذرا ... تم بيع العقار أو تأجيرة</h1></body></html>')


_ROW_KEYS = {"nid", "price", "area", "tags", "typedeal", "img", "date", "views", "badge"}


def _map(**kw):
    """map_listing over a card row and a detail page built from the same keyword values."""
    ix = R.parse_index(_row(**{k: v for k, v in kw.items() if k in _ROW_KEYS}))
    assert len(ix) == 1, "fixture must parse to exactly one card"
    page = _page(**{k: v for k, v in kw.items() if k not in _ROW_KEYS or k == "nid"})
    return R.map_listing(ix[0], R.parse_detail(page))


# ── PRICE = SOURCE ──────────────────────────────────────────────────────────────────────────────
def test_per_metre_label_goes_to_price_per_meter_and_area_is_never_multiplied():
    """nid 3817: «المتر 1,000» on 455 m². The rate is the rate; 455,000 appears nowhere."""
    row, cat, why = _map()
    assert why == "" and cat == "residential"
    assert row["price_per_meter"] == 1000 and row["price_total"] is None and row["price_annual"] is None
    assert row["area_m2"] == 455 and "455000" not in json.dumps(row) and "455,000" not in json.dumps(row)
    assert row["additional_info"]["price_basis"] == "per_sqm"
    assert row["ad_number"] == "AQH3817" and row["listing_url"] == "https://aqalemhajer.com/3817"


# The 23 distinct labels measured over all 1,229 index cells on 2026-09-23, with their basis.
_MEASURED_LABELS = {
    "المتر": "per_sqm", "السوم للمتر": "per_sqm", "السعر للمتر": "per_sqm", "المتر قابل للتفاوض": "per_sqm",
    "السعر": "total", "السوم": "total", "الحد": "total", "السعر قابل للتفاوض": "total", "السعر شامل": "total",
    "شامل الرهن": "total", "شامل القرض": "total", "شامل ( قابل للتفاوض)": "total", "السعر للقطعه": "total",
    "سعر القطعة": "total", "سعر البطن": "total", "سعر المنفصل": "total", "السعر الرغبه": "total",
    "البيع بالوضع الراهن": "total", "الايجار السنوي": "total", "سعر الايجار": "total",
}


@pytest.mark.parametrize("label,basis", sorted(_MEASURED_LABELS.items()))
def test_every_measured_label_lands_on_its_basis(label, basis):
    """The one-line rule («المتر» in the label → per m²) holds over the whole measured vocabulary."""
    got_label, amount, got_basis = R.parse_price(f"💵\n{label}\n1,050")
    assert (got_label, amount, got_basis) == (label, 1050, basis)


def test_a_total_label_can_never_contain_almitr():
    assert all("المتر" not in lab for lab, b in _MEASURED_LABELS.items() if b == "total")


def test_on_soum_publishes_no_figure_so_both_price_columns_stay_null():
    row, _, why = _map(price="على السوم", **{"als-r": "💵\nعلى السوم"})
    assert why == "" and row["price_total"] is None and row["price_per_meter"] is None
    assert row["additional_info"]["price_label"] == "على السوم" and "price_amount_raw" not in row["additional_info"]


def test_tiny_total_is_stored_exactly_as_printed_with_no_plausibility_gate():
    """nid 3819: «السعر قابل للتفاوض 1,050» on 390 m². Owner ruling 2026-08-03: publish it."""
    row, _, _ = _map(nid="3819", price="السعر قابل للتفاوض\n1,050", **{"als-r": "💵\nالسعر قابل للتفاوض\n1,050"})
    assert row["price_total"] == 1050 and row["price_per_meter"] is None


def test_bare_number_with_no_label_stays_as_printed_in_the_deal_column():
    """nid 3009: «محل … للايجار», price cell is the bare «60,000»."""
    row, cat, why = _map(nid="3009", price="60,000", typedeal="محل&nbsp;\n\n\nللايجار", tags="الشهابية",
                         **{"nw-al-qar": "📜\nمحل\nللايجار\nفي\nالشهابية", "als-r": "💵\n60,000"})
    assert why == "" and cat == "commercial"
    assert row["price_annual"] == 60000 and row["rent_period"] is None and row["price_total"] is None
    assert row["additional_info"]["price_basis"] == "unlabelled"
    buy, _, _ = _map(nid="3010", price="60,000", **{"als-r": "💵\n60,000"})
    assert buy["price_total"] == 60000 and buy["additional_info"]["price_basis"] == "unlabelled"


# ── RENT PERIOD = SOURCE ────────────────────────────────────────────────────────────────────────
def test_rent_with_no_stated_period_stays_unconverted_with_null_period():
    """nid 5433: «محل للايجار في المنار», «السعر 250,000» — the office states no period."""
    row, cat, why = _map(nid="5433", price="السعر\n250,000", area="المساحة\n500م", tags="المنار",
                         typedeal="محل&nbsp;\n\n\nللايجار",
                         **{"nw-al-qar": "📜\nمحل\nللايجار\nفي\nالمنار", "als-r": "💵\nالسعر\n250,000",
                            "wsf-al-qar": "▪\nمحل على شارع تجاري مميز، الايجار شهري مناسب"})
    assert why == "" and cat == "commercial" and row["transaction_type"] == "Rent"
    assert row["price_annual"] == 250000 and row["rent_period"] is None and row["price_total"] is None


def test_rent_label_that_states_annual_sets_the_period():
    """nid 4891: «الايجار السنوي 40,000»."""
    row, _, why = _map(nid="4891", price="الايجار السنوي \n40,000", typedeal="شاليه&nbsp;\n\n\nللايجار",
                       tags="المزاوي", **{"nw-al-qar": "📜\nشاليه\nللايجار\nفي\nالمزاوي",
                                          "als-r": "💵\nالايجار السنوي\n40,000"})
    assert why == "" and row["rent_period"] == "annual" and row["price_annual"] == 40000


# ── SKIP, NEVER GUESS ───────────────────────────────────────────────────────────────────────────
def test_a_sold_marker_in_the_office_notes_retires_the_ad():
    assert _map(notes="تم البيع")[2] == "retired_or_auction"
    assert _map(**{"wsf-al-qar": "▪\nمزاد علني يوم الجمعة"})[2] == "retired_or_auction"


def test_unmappable_and_unmapped_types_are_skipped():
    assert _map(**{"nw-al-qar": "📜\nمنتجع\nللبيع\nفي\nبني معن"})[2] == "type_unmappable_at_source"
    assert _map(**{"nw-al-qar": "📜\n13/04/2026\nللبيع\nفي\nالدانة"})[2] == "type_unmapped"
    row, _, why = _map(**{"nw-al-qar": "📜\nدبلكس\nسكنية\nصك\nللبيع\nفي\nالدانة"})
    assert why == "" and row["property_type"] == "Duplex" and row["additional_info"]["type_ar"] == "دبلكس سكنية صك"
    farm, _, why = _map(**{"nw-al-qar": "📜\nأرض زراعية فضا\nللبيع\nفي\nالجشة"})     # nids 5437/5441, 2026-09-23
    assert why == "" and farm["property_type"] == "Farm" and farm["additional_info"]["type_ar"] == "أرض زراعية فضا"


def test_no_deal_word_is_skipped_never_defaulted():
    """36 cards read «بيت في محاسن» with no للبيع/للايجار anywhere."""
    _, _, why = _map(typedeal="بيت&nbsp;", **{"nw-al-qar": "📜\nبيت\nفي\nمحاسن"})
    assert why == "no_deal_stated"


def test_a_place_outside_the_governorate_is_skipped_not_stamped_with_the_default_city():
    _, _, why = _map(tags="ضاحية الملك فهد بالدمام",
                     **{"nw-al-qar": "📜\nدور سكني\nللبيع\nفي\nضاحية الملك فهد بالدمام"})
    assert why == "outside_office_area"
    assert _map(tags="حفر الباطن حي التلال")[2] == "outside_office_area"


def test_bare_riyadh_is_ambiguous_but_mokhatat_riyadh_is_an_ahsa_district():
    assert _map(tags="الرياض")[2] == "location_ambiguous"
    assert _map(tags="الرياض - مركز اللغفيه")[2] == "location_ambiguous"
    row, _, why = _map(tags="مخطط الرياض")
    assert why == "" and row["city_id"] == _AHSA and row["region_id"] == _EASTERN
    assert row["district_ar"] == "حي الرياض" and row["neighborhood"] == "مخطط الرياض"
    assert row["city_ar"] == R.OFFICE_CITY_AR


def test_city_the_catalog_cannot_place_is_skipped(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: (None, None))
    assert _map()[2] == "city_not_in_catalog"


def test_district_needs_pool_agreement_and_a_landmark_or_street_is_not_a_district():
    assert _map(tags="الدانة")[0]["district_ar"] == "حي الدانة"
    # «الرابية» is attested under BOTH الهفوف and المبرز with the same canonical → accepted.
    assert _map(tags="الرابية")[0]["district_ar"] == "حي الرابية"
    assert _map(tags="بالقرب من جامعة الملك فيصل")[0]["district_ar"] is None
    assert _map(tags="شارع الرياض")[0]["district_ar"] is None
    assert _map(tags="الضاحية الحي الرابع")[0]["district_ar"] is None


# ── ADVANCED-FILTER FACTS ───────────────────────────────────────────────────────────────────────
def test_bedrooms_only_from_agreeing_bedroom_phrases_of_a_dwelling():
    """nid 4178: a بيت listing rooms PER FLOOR («ثلاث غرف نوم» … «غرفتين») → ambiguous → NULL."""
    per_floor = ("▪\nالدور الارضي فيه ثلاث غرف نوم ودورتين مياه ومنور صغير وصاله ومطبخ ومجلس مستقل "
                 "بحمامه<br />الدور الثاني شقه فيها غرفتين نوم ودورة مياه ومطبخ")
    row, _, _ = _map(**{"nw-al-qar": "📜\nبيت\nللبيع\nفي\nالمزروعيه", "wsf-al-qar": per_floor})
    assert row["property_type"] == "Villa" and row["bedrooms"] is None
    one, _, _ = _map(**{"nw-al-qar": "📜\nشقة\nللبيع\nفي\nالدانة", "wsf-al-qar": "▪\n3 غرف نوم وصالة ومطبخ"})
    assert one["bedrooms"] == 3
    assert R.bedrooms_from_prose("ثلاث غرف وصالة") is None          # no «نوم» → not bedrooms
    land, _, _ = _map(**{"wsf-al-qar": "▪\nتصلح لبناء 3 غرف نوم"})
    assert land["property_type"] == "Residential Land" and land["bedrooms"] is None


def test_prepared_elevator_is_null_while_named_amenities_are_true():
    """nid 5351: «وتأسيس مصعد» is a shaft; «غرفة خادمه» is a maid's room."""
    body = ("▪\n▪️ بناء شخصي<br />\nالدور الارضي<br />\nمجلس رجال مع دورة مياه<br />\nوتأسيس مصعد<br />\n"
            "مطبخ مفتوح ومطبخ داخلي مع غرفة خادمه<br />\nغرفتين نوم ماستر")
    row, _, _ = _map(nid="5351", **{"nw-al-qar": "📜\nفيلا\nللبيع\nفي\nالمباركية", "wsf-al-qar": body,
                                    "shar-rd": "▪\nشارع عرض\n20*20", "alwajht": "▪\nالواجهة\nجنوب * غرب",
                                    "halt-al-qar": "▪\nحالة العقار\nعظم"})
    assert "elevator" not in row and row["maid_room"] is True and row["kitchen"] is True
    assert "furnished" not in row                                  # silence is NULL, never False
    assert row["street_width_m"] is None and row["direction"] is None   # two streets, two bearings
    assert row["additional_info"]["street_raw"] == "20*20" and row["additional_info"]["condition"] == "عظم"


def test_single_street_direction_age_and_fractional_area_land_in_real_columns():
    row, _, _ = _map(**{"almsaha": "▪\nالمساحة\n487.5\nم", "al-mr": "▪\nالعمر\n18",
                        "alhdwd-walatwal": "▪\nالحدود والأطوال\n14*32.5", "rgm": "▪\nرقم الأرض\n103"})
    assert row["area_m2"] == 487 and row["additional_info"]["area_raw"] == "487.5"
    assert row["street_width_m"] == 15 and row["direction"] == "غرب" and row["property_age"] == 18
    assert row["additional_info"]["plot_no"] == "103" and row["additional_info"]["block_letter"] == "أ"
    assert row["additional_info"]["plot_dimensions"] == "14*32.5" and row["views_count"] == 49
    negative, _, _ = _map(**{"al-mr": "▪\nالعمر\n-1"})
    assert negative["property_age"] is None


# ── PDPL ────────────────────────────────────────────────────────────────────────────────────────
def test_owner_name_phone_numbers_and_in_prose_contacts_never_reach_the_row():
    row, _, _ = _map(**{"wsf-al-qar": "▪\nللتواصل ابو محمد 0555123456 او واتساب 0501234567"})
    blob = json.dumps(row, ensure_ascii=False)
    for pii in ("0507130880", "0502140063", "سعود العبدالله", "0555123456", "0501234567"):
        assert pii not in blob, pii
    assert "sahb-al-qar" not in row["source_capture"]["detail_fields"]
    assert "nothing" not in row["source_capture"]["detail_fields"]
    assert row["additional_info"]["fal_license"] == "1200020821"     # the office's licence, kept
    assert row["license_number"] is None if "license_number" in row else True  # FAL is not an ad licence


# ── IDENTITY, PHOTOS, INDEX ─────────────────────────────────────────────────────────────────────
def test_a_row_without_the_ad_badge_is_dropped_never_given_a_made_up_id():
    assert R.parse_index(_row(badge="")) == []
    assert R.parse_index(_row() + _row(nid="5433", badge="")) [0]["nid"] == "3817"


def test_logo_thumb_is_never_a_photo_and_detail_photos_are_absolute():
    row, _, _ = _map()
    assert row["photo_urls"] == ["https://aqalemhajer.com/sites/default/files/2025-09/IMG_4897.jpeg"]
    logo, _, _ = _map(img="https://aqalemhajer.com/logos.png", photos=[])
    assert logo["photo_urls"] == []
    thumb, _, _ = _map(img="/sites/default/files/2026-03/ص ورة.jpg", photos=[])
    assert thumb["photo_urls"] == ["https://aqalemhajer.com/sites/default/files/2026-03/%D8%B5%20%D9%88%D8%B1%D8%A9.jpg"]


def test_nothing_is_ever_read_from_the_related_ads_table():
    row, _, _ = _map(price="على السوم", **{"als-r": "💵\nعلى السوم"})
    assert "9999999" not in json.dumps(row) and "9,999,999" not in json.dumps(row)


def test_printed_total_is_read_for_the_completeness_check():
    assert R._TOTAL_RE.search("<p>عدد العقارات: 1229</p>").group(1) == "1229"


# ── REMOVAL ORACLE ──────────────────────────────────────────────────────────────────────────────
def test_signal_404_is_gone_node_marker_is_live_and_anything_else_has_no_opinion():
    sig = R._signal_for("3817")
    assert sig(404, _DEAD_BODY, False) == "gone"
    assert sig(200, _page(), False) == "live"
    assert sig(200, _page(notes="تم البيع"), False) == "gone"           # retired in place
    assert sig(200, _page(nid="9999"), False) is None                    # somebody else's node
    assert sig(503, "", False) is None and sig(200, "", False) is None   # a block is not a death


def test_fetch_detail_treats_the_themed_404_as_absent_not_as_a_parsed_page():
    class _R:
        def __init__(self, status, text):
            self.status_code, self.text = status, text

    class _S:
        def __init__(self, resp):
            self.resp = resp

        def get(self, url, timeout=0):
            assert url == "https://aqalemhajer.com/3820"
            return self.resp
    assert R.fetch_detail(_S(_R(404, _DEAD_BODY)), "3820") is None
    assert R.fetch_detail(_S(_R(200, _DEAD_BODY)), "3820") is None      # 200 without the node id
    assert R.fetch_detail(_S(_R(200, _page(nid="3820"))), "3820")["fields"]["als-r"] == "💵\nالمتر\n1,000"


# ── main(): the skip tally reaches end_run(notes=…) and pruning fails CLOSED ────────────────────
class _FakeDB:
    def __init__(self):
        self.calls: list[tuple] = []

    def begin_run(self, platform):
        self.calls.append(("begin_run", platform))
        return 77

    def _wasalt_batch(self, table, rows):
        self.calls.append(("_wasalt_batch", table, len(rows)))

    def retire_superseded_siblings(self, **kw):
        self.calls.append(("retire", kw["res_table"], kw["com_table"]))
        return 0

    def prune_unseen(self, table, seen, source, verify_gone=None):
        self.calls.append(("prune", table, len(seen), verify_gone is not None))
        return 0

    def end_run(self, run_id, **kw):
        self.calls.append(("end_run", run_id, kw))
        return True


def _cards():
    return [R.parse_index(_row())[0],
            R.parse_index(_row(nid="5221", typedeal="منتجع&nbsp;\n\n\nللبيع", tags="بني معن"))[0],
            R.parse_index(_row(nid="4665", tags="ضاحية الملك فهد بالدمام"))[0],
            R.parse_index(_row(nid="5433", price="السعر\n250,000", typedeal="محل&nbsp;\n\n\nللايجار", tags="المنار"))[0],
            R.parse_index(_row(nid="5222", tags="الدانة"))[0]]     # planted «قريباً» prose (0 live off-plan ads)


def _details():
    return {"3817": R.parse_detail(_page()),
            "5221": R.parse_detail(_page(nid="5221", **{"nw-al-qar": "📜\nمنتجع\nللبيع\nفي\nبني معن"})),
            "4665": R.parse_detail(_page(nid="4665", **{"nw-al-qar": "📜\nأرض\nللبيع\nفي\nضاحية الملك فهد بالدمام"})),
            "5433": R.parse_detail(_page(nid="5433", **{"nw-al-qar": "📜\nمحل\nللايجار\nفي\nالمنار",
                                                        "als-r": "💵\nالسعر\n250,000"})),
            "5222": R.parse_detail(_page(nid="5222", **{"wsf-al-qar": "▪\nقريباً في السوق"}))}


def _run_main(monkeypatch, printed_total):
    fake = _FakeDB()
    monkeypatch.setattr(R, "db", fake)
    monkeypatch.setattr(R, "session", lambda: object())
    monkeypatch.setattr(R, "fetch_index", lambda s, limit=0: (_cards(), printed_total))
    monkeypatch.setattr(R, "fetch_detail", lambda s, nid: _details()[nid])
    monkeypatch.setattr(R.time, "sleep", lambda _s: None)
    monkeypatch.setattr(sys, "argv", ["run.py", "--type", "all"])
    assert R.main() == 0
    return fake


def test_main_writes_both_tables_supersedes_then_prunes_and_reports_the_skip_tally(monkeypatch):
    fake = _run_main(monkeypatch, printed_total=5)
    names = [c[0] for c in fake.calls]
    assert names.index("retire") < names.index("prune")
    assert ("_wasalt_batch", "aqalemhajer_residential_listings", 1) in fake.calls
    assert ("_wasalt_batch", "aqalemhajer_commercial_listings", 1) in fake.calls
    assert ("prune", "aqalemhajer_residential_listings", 1, True) in fake.calls
    end = [c for c in fake.calls if c[0] == "end_run"][0]
    assert end[1] == 77 and end[2]["ok"] is True and end[2]["degraded"] is False
    assert end[2]["rows_seen"] == 5 and end[2]["rows_upserted"] == 2
    assert "type_unmappable_at_sourcex1" in end[2]["notes"] and "outside_office_areax1" in end[2]["notes"]
    assert "off_planx1" in end[2]["notes"]
    assert end[2]["check_tables"] == ["aqalemhajer_residential_listings", "aqalemhajer_commercial_listings"]


def test_an_incomplete_enumeration_withholds_pruning_and_demotes_the_run(monkeypatch):
    fake = _run_main(monkeypatch, printed_total=1229)     # site says 1,229, we saw 5
    assert not any(c[0] == "prune" for c in fake.calls)
    end = [c for c in fake.calls if c[0] == "end_run"][0]
    assert end[2]["degraded"] is True and end[2]["ok"] is True


# ── FIXER 2026-09-23: the reviewer's findings, each one mutation-checked ───────────────────────
def test_area_is_only_the_figure_after_the_almsaha_label_never_the_street():
    """nid 4659 (index + detail captured 2026-09-23): the office published NO «المساحة» — the index
    area cell is the verbatim «شارع\n15» and the detail page has no almsaha field, only shar-rd
    «شارع عرض 15» and an empty «💵» price. Five live cards share this shape (4659, 4587, 4556, 4535,
    3886); the only number in the cell is the street width, never an area."""
    ix = R.parse_index(_row(nid="4659", area="شارع\n15", price="", typedeal="دبلكس&nbsp;\n\n\nللبيع",
                            tags="الضاحية الحي الخامس"))[0]
    assert ix["area_text"] == "شارع\n15"
    detail = R.parse_detail(_page(nid="4659", h1="دبلكس للبيع في الضاحية الحي الخامس", almsaha=None,
                                  **{"nw-al-qar": "📜\nدبلكس\nللبيع\nفي\nالضاحية الحي الخامس",
                                     "shar-rd": "▪\nشارع عرض\n15", "als-r": "💵"}))
    assert "almsaha" not in detail["fields"]
    row, _, why = R.map_listing(ix, detail)
    assert why == "" and row["property_type"] == "Duplex"
    assert row["area_m2"] is None and "area_raw" not in row["additional_info"]
    assert row["street_width_m"] == 15 and row["additional_info"]["street_raw"] == "15"
    assert row["price_total"] is None and row["price_per_meter"] is None
    assert R.parse_area("شارع\n40*15 ركنية") == (None, None)             # nid 4535
    assert R.parse_area("شارع\n21*19.4") == (None, None)                 # nid 3886
    assert R.parse_area("المساحة\n455م\nشارع\n15") == (455, "455")    # the labelled form, unchanged
    assert R.parse_area("▪\nالمساحة\n487.5\nم") == (487, "487.5")
    assert R.parse_area("المساحة\nشارع\n15") == (None, None)            # label with no figure


def test_daily_or_weekly_rent_label_is_never_parked_in_price_annual():
    """The shared helper returns (None, None) for يومي/أسبوعي/نصف سنوي so the figure is NOT stored;
    the scraper must not turn that back into (None, amount). A monthly label is the standard ×12.
    Live 2026-09-23: 21 rent cards, only «الايجار السنوي» (3) states a period."""
    base = dict(nid="4891", typedeal="شاليه&nbsp;\n\n\nللايجار", tags="المزاوي")
    phrase = {"nw-al-qar": "📜\nشاليه\nللايجار\nفي\nالمزاوي"}
    daily, _, why = _map(**base, **phrase, **{"als-r": "💵\nالايجار اليومي\n500"})
    assert why == "" and daily["transaction_type"] == "Rent"
    assert daily["price_annual"] is None and daily["rent_period"] is None and daily["price_total"] is None
    assert daily["additional_info"]["price_amount_raw"] == 500      # the figure survives only as raw
    assert daily["additional_info"]["price_label"] == "الايجار اليومي"
    for label in ("الايجار الأسبوعي", "الايجار نصف سنوي"):
        row, _, _ = _map(**base, **phrase, **{"als-r": f"💵\n{label}\n2,000"})
        assert row["price_annual"] is None and row["rent_period"] is None, label
    monthly, _, _ = _map(**base, **phrase, **{"als-r": "💵\nالايجار الشهري\n5,000"})
    assert monthly["rent_period"] == "monthly" and monthly["price_annual"] == 60000
    assert monthly["additional_info"]["price_amount_raw"] == 5000


def test_title_and_neighborhood_are_redacted_like_every_other_free_text_column():
    row, _, why = _map(h1="أرض للبيع في الدانة للتواصل 0555123456", tags="الدانة 0555123456")
    assert why == ""
    assert row["title"] == "أرض للبيع في الدانة للتواصل [redacted]"
    assert row["neighborhood"] == "الدانة [redacted]"
    assert "0555123456" not in json.dumps(row, ensure_ascii=False)


def test_a_price_cell_stores_exactly_one_whole_riyal_figure_or_nothing():
    """Latent shapes (0 of 1,229 live cells on 2026-09-23): dotted thousands follow the shared
    to_int grouping rule; a fraction or a second figure is kept VERBATIM and fills no column —
    never the first number, never a floor."""
    assert R.parse_price("💵\nالسعر\n1.200.000") == ("السعر", 1200000, "total")
    assert R.parse_price("💵\nالسعر\n1.5") == ("السعر 1.5", None, None)
    assert R.parse_price("💵\nالسعر شامل 5% الضريبة\n500,000") == ("السعر شامل 5% الضريبة 500,000", None, None)
    row, _, why = _map(**{"als-r": "💵\nالسعر شامل 5% الضريبة\n500,000"})
    assert why == "" and row["price_total"] is None and row["price_per_meter"] is None
    assert row["additional_info"]["price_label"] == "السعر شامل 5% الضريبة 500,000"
    assert "price_basis" not in row["additional_info"] and "price_amount_raw" not in row["additional_info"]
    frac, _, _ = _map(**{"als-r": "💵\nالمتر\n1.5"})
    assert frac["price_per_meter"] is None and frac["additional_info"]["price_label"] == "المتر 1.5"


def test_off_plan_markers_are_skipped_but_proximity_and_approximately_are_not():
    """nid 5243 (2026-09-23): «قريبا جدا من حي الجابرية» is NEAR a district — the only live hit of
    the bare token over all 1,229 descriptions; «تقريباً» is 'approximately'. Only the tanween
    forms of «قريباً», «على الخارطة» and «بدأ البيع» mean off-plan."""
    for tok in ("قريباً مشروع جديد", "قريبًا", "على الخارطة", "بدأ البيع في المشروع"):
        assert _map(**{"wsf-al-qar": "▪\n" + tok})[2] == "off_plan", tok
    assert _map(h1="قريباً: أرض للبيع في الدانة")[2] == "off_plan"
    assert _map(notes="بدأ البيع")[2] == "off_plan"
    for tok in ("قريبا جدا من حي الجابرية", "المساحة تقريباً 400 متر", "قريب من الجامعة"):
        assert _map(**{"wsf-al-qar": "▪\n" + tok})[2] == "", tok
    # off-plan is a SKIP, not a death: the liveness signal still reads the node as live.
    assert R._signal_for("3817")(200, _page(**{"wsf-al-qar": "▪\nقريباً"}), False) == "live"


def test_duplex_and_studio_route_to_commercial_like_the_rest_of_the_fleet():
    """N.category_for_type("Duplex"/"Studio") answers "Commercial" (the shared helper's residential
    set predates both; scrapers/common/normalize.py cannot be edited here) and this file does NOT
    route around it — matching every other platform on the shared helper (bossbih's
    test_every_type_phrase_this_catalogue_publishes_maps_or_is_deliberately_skipped pins the same
    thing). Not a live-listing gap: the app's Residential filter already recovers rows here via
    kinds:BOTH + the broad-Residential misfile-recovery path — confirmed live for bossbih (owner
    decision 2026-09-24, docs/ARCHITECTURE.md §21). A per-platform override here would instead be
    the one inconsistency in the fleet."""
    from scrapers.common import normalize as N
    assert N.category_for_type("Duplex").lower() == "commercial"
    assert N.category_for_type("Studio").lower() == "commercial"
    dup, cat, why = _map(**{"nw-al-qar": "📜\nدبلكس\nسكنية\nصك\nللبيع\nفي\nالدانة"})
    assert why == "" and dup["property_type"] == "Duplex" and cat == "commercial"
    stu, cat2, why2 = _map(**{"nw-al-qar": "📜\nستوديو\nللبيع\nفي\nالدانة"})
    assert why2 == "" and stu["property_type"] == "Studio" and cat2 == "commercial"


def test_fallback_title_without_a_detail_page_has_no_dangling_fi():
    ix = R.parse_index(_row())[0]
    assert R.map_listing(ix, None)[0]["title"] == "أرض للبيع"
    assert R.map_listing({**ix, "type_deal": "أرض للبيع في الدانة"}, None)[0]["title"] == "أرض للبيع في الدانة"
    assert not hasattr(R, "_DEAL_RE")
