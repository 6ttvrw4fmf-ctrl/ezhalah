"""thousand / erapulse / goldendeal / opensooq: the ad's own pin, read where the site publishes it
(owner 2026-10-20, «first let's investigate those ones» — 5 real pin-less ads per site opened):
  · thousand  — «maps.google.com/maps?q=24.813389,46.6343126&output=embed» frame (5/5; 109 ads)
  · erapulse  — API item latitude/longitude as strings "26.3533274","43.9774966" (5/5; 64 ads)
  · goldendeal — API latitude null, description links «maps.app.goo.gl/…» (5/5; 184 ads) → the hop
  · opensooq  — SERP JSON has none; the ad page prints «maps/search/?api=1&query=17.053362,47.076832»
"""
from pathlib import Path

import scrapers.goldendeal.run as GD
import scrapers.thousand.run as TH
from scrapers.common.page_pin import pin_from_html
from scrapers.common.source_pin import pin_dict

ROOT = Path(__file__).resolve().parents[3]


def test_thousand_detail_carries_the_frame_pin():
    page = '<h1>شقة</h1><iframe src="https://maps.google.com/maps?q=24.813389,46.6343126&amp;output=embed&amp;z=16"></iframe>'
    assert TH.parse_detail(page)["pin"] == {"latitude": 24.813389, "longitude": 46.6343126}
    assert TH.parse_detail("<h1>شقة</h1>")["pin"] == {}
    src = (ROOT / "scrapers" / "thousand" / "run.py").read_text(encoding="utf-8")
    assert '**(detail.get("pin") or {}),' in src


def test_erapulse_string_coordinates_become_the_pin():
    assert pin_dict("26.3533274", "43.9774966") == {"latitude": 26.3533274, "longitude": 43.9774966}
    src = (ROOT / "scrapers" / "erapulse" / "run.py").read_text(encoding="utf-8")
    assert '**pin_dict(p.get("latitude"), p.get("longitude")),' in src


def test_goldendeal_short_link_in_the_description_is_followed(monkeypatch):
    hops = []
    monkeypatch.setattr(GD, "resolve_redirect", lambda s, u: (hops.append(u), "https://maps.google.com/?q=25.3152163,49.6193885&entry=gps")[1])
    L = {"id": 54192, "latitude": None, "longitude": None,
         "description": '<a href="https://maps.app.goo.gl/koSyLPSEfYusvUgKA?g_st=ic">map</a>'}   # as json.loads hands it over
    assert GD._short_link_pin(L) == {"latitude": 25.3152163, "longitude": 49.6193885}
    assert hops == ["https://maps.app.goo.gl/koSyLPSEfYusvUgKA"]
    assert GD._short_link_pin({"id": 1, "description": "no link"}) == {}
    src = (ROOT / "scrapers" / "goldendeal" / "run.py").read_text(encoding="utf-8")
    assert '**({} if _float(L.get("latitude")) is not None else _short_link_pin(L)),' in src   # the API pin wins
    wf = (ROOT / ".github" / "workflows" / "small-sources-sync.yml").read_text(encoding="utf-8")
    line = next(l for l in wf.splitlines() if "source: goldendeal," in l)
    assert "browser: true" in line                                                            # the Chromium hop runs for it


def test_opensooq_ad_page_query_link_is_the_pin():
    page = '<a href="https://www.google.com/maps/search/?api=1&amp;query=17.053362,47.076832&amp;zoom=15">الموقع</a>'
    assert pin_from_html(page) == {"latitude": 17.053362, "longitude": 47.076832}
    src = (ROOT / "scrapers" / "opensooq" / "run.py").read_text(encoding="utf-8")
    assert 'pin = _page_pin(s, x["id"]' in src and 'return pin_from_html(r.text) if r.status_code == 200 else {}' in src
