"""ialqarawi / aqarcity / muktamel: the ad's own pin, read where the site publishes it (owner 2026-10-20).

«First let's investigate those ones»: 5 real pin-less ads per site were opened that day —
  · ialqarawi (2,609 pin-less): «google.com/maps/embed/v1/place?q=26.119079,43.955941» on 5/5
  · aqarcity (2,245, 0 served pins since the 2026-09 redesign dropped the JSON-LD geo):
    «google.com/maps?q=21.605451434628506%2C39.16462806529772» on 5/5
  · muktamel (4,077): NUXT offer.location {lat,lng}; offer.agency.location is the office — never read.
"""
import re
from pathlib import Path

import scrapers.ialqarawi.run as IQ
from scrapers.common.page_pin import pin_from_html
from scrapers.common.source_pin import pin_dict

ROOT = Path(__file__).resolve().parents[3]


def test_ialqarawi_parse_detail_carries_the_embed_pin():
    page = ('<dd class="col-sm-3"><strong>رقم العقار</strong></dd><dd class="col-sm-9">1892</dd>'
            '<h3>أرض للبيع</h3>'
            '<iframe src="https://www.google.com/maps/embed/v1/place?q=26.119079,43.955941&key=AIza"></iframe>'
            '<a href="https://maps.google.com/maps?daddr=26.119079,43.955941&amp;ll=">الاتجاهات</a>')
    d = IQ.parse_detail(page)
    assert d["pin"] == {"latitude": 26.119079, "longitude": 43.955941}
    assert IQ.parse_detail(page.replace("26.119079,43.955941", "")) ["pin"] == {}
    assert IQ.parse_detail("<html>homepage</html>") == {}          # an unknown id is still a MISS


def test_aqarcity_maps_link_with_an_encoded_comma_is_the_pin():
    body = '<a href="https://www.google.com/maps?q=21.605451434628506%2C39.16462806529772" target="_blank">'
    assert pin_from_html(body) == {"latitude": 21.605451434628506, "longitude": 39.16462806529772}
    src = (ROOT / "scrapers" / "aqarcity" / "run.py").read_text(encoding="utf-8")
    assert 'page_pin = pin_from_html(body) if not geo.get("latitude") else {}' in src
    assert '"latitude": geo.get("latitude") or page_pin.get("latitude")' in src


def test_muktamel_reads_offer_location_not_the_agency_office():
    offer = {"location": {"lat": 24.841171549022395, "lng": 46.89082470062314},
             "agency": {"location": {"lat": 24.6820444498082, "lng": 46.69527058947882}}}
    loc = offer.get("location") or {}
    assert pin_dict(loc.get("lat"), loc.get("lng")) == {"latitude": 24.841171549022395, "longitude": 46.89082470062314}
    assert pin_dict(None, None) == {}
    src = (ROOT / "scrapers" / "muktamel" / "run.py").read_text(encoding="utf-8")
    assert '_loc = offer.get("location") or {}' in src
    assert re.search(r'info: dict\[str, Any\] = \{\s*\*\*pin_dict\(_loc\.get\("lat"\)', src)
    assert 'agency.get("location")' not in src and '["agency"]["location"]' not in src


def test_ialqarawi_row_spreads_the_pin_into_additional_info():
    src = (ROOT / "scrapers" / "ialqarawi" / "run.py").read_text(encoding="utf-8")
    assert '**(detail.get("pin") or {}),' in src


def test_ialqarawi_follows_a_short_link_when_the_page_has_no_pair(monkeypatch):
    # owner 2026-10-20 night: 3 of 25 ialqarawi border ads carry only a maps.app.goo.gl link
    import scrapers.common.page_pin as PP
    monkeypatch.setattr(PP, "resolve_redirect", lambda s, u: "https://www.google.com/maps/place/26.3301,43.9712/data=x")
    page = ('<dd class="col-sm-3"><strong>رقم العقار</strong></dd><dd class="col-sm-9">3360</dd>'
            '<p>الموقع https://maps.app.goo.gl/AbCdEf123</p>')
    assert IQ.parse_detail(page)["pin"] == {"latitude": 26.3301, "longitude": 43.9712}


def test_a_space_after_q_is_still_the_pin():
    # 2026-10-25 (#837, re-read 40074411510): an ialqarawi embed «place?q= 24.49…,43.97…» (a space after «q=»)
    # left the ad pin-less; «%20» and «+» are the same space URL-encoded.
    from scrapers.common.page_pin import pin_from_html
    for q in (" 24.491234,43.971234", "%2024.491234,43.971234", "+24.491234,43.971234"):
        got = pin_from_html(f'<iframe src="https://www.google.com/maps/embed/v1/place?q={q}&key=AIza"></iframe>')
        assert got == {"latitude": 24.491234, "longitude": 43.971234}, q
