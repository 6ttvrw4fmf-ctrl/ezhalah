"""aqarcity: the JSON-LD amenityFeature checklist is read with «خدمات العقار» (🔬 AF, 2026-10-10).

/property/30982 (aqarcity_residential_listings:14386203, Riyadh land) prints «خدمات العقار: لايوجد خدمات»
in its details list while its own JSON-LD amenityFeature ticks «كهرباء» and «الخدمات متوفرة». We read only
the list, stored electricity = no, and served the plot as «أرض خام» — against the owner's rule that a
raw land lists no service. Both are the site's structured statements; a utility ticked in either is
ticked (the 10-09 ruling in test_aqarcity_land_services_checklist: a contradictory checklist keeps what
is ticked). Fixture rows and the amenityFeature list are verbatim from the live page (2026-10-10).
"""
import json
import sys

sys.path.insert(0, ".")

import scrapers.aqarcity.run as R  # noqa: E402

ROW = ('<div class="items-center justify-between gap-3 border-b border-zinc-100 py-2.5 flex ">'
       '<dt class="flex shrink-0 items-center gap-2 text-sm text-zinc-500"><i class="fas fa-{icon} w-4 '
       'text-center text-xs text-zinc-400" aria-hidden="true"></i>{label}</dt><dd class="min-w-0 text-end '
       'text-sm font-semibold text-zinc-900">{value}</dd></div>')
DL = "".join(ROW.format(icon=i, label=l, value=v) for i, l, v in (
    ("tag", "نوع العقار", "ارض"), ("ruler-combined", "مساحة العقار", "400 م²"),
    ("bolt", "خدمات العقار", "لايوجد خدمات")))
FEATURES = [{"@type": "LocationFeatureSpecification", "name": n, "value": True}
            for n in ("شارع مسفلت", "الخدمات متوفرة", "أرض مستوية", "كهرباء", "لايوجد خدمات")]


def _body(features):
    ld = {"@context": "https://schema.org", "@type": "RealEstateListing",
          "url": "https://www.aqarcity.net/property/30982", "name": "ارض للبيع في حي العريجاء الأوسط - الرياض",
          "mainEntity": {"@type": "Place", "amenityFeature": features},
          "offers": {"@type": "Offer", "priceCurrency": "SAR", "price": 1400000,
                     "availability": "https://schema.org/InStock"}}
    return f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>' + DL


def _row(features):
    row, _ = R.map_listing(_body(features), "https://www.aqarcity.net/property/30982")
    return row


def test_a_utility_ticked_in_the_json_ld_is_not_stored_as_no():
    row = _row(FEATURES)
    assert row["property_type"] == "Residential Land"
    assert row["electricity"] is True                      # was False: the list alone said «لايوجد خدمات»
    assert row["water_supply"] is False and row["sanitation"] is False


def test_without_the_feature_the_list_still_decides():
    row = _row([f for f in FEATURES if f["name"] != "كهرباء"])
    assert (row["electricity"], row["water_supply"], row["sanitation"]) == (False, False, False)


def test_an_unticked_feature_is_not_a_tick():
    feats = [{**f, "value": False} if f["name"] == "كهرباء" else f for f in FEATURES]
    assert _row(feats)["electricity"] is False


def test_the_checklist_is_kept_verbatim():
    assert _row(FEATURES)["additional_info"]["amenity_features"] == [f["name"] for f in FEATURES]


# 🆕 2026-11-08: the same checklist ticks home amenities (aqarcity 25437035 /property/31634, re-read 42460062892:
# «موقف سيارات=True | مدخل خاص=True»); they were never stored, so the Advanced Filter could not find the villa.
HOME_FEATURES = [{"@type": "LocationFeatureSpecification", "name": n, "value": True}
                 for n in ("موقف سيارات", "حديقة", "مدخل خاص", "مصعد", "غرفة خادمة", "مطبخ راكب", "كهرباء")]
HOME_DL = "".join(ROW.format(icon=i, label=l, value=v) for i, l, v in (
    ("tag", "نوع العقار", "فيلا"), ("ruler-combined", "مساحة العقار", "200 م²")))


def _home(features):
    ld = {"@context": "https://schema.org", "@type": "RealEstateListing",
          "url": "https://www.aqarcity.net/property/31634", "name": "فيلا للبيع في حي الصواري - الخبر",
          "mainEntity": {"@type": "Place", "amenityFeature": features},
          "offers": {"@type": "Offer", "priceCurrency": "SAR", "price": 970000,
                     "availability": "https://schema.org/InStock"}}
    body = f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>' + HOME_DL
    row, why = R.map_listing(body, "https://www.aqarcity.net/property/31634")
    assert row is not None, why
    return row


def test_ticked_home_amenities_reach_the_advanced_filter():
    row = _home(HOME_FEATURES)
    assert (row["parking"], row["private_entrance"], row["elevator"], row["maid_room"], row["kitchen"]) == (
        True, True, True, True, True)


def test_an_amenity_the_checklist_does_not_tick_stays_silent():
    row = _home([f for f in HOME_FEATURES if f["name"] not in ("مصعد", "موقف سيارات")])
    assert row.get("elevator") is None and row.get("parking") is None     # never «no» from silence


def test_an_unticked_home_amenity_is_not_a_yes():
    row = _home([{**f, "value": False} if f["name"] == "مصعد" else f for f in HOME_FEATURES])
    assert row.get("elevator") is None
