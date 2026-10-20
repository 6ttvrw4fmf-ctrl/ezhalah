"""Pins the real-browser border sweep found (owner 2026-10-20 night: «most of them have a real pin»).

Each shape below is copied from a live page of that site: therc's description link, alsaedan's
«افتح الموقع في خرائط جوجل», shomou's degrees-minutes-seconds place link, nawafeth's maps?q=, wadod's embed.
"""
from pathlib import Path

from scrapers.common.page_pin import pin_from_embed, pin_from_html, pin_from_page

ROOT = Path(__file__).resolve().parents[3]


def test_therc_description_link():
    page = '<meta name="description" content="فيلا للإيجار – الرياض / حي المهدية الموقع : https://maps.google.com/?q=24.639000,46.491997 المساحة">'
    assert pin_from_page(page) == {"latitude": 24.639, "longitude": 46.491997}


def test_alsaedan_open_in_google_maps_link():
    page = '<a class="aup-simc" href="https://www.google.com/maps/search/?api=1&query=24.8166491,46.8062586"> افتح الموقع في خرائط جوجل </a>'
    assert pin_from_html(page) == {"latitude": 24.8166491, "longitude": 46.8062586}


def test_shomou_degrees_minutes_seconds_place_link():
    art = "الموقع <br /> https://www.google.com/maps/place/25%C2%B026&#039;36.7%22N+49%C2%B034&#039;20.7%22E"
    pin = pin_from_html(art)
    assert abs(pin["latitude"] - 25.4435278) < 1e-6 and abs(pin["longitude"] - 49.5724167) < 1e-6
    assert pin_from_html("maps/place/25°26'36.7\"S+49°34'20.7\"E") == {}       # not Saudi → rejected


def test_nawafeth_maps_q_link():
    assert pin_from_html('<a href="https://maps.google.com/maps?q=27.02205,49.5732&z=15">') == {"latitude": 27.02205, "longitude": 49.5732}


def test_wadod_embed_centre_but_not_by_default():
    frame = '<iframe src="https://www.google.com/maps/embed?pb=!1m17!1m12!1m3!1d3619.55!2d46.6229149!3d24.8792054!2m3!1f0"></iframe>'
    assert pin_from_embed(frame) == {"latitude": 24.8792054, "longitude": 46.6229149}
    assert pin_from_html(frame) == {}          # the embed is NOT a generic pin shape (bossbih: the office)


def test_wiring():
    t = lambda p: (ROOT / "scrapers" / p / "run.py").read_text(encoding="utf-8")
    assert '"additional_info": {"rows": extra, **pin_from_page(page)},' in t("therc")
    assert 'pins[url] = pin_from_html(page)' in t("alsaedan")
    assert '"pin": pin_from_page(art),' in t("shomou") and '**(d.get("pin") or {}),' in t("shomou")
    assert '**(_own_pin(page) or pin_from_html(page)),' in t("nawafeth")
    assert '"pin": pin_from_html(page_html) or pin_from_embed(page_html)}' in t("wadod")
    wf = (ROOT / ".github" / "workflows" / "small-sources-sync.yml").read_text(encoding="utf-8")
    for site in ("therc", "shomou"):
        assert "browser: true" in next(l for l in wf.splitlines() if f"source: {site}," in l), site


def test_nawafeth_reads_the_pin_its_own_script_draws():
    import scrapers.nawafeth.run as NW
    page = "<script>var propertyLat = parseFloat('27.0196');\r\n var propertyLng = parseFloat('49.5732');</script>"
    assert NW._own_pin(page) == {"latitude": 27.0196, "longitude": 49.5732}
    assert NW._own_pin("<script>no map</script>") == {}
