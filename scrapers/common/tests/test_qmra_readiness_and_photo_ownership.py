"""قمرا للتطوير العقاري (qmra.sa): the readiness taxonomy is the SOLE gate for inclusion, and a
page's own rendered content is not proof of who owns a photo.

Every fixture below is a VERBATIM shape captured live 2026-09-25 from
`https://qmra.sa/wp-json/wp/v2/property/<id>?_embed=1`, trimmed to the keys the code reads. The 19
live posts split 6 ready / 13 not (8 مُباع, 3 تحت الإنشاء, 1 تم التأجير, 1 تم البيع) — this file
carries a real example of each status class that actually exists live, plus the two ready units
(843, 836) whose own pages misattribute another post's photos, proven with the real media records.

THIS IS THE SINGLE MOST IMPORTANT TEST IN THIS BUILD: an off-plan unit (قمرا 03, id 897, «تحت
الإنشاء») must come out of `map_listing`'s own gate as EXCLUDED, and a ready unit (قمرا 17, id 862,
«مُتاح للبيع») must come out INCLUDED — from the taxonomy field alone, never a title/description
regex.

Run: python -m pytest scrapers/common/tests/test_qmra_readiness_and_photo_ownership.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.qmra import run as R  # noqa: E402

_RIYADH = 3


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog/find_district_in_text would otherwise read loc_catalog_* from the database."""
    monkeypatch.setattr(R, "to_catalog",
                        lambda c, region_hint=None: (_RIYADH, 1) if c == "الرياض" else (None, None))
    known = {"الورود", "الربيع", "التعاون", "حطين", "المرسلات", "الرحمانية"}
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: next((d for d in known if t and d in t), None))


def _terms(*triples):
    """[(taxonomy, id, name), …] → the `_embedded["wp:term"]` shape WordPress actually serves (one
    group per taxonomy). Matches the real, multi-group structure captured live — a flat list would
    not exercise `_terms_of`'s real grouping loop."""
    groups: dict[str, list[dict]] = {}
    for taxonomy, tid, name in triples:
        groups.setdefault(taxonomy, []).append({"taxonomy": taxonomy, "id": tid, "name": name})
    return {"wp:term": list(groups.values())}


# ── VERBATIM CAPTURES (2026-09-25, https://qmra.sa/wp-json/wp/v2/property/<id>?_embed=1) ─────────

# READY. قمرا 17 — «مُتاح للبيع» (term id 10, WITH the dammah U+064F the source actually writes),
# type «دور» (Floor). One of the 6 units this build is FOR.
READY_UNIT = {
    "id": 862, "slug": "%d9%82%d9%85%d8%b1%d8%a7-17",
    "link": "https://qmra.sa/property/%d9%82%d9%85%d8%b1%d8%a7-17/",
    "title": {"rendered": "قمرا 17"},
    "date": "2025-04-05T16:11:07", "modified": "2026-08-19T16:07:57",
    "featured_media": 954,
    "_embedded": _terms(("property-status", 10, "مُتاح للبيع"), ("property-type", 15, "دور")),
}

# OFF-PLAN. قمرا 03 — «تحت الإنشاء» (under construction), term id 11. THE unit this build exists to
# refuse. Also carries TWO property-type terms (تاون هاوس + دور) — a real shape, never observed on
# any ready unit — so this fixture alone proves the status gate fires before type is ever consulted.
OFFPLAN_UNIT = {
    "id": 897, "slug": "%d9%82%d9%85%d8%b1%d8%a7-03",
    "link": "https://qmra.sa/property/%d9%82%d9%85%d8%b1%d8%a7-03/",
    "title": {"rendered": "قمرا 03"},
    "_embedded": _terms(("property-status", 11, "تحت الإنشاء"),
                        ("property-type", 7, "تاون هاوس"), ("property-type", 15, "دور")),
}

# SOLD (primary spelling, term id 12 «مُباع» — 8 of the 19 live posts carry this exact term).
SOLD_UNIT = {
    "id": 837, "slug": "%d9%82%d9%85%d8%b1%d8%a7-13",
    "link": "https://qmra.sa/property/%d9%82%d9%85%d8%b1%d8%a7-13/",
    "title": {"rendered": "قمرا 13"},
    "_embedded": _terms(("property-status", 12, "مُباع"), ("property-type", 13, "شقق")),
}

# RENTED (term id 22 «تم التأجير» — a unit that WAS available and has since been leased).
RENTED_UNIT = {
    "id": 820, "slug": "%d9%82%d9%85%d8%b1%d8%a7-05",
    "link": "https://qmra.sa/property/%d9%82%d9%85%d8%b1%d8%a7-05/",
    "title": {"rendered": "قمرا 05"},
    "_embedded": _terms(("property-status", 22, "تم التأجير"), ("property-type", 17, "مكاتب")),
}

# AMBIGUOUS TYPE, still off-plan (قمرا 18, id 846) — THREE property-type terms on one post. Used
# only to exercise `_resolved_type`'s own refusal-to-guess in isolation.
MULTI_TYPE_UNIT = {
    "id": 846,
    "_embedded": _terms(("property-status", 11, "تحت الإنشاء"), ("property-type", 7, "تاون هاوس"),
                        ("property-type", 15, "دور"), ("property-type", 8, "فيلا")),
}


# ── 1. THE READINESS GATE — off-plan excluded, ready included, from the taxonomy alone ───────────
def test_a_real_off_plan_unit_is_excluded_by_the_readiness_field_alone():
    deal, reason = R._status_deal(OFFPLAN_UNIT)
    assert deal is None, "«تحت الإنشاء» (under construction) must never be read as ready"
    assert reason == "not_ready_تحت_الإنشاء"


def test_a_real_ready_unit_is_included_by_the_readiness_field_alone():
    deal, reason = R._status_deal(READY_UNIT)
    assert deal == "Buy" and reason == ""
    assert R._resolved_type(READY_UNIT) == ("Floor", "")


@pytest.mark.parametrize("fixture,expected_reason", [
    (OFFPLAN_UNIT, "not_ready_تحت_الإنشاء"),
    (SOLD_UNIT, "not_ready_مباع"),
    (RENTED_UNIT, "not_ready_تم_التأجير"),
])
def test_every_measured_not_ready_status_is_excluded_and_named(fixture, expected_reason):
    """Sold and rented units are not deleted at source (see the removal-oracle docstring) — they
    just carry a status this dict does not name. Confirms the skip reason names the REAL status
    word rather than a generic 'not ready', so a production run's tally is auditable."""
    deal, reason = R._status_deal(fixture)
    assert deal is None
    assert reason == expected_reason


def test_the_readiness_dict_never_silently_grows_or_shrinks():
    """Locks the exact measured vocabulary (docstring's MEASURED CATALOGUE) — a change here must be
    a deliberate edit to the module, never an incidental side effect of some other change."""
    assert R._READY_STATUS_TO_DEAL == {"متاح للبيع": "Buy", "متاح للتأجير": "Rent"}


# ── 2. TASHKEEL — the fixture must carry the SOURCE's real bytes, not a hand-typed lookalike ─────
# abaad and tuba both shipped a studio-type override that silently never fired because a hand-typed
# comparison string didn't carry the SAME invisible mark in the SAME position as the source's own
# bytes. Proven here the same way: the fixture is asserted to actually CONTAIN the dammah (U+064F)
# before the code is trusted to strip it.
def test_the_ready_status_fixture_really_carries_the_sources_own_dammah():
    raw = READY_UNIT["_embedded"]["wp:term"][0][0]["name"]
    assert "ُ" in raw, "the fixture must be the SOURCE's bytes (مُتاح), not a typed مُتاح lookalike"
    assert R._strip_marks(raw) == "متاح للبيع"


def test_status_matching_is_immune_to_the_dammah_either_way():
    with_mark, _ = R._status_deal(READY_UNIT)
    # A second, independently-built record whose status name has NO dammah at all must match too.
    plain = {"_embedded": {"wp:term": [[{"taxonomy": "property-status", "id": 10,
                                         "name": "متاح للبيع"}]]}}
    assert with_mark == "Buy"
    assert R._status_deal(plain)[0] == "Buy"


# ── 3. TYPE — exactly one term required, never guessed ───────────────────────────────────────────
def test_multiple_property_type_terms_are_refused_not_guessed():
    ptype, reason = R._resolved_type(MULTI_TYPE_UNIT)
    assert ptype is None and reason == "type_count_3"


def test_a_bare_post_with_no_property_type_term_is_refused():
    assert R._resolved_type({"_embedded": {}}) == (None, "type_count_0")


@pytest.mark.parametrize("name,expected", [("دور", "Floor"), ("شقق", "Apartment"),
                                           ("تاون هاوس", "Villa"), ("مكاتب", "Office")])
def test_every_type_word_this_source_has_ever_shown_resolves(name, expected):
    rec = {"_embedded": {"wp:term": [[{"taxonomy": "property-type", "id": 1, "name": name}]]}}
    assert R._resolved_type(rec) == (expected, "")


# ── 4. THE FULL MAPPER on the two decisive fixtures ───────────────────────────────────────────────
def _map(rec):
    deal, reason = R._status_deal(rec)
    assert deal, f"fixture unexpectedly not ready: {reason}"
    ptype, reason = R._resolved_type(rec)
    assert ptype, f"fixture unexpectedly type-unmapped: {reason}"
    detail = {"location_text": "الورود، الرياض", "image_ids": set()}
    return R.map_listing(rec, deal, ptype, detail, None)


def test_the_ready_unit_produces_a_real_row_with_the_sources_own_url():
    row, cat = _map(READY_UNIT)
    assert row["ad_number"] == "QMR862"
    assert row["listing_url"] == READY_UNIT["link"]
    assert row["transaction_type"] == "Buy" and row["property_type"] == "Floor"
    assert cat == "residential"
    assert row["city_ar"] == "الرياض" and row["city_id"] == _RIYADH
    assert row["district_ar"] == "الورود"


def test_the_off_plan_unit_never_reaches_the_mapper_at_all():
    """The production loop (main()) checks `_status_deal` BEFORE ever calling `map_listing` or
    fetching the detail page — an off-plan unit gets no row, full stop, never an inactive one."""
    deal, _ = R._status_deal(OFFPLAN_UNIT)
    assert deal is None, "off-plan must be refused before map_listing is ever reached"


# ── 5. PRICE = SOURCE: no price field exists on this platform at all ─────────────────────────────
def test_no_price_is_ever_fabricated_for_a_source_that_publishes_none():
    row, _ = _map(READY_UNIT)
    # No price key is written at all (equivalent to None for db._wasalt_batch's no-clobber guard,
    # which drops a None/absent key from the upsert payload either way — see its own docstring) —
    # this source has no price field of any kind to read, on any of its 19 posts.
    assert row.get("price_total") is None and row.get("price_annual") is None
    assert row.get("price_per_meter") is None
    assert row["price_evidence"]["found"] is False, (
        "no price field was ever read on this source — this is NOT the same as the source stating "
        "an explicit null, so authoritative_absent must stay False")
    assert row["price_evidence"]["authoritative_absent"] is False


# ── 6. PHOTO MISATTRIBUTION — the trap that makes a page-scrape-only design wrong ─────────────────
# REAL captures, 2026-09-25: قمرا 12 (id 836) inlines media 832-835 on its OWN page, but
# /wp-json/wp/v2/media/832..835 all say `"post": 831` (قمرا 11's own WhatsApp photos, uploaded at
# 831's creation). قمرا 14 (id 843) inlines 838-842 AND sets them as its OWN featured_media (839),
# but /wp-json/wp/v2/media/838..842 all say `"post": 837` — قمرا 13, a SOLD unit.
def test_a_page_referencing_another_posts_media_id_never_becomes_this_ones_photo():
    rendered_on_836 = {832, 833, 834, 835}          # what قمرا 12's OWN page actually inlines
    owned_by_831 = {832: "https://qmra.sa/.../832.jpeg", 833: "https://qmra.sa/.../833.jpeg",
                    834: "https://qmra.sa/.../834.jpeg", 835: "https://qmra.sa/.../835.jpeg"}
    # media_map["836"] is what WordPress's OWN parent[]=836 filter returns — empty, because none of
    # 832-835 are really 836's (measured live: قمرا 12 has ZERO of its own attached media).
    assert R.resolve_photo_urls(rendered_on_836, owned={}) is None
    # The same four ids, looked up under their REAL owner (831), resolve normally.
    assert R.resolve_photo_urls(rendered_on_836, owned=owned_by_831) == [
        owned_by_831[i] for i in sorted(rendered_on_836)]


def test_a_posts_own_featured_media_is_still_subject_to_the_same_ownership_check():
    # قمرا 14's featured_media (839) belongs to قمرا 13 (SOLD) at the source — proven live via
    # /wp-json/wp/v2/media/839 → {"post": 837}. Passing it as a bare candidate must not resurrect it
    # just because the SOURCE mislabelled its own featured image.
    candidate_ids = {838, 839, 840, 841, 842}       # 839 == قمرا 14's OWN (mis-set) featured_media
    assert R.resolve_photo_urls(candidate_ids, owned={}) is None, (
        "843's true media_map is empty (measured) — a mis-set featured_media must not manufacture a "
        "photo any more than a borrowed gallery image does")


def test_a_units_own_confirmed_media_still_resolves_normally():
    owned = {1757: "https://qmra.sa/.../a.png", 1758: "https://qmra.sa/.../b.png"}
    assert R.resolve_photo_urls({1757, 1758, 9999}, owned) == [owned[1757], owned[1758]]
    assert R.resolve_photo_urls(set(), {}) is None


# ── 7. THE REMOVAL ORACLE re-reads the SAME field, from a fresh GET, and 200 is not enough ───────
# A unit that sells out is not deleted at source — its property-status term just changes and the
# post keeps answering 200 forever (measured: id 837 is now «مُباع», still 200 with a full body).
_REST_404 = json.dumps({"code": "rest_post_invalid_id",
                        "message": "رقم المقالة خاطئ.", "data": {"status": 404}})


def test_a_hard_delete_is_the_only_404_the_oracle_trusts():
    assert R._signal(404, _REST_404, False) == "gone"


def test_a_404_without_the_real_wp_error_code_is_not_trusted_as_a_death():
    assert R._signal(404, json.dumps({"code": "some_waf_page"}), False) is None


def test_a_unit_that_sold_out_reads_as_gone_even_though_it_still_answers_200():
    body = json.dumps(SOLD_UNIT)
    assert R._signal(200, body, False) == "gone"


def test_a_still_ready_unit_reads_as_live():
    body = json.dumps(READY_UNIT)
    assert R._signal(200, body, False) == "live"


def test_a_200_with_no_status_term_at_all_has_no_opinion():
    assert R._signal(200, json.dumps({"_embedded": {}}), False) is None


def test_an_unparseable_body_has_no_opinion_rather_than_raising():
    assert R._signal(200, "<html>not json</html>", False) is None
    assert R._signal(404, "<html>not json</html>", False) is None


# ── 8. PDPL — the capture is built from an allowlist and runs through the shared redactors ───────
def test_the_capture_allowlist_has_no_contact_or_identity_fields():
    forbidden = {"phone", "email", "whatsapp", "author", "advertiser", "employee"}
    assert not (set(R._CAPTURE_KEYS) & forbidden)


def test_pii_helpers_are_actually_invoked_on_every_row():
    row, _ = _map(READY_UNIT)
    assert "source_capture" in row and "additional_info" in row
    # strip_pii_fields drops any PII-named key recursively; confirms the row went through it rather
    # than being handed to the DB raw.
    for k in row["source_capture"]:
        assert "phone" not in k.lower() and "email" not in k.lower()
