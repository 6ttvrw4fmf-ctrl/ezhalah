"""hajer: one WordPress post is ONE listing (2026-11-04, card_link_identity:dupe:hajer, alert 1817).

Post 1512 publishes «رقم الإعلان» 1168 and is held as HJ1168. A degraded read of the same page (no
field table) used to mint HJ1512 — «Residential Land», no price — at the SAME URL, and the liveness
probe then stamped that phantom alive from HJ1168's page, so it could never age out. Two halves:
  1. map_listing refuses a page whose field table did not render (no second identity is minted);
  2. the probe's LIVE answer must name THIS ad; GONE is unchanged.
"""
from __future__ import annotations

import scrapers.hajer.run as R

_FIELD = ('<li><strong class="rem-single-field-title">{k}</strong>'
          '<span class="rem-single-field-value">{v}</span></li>')


def _page(postid: int, ad_no: str | None, badge: str = "") -> str:
    fields = ""
    if ad_no is not None:
        fields += _FIELD.format(k="رقم الإعلان", v=ad_no)
    fields += _FIELD.format(k="نوع العقار", v="دبلكس") + _FIELD.format(k="غرض العقار", v="بيع")
    fields += _FIELD.format(k="المدينة", v="الأحساء") + _FIELD.format(k="السعر", v="880,000 ر.س")
    return (f'<html><body class="rtl single single-rem_property postid-{postid}">{badge}'
            f'<article id="post-{postid}"><ul>{fields}</ul></article></body></html>')


_DEGRADED = '<html><body class="error403">Access denied</body></html>'
_POST = {"id": 1512, "link": "https://hajerhouses.com/property/x/", "title": {"rendered": "دبلكسات"}}


def test_a_page_without_its_field_table_mints_no_row():
    row, _cat, gone = R.map_listing(_POST, _DEGRADED)
    assert row is None and gone is False


def test_a_rendered_page_still_maps_under_its_own_ad_number(monkeypatch):
    monkeypatch.setattr(R, "to_catalog", lambda city_ar, region_hint=None: (1, 1))
    row, _cat, _gone = R.map_listing(_POST, _page(1512, "1168"))
    assert row is not None and row["ad_number"] == "HJ1168"


def test_live_needs_the_page_to_name_this_ad():
    page = _page(1512, "1168")
    assert R._signal_for("HJ1168")(200, page, False) == "live"
    assert R._signal_for("HJ1512")(200, page, False) is None      # the phantom: not its page


def test_post_id_is_the_identity_only_when_no_ad_number_is_published():
    page = _page(1435, None)
    assert R._signal_for("HJ1435")(200, page, False) == "live"
    assert R._signal_for("HJ9999")(200, page, False) is None


def test_gone_and_no_opinion_are_unchanged():
    sold = _page(1512, "1168", '<span class="property-status-badge status-sold">مباع</span>')
    assert R._signal_for("HJ1168")(200, sold, False) == "gone"
    assert R._signal_for("HJ1168")(404, _page(1512, "1168"), False) is None
    assert R._signal_for("HJ1168")(200, _page(1512, "1168"), True) is None


def test_the_probe_the_crawl_and_the_fleet_call_is_the_bound_one(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda s: None)
    monkeypatch.setattr(R._probe, "url_for", lambda ad: "https://hajerhouses.com/property/x/")
    monkeypatch.setattr(R._probe, "fetch", lambda url: (200, _page(1512, "1168"), False))
    assert R._probe.verify_gone("HJ1168")[0] == "live"
    assert R._probe.verify_gone("HJ1512")[0] == "unknown"
