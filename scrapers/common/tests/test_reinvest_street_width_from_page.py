"""reinvest street width comes from the ad page's own licence table, never from the option id.

Measured 2026-10-30 (re-read run 41091675244, backlog 1091/1092): the API's `info_fields.street_width`
is a menu id the API never resolves, and the 2026-09-24 id→metres table was wrong 2 of 2 —
maard-llaygar-416 carries id 187 (table: 60) while its page prints «عرض الشارع 50»; ard-llbyaa-1775
carries id 185 (table: 18) while its page prints 12. The page embeds the resolved licence table
(`info_fields_label`) in its Next.js payload; that is what we store.

MUTATION-VERIFIED: restoring `normalize.one_street_width(_STREET_WIDTH_BY_ID.get(width_id))` in
map_listing fails test_width_is_the_pages_not_the_ids (stores 60) and
test_unread_page_is_unknown_not_the_id (stores 60 instead of None).
"""
from __future__ import annotations

from scrapers.reinvest import run

# The exact escaping the live page carries (one JS-string level), cut from run 41098655633's log.
PAGE_50 = (
    '<script>self.__next_f.push([1,"{\\"creator_id\\":13433,\\"info_fields_label\\":null}"])</script>'
    '<script>self.__next_f.push([1,"{\\"average_rating_creator\\":0,\\"info_fields_label\\":'
    '{\\"رقم ترخيص الإعلان\\":\\"7201192148\\",\\"عمر العقار\\":\\"جديد\\",\\"عدد الغرف\\":3,'
    '\\"واجهة العقار\\":\\"شرقية\\",\\"عرض الشارع\\":50,\\"سعر المتر\\":13020.833,'
    '\\"الالتزامات الأخرى على العقار\\":\\"العقار مرهون {لا}\\"},\\"x\\":1}"])</script>'
)
PAGE_DASH = PAGE_50.replace('\\"عرض الشارع\\":50', '\\"عرض الشارع\\":\\"-\\"')


def _rec(labels):
    # A real captured record (LAND_RENT_223 carries street_width id 187, the contradicted pairing).
    from scrapers.common.tests.test_reinvest_price_and_period import LAND_RENT_223
    assert LAND_RENT_223["info_fields"]["street_width"] == 187
    return {**LAND_RENT_223, "_page_labels": labels}


def test_labels_are_read_past_a_null_copy():
    got = run.page_labels(PAGE_50)
    assert got and got["عرض الشارع"] == 50 and got["واجهة العقار"] == "شرقية"


def test_width_is_the_pages_not_the_ids():
    row, _cat, why = run.map_listing(_rec(run.page_labels(PAGE_50)))
    assert row, why
    assert row["street_width_m"] == 50, row["street_width_m"]


def test_dash_is_unset_not_zero():
    """The page SAYS «-»: the source settled it, so the old id-derived value must be cleared —
    AUTHORITATIVE_NULL, the one value the db layer writes as NULL instead of dropping."""
    from scrapers.common import db
    row, _c, why = run.map_listing(_rec(run.page_labels(PAGE_DASH)))
    assert row, why
    assert row["street_width_m"] is db.AUTHORITATIVE_NULL


def test_unread_page_is_unknown_not_the_id():
    row, _c, why = run.map_listing(_rec(None))
    assert row, why
    assert row["street_width_m"] is None
    assert row["additional_info"].get("page_labels_read") is False


def test_no_page_means_no_labels():
    assert run.page_labels("") is None
    assert run.page_labels("<html>no table</html>") is None


def test_page_is_addressed_without_url_path(monkeypatch):
    """The live detail record has NO `url_path` (branch crawl 41181394867 read 0 of 952 pages:
    no_page_url x952). The page must be addressed by listing_path(), exactly like listing_url."""
    from scrapers.common.tests.test_reinvest_price_and_period import LAND_RENT_223
    rec = {k: v for k, v in LAND_RENT_223.items() if k != "url_path"}
    seen = []

    class _R:
        status_code = 200
        text = PAGE_50

    class _S:
        def get(self, url, **_kw):
            seen.append(url)
            return _R()

    got = run.fetch_page_labels(_S(), rec)
    assert seen == [f"{run.BASE}{run.listing_path(rec)}"], seen
    assert got and got["عرض الشارع"] == 50


def test_a_fraction_on_the_page_clears_the_old_value():
    """13256919: the page prints «عرض الشارع 3.56»; the old id table had put 18 there. A fraction is
    never rounded into the smallint column, and the stale 18 must not survive the page's answer."""
    from scrapers.common import db
    assert run.street_width_from_labels({"عرض الشارع": "3.56"}) is db.AUTHORITATIVE_NULL
    assert run.street_width_from_labels({"عرض الشارع": 20}) == 20
