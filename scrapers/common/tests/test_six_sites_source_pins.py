"""Owner 2026-10-19: «fix the ones we don't get a pin — every new listing gets the pin».

Six native-preview sites publish the ad's own pin on the page and no scraper read it. Each shape
below is the EXACT text measured on a live ad that day, so the regexes are proven against the real
source, not against a guess; and the wiring tests read each scraper's source to prove the pin is
written into additional_info, the key the index's generic branch reads
(test_source_pins_reach_the_index.py). No network.
Run: python -m pytest scrapers/common/tests/test_six_sites_source_pins.py -q
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scrapers.common.page_pin import (  # noqa: E402
    pin_from_html, pin_from_short_link, resolve_redirect, short_maps_link)

# ── the live shapes ────────────────────────────────────────────────────────────────────────────
NOFODH = ('… "address":{"@type":"PostalAddress"},"geo":{"@type":"GeoCoordinates","latitude":24.728956,'
          '"longitude":46.7436311},"url":"https://www.nofodh.sa/listings/612433" … '
          'selectorMap = new google.maps.Map(document.getElementById("map-selector"), {'
          ' center: { lat: 24.793809, lng: 46.7039 }, // Default location')
ABRALOSOL = '<a href="https://www.google.com/maps/place/25.452943695262,49.606221994409" target="_blank">الموقع</a>'
BOSSBIH = ('<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3605.28!2d49.63198218498713!3d25.361896383819893"></iframe>'
           '<a href="https://www.google.com/maps/place/25.357535239782,49.583245219722">الموقع</a>')
REINVEST_EMBED = '<iframe src="https://www.google.com/maps?q=24.81646,46.632262&amp;z=14&amp;output=embed">'
SAKAN = ('var has_latLng = true; var show_exact_location = true; function myMap() { var gmarkers = []; '
         'var latLng = new google.maps.LatLng(21.621892334251047,39.163360657531236); var mapOptions = {')
SAKAN_APPROX = SAKAN.replace("show_exact_location = true", "show_exact_location = false")
AQALEMHAJER = '<a href="https://maps.app.goo.gl/Qg3j1DUtCWPULM1ZA?g_st=ic">الموقع</a>'
AQALEMHAJER_FINAL = "https://www.google.com/maps?q=25.3152163,49.6193885&entry=gps&shh=CAE"


NOFODH_FRAME = ('<iframe class="position-relative h600" loading="lazy" src="https://maps.google.com/maps?q=24.562438,46.756979&amp;t=m&amp;z=14&amp;output=embed&amp;iwloc=near"></iframe>')


def test_nofodh_reads_the_maps_frame_never_the_office_geo_nor_the_default_centre():
    # the JSON-LD geo is the company office on EVERY page (2,556 ads landed on one point) → never read
    assert pin_from_html(NOFODH) == {}
    assert pin_from_html(NOFODH + NOFODH_FRAME) == {"latitude": 24.562438, "longitude": 46.756979}
    # the default centre alone must yield nothing — it is the same number on every ad
    assert pin_from_html("center: { lat: 24.793809, lng: 46.7039 }, // Default location") == {}


def test_maps_place_links():
    assert pin_from_html(ABRALOSOL) == {"latitude": 25.452943695262, "longitude": 49.606221994409}
    # bossbih: the «الموقع» link wins over the embed's map centre (the regex never reads !2d/!3d)
    assert pin_from_html(BOSSBIH) == {"latitude": 25.357535239782, "longitude": 49.583245219722}
    assert pin_from_html(REINVEST_EMBED) == {"latitude": 24.81646, "longitude": 46.632262}


def test_sakan_marker_only_when_exact():
    assert pin_from_html(SAKAN) == {"latitude": 21.621892334251047, "longitude": 39.163360657531236}
    assert pin_from_html(SAKAN_APPROX) == {}
    # no flag at all → the marker is not trusted either
    assert pin_from_html(SAKAN.replace("var show_exact_location = true; ", "")) == {}


def test_outside_ksa_and_garbage_rejected():
    assert pin_from_html('href="https://www.google.com/maps/place/51.5074,-0.1278"') == {}
    assert pin_from_html('href="https://www.google.com/maps/place/0.0000,0.0000"') == {}
    assert pin_from_html("") == {} and pin_from_html(None) == {}


def test_short_link_is_followed_not_guessed():
    assert short_maps_link(AQALEMHAJER) == "https://maps.app.goo.gl/Qg3j1DUtCWPULM1ZA"
    assert pin_from_short_link(short_maps_link(AQALEMHAJER), lambda u: AQALEMHAJER_FINAL) == {
        "latitude": 25.3152163, "longitude": 49.6193885}
    assert pin_from_short_link(short_maps_link(AQALEMHAJER), lambda u: None) == {}
    assert pin_from_short_link(short_maps_link(AQALEMHAJER), lambda u: (_ for _ in ()).throw(RuntimeError("down"))) == {}
    assert pin_from_short_link(None, lambda u: AQALEMHAJER_FINAL) == {}


class _Resp:
    def __init__(self, status, loc=None):
        self.status_code, self.headers = status, ({"location": loc} if loc else {})


class _Sess:
    def __init__(self, hops, final=None):
        self.hops, self.calls, self.final = hops, [], final

    def get(self, url, allow_redirects=False, timeout=20, proxies=None):
        self.calls.append(url)
        if allow_redirects:
            r = _Resp(200)
            r.url = self.final or url
            return r
        return self.hops.get(url, _Resp(200))


def test_resolve_redirect_falls_back_to_the_clients_own_follow():
    # the manual hop reads nothing (a 200 shell), so the client follows and reports the final URL
    s = _Sess({}, final="https://www.google.com/maps/place/25%C2%B018'N/@25.3152163,49.6193885,17z/data=x")
    assert resolve_redirect(s, "https://maps.app.goo.gl/y") == s.final
    assert pin_from_short_link("https://maps.app.goo.gl/y", lambda u: resolve_redirect(s, u)) == {
        "latitude": 25.3152163, "longitude": 49.6193885}
    # a manual hop that raises also falls back rather than failing the ad
    class _Boom(_Sess):
        def get(self, url, allow_redirects=False, timeout=20, proxies=None):
            if not allow_redirects:
                raise RuntimeError("no manual hops here")
            return super().get(url, allow_redirects, timeout)
    b = _Boom({}, final="https://maps.google.com?q=25.3152163,49.6193885&entry=gps")
    assert resolve_redirect(b, "https://maps.app.goo.gl/z") == b.final


def test_resolve_redirect_stops_at_the_maps_url_without_loading_it():
    s = _Sess({"https://maps.app.goo.gl/x": _Resp(302, "https://maps.google.com/?q=25.3152163,49.6193885&x=1"),
               "https://maps.google.com/?q=25.3152163,49.6193885&x=1": _Resp(302, "https://consent.google.com/…")})
    assert resolve_redirect(s, "https://maps.app.goo.gl/x") == "https://maps.google.com/?q=25.3152163,49.6193885&x=1"
    assert s.calls == ["https://maps.app.goo.gl/x"]          # never fetched Maps itself
    assert resolve_redirect(_Sess({}), "https://maps.app.goo.gl/dead") is None


# ── wiring: the pin lands in additional_info in each scraper ──────────────────────────────────
def _src(p: str) -> str:
    return (ROOT / "scrapers" / p / "run.py").read_text(encoding="utf-8")


def test_each_scraper_writes_the_pin_into_additional_info():
    assert 'out["pin"] = pin_from_html(page)' in _src("sakan") and '**(p.get("pin") or {}),' in _src("sakan")
    assert '"pin": pin_from_html(body) or pin_from_short_link(' in _src("abralosol") and '**(detail.get("pin") or {}),' in _src("abralosol")
    assert '"pin": pin_from_html(body),' in _src("nofodh") and '**(rec.get("pin") or {}),' in _src("nofodh")
    assert '"pin": pin_from_html(art) or pin_from_html(page_html),' in _src("bossbih") and '**(detail.get("pin") or {}),' in _src("bossbih")
    aq = _src("aqalemhajer")
    assert '"pin_link": short_maps_link(page_html),' in aq and 'pin_from_short_link(d["pin_link"], lambda u: resolve_redirect(s, u))' in aq
    assert '**(detail.get("pin") or {}),' in aq
    assert '**pin_dict(rec.get("latitude"), rec.get("longitude")),' in _src("reinvest")


def test_the_six_sites_are_on_the_border_map_meanwhile():
    data = (ROOT / "src" / "data" / "adPageData.ts").read_text(encoding="utf-8")
    for p in ("sakan", "abralosol", "nofodh", "bossbih", "aqalemhajer", "reinvest"):
        assert f"'{p}'" in data.split("DISTRICT_MAP_PLATFORMS")[1].split("];")[0]


def test_abralosol_and_bossbih_follow_a_short_link_too():
    # measured 2026-10-19: abralosol 7890 links its pin only as maps.app.goo.gl; the office sites share one template
    ab = _src("abralosol")
    assert 'pin_from_html(body) or pin_from_short_link(short_maps_link(body), lambda u: resolve_redirect(s, u))' in ab   # the ad article only (audit 2026-10-21)
    bo = _src("bossbih")
    assert 'd["pin"] = pin_from_short_link(short_maps_link(r.text), lambda u: resolve_redirect(s, u))' in bo


def test_a_consent_interstitial_still_yields_the_pin():
    # Google answers a datacenter address with consent.google.com and hides the Maps URL, encoded,
    # in `continue=`; the pair must still be read from it.
    consent = ("https://consent.google.com/m?continue=https%3A%2F%2Fwww.google.com%2Fmaps%3Fq%3D25.3152163"
               "%2C49.6193885%26entry%3Dgps&gl=US&m=0&pc=m&uxe=eomtm&hl=en")
    s = _Sess({"https://maps.app.goo.gl/c": _Resp(302, consent)})
    assert resolve_redirect(s, "https://maps.app.goo.gl/c") is not None
    assert pin_from_short_link("https://maps.app.goo.gl/c", lambda u: resolve_redirect(s, u)) == {
        "latitude": 25.3152163, "longitude": 49.6193885}
    # and a consent page reached only through the client's own follow
    s2 = _Sess({}, final=consent)
    assert pin_from_short_link("https://maps.app.goo.gl/d", lambda u: resolve_redirect(s2, u)) == {
        "latitude": 25.3152163, "longitude": 49.6193885}


def test_a_200_interstitial_names_the_destination_in_its_body():
    # Measured on the GitHub runner 2026-10-19: goo.gl → HTTP 200, no Location, the page body
    # carries the Maps URL (here as a consent form's encoded continue= and as an escaped link).
    body = ('<html><form action="https://consent.google.com/save"><input name="continue" '
            'value="https://www.google.com/maps?q=25.3152163%2C49.6193885&amp;entry=gps"></form>'
            '<a href="https://www.google.com/maps?q=25.3152163,49.6193885&amp;entry=gps">open</a></html>')
    r = _Resp(200)
    r.text = body
    s = _Sess({"https://maps.app.goo.gl/e": r})
    assert pin_from_short_link("https://maps.app.goo.gl/e", lambda u: resolve_redirect(s, u)) == {
        "latitude": 25.3152163, "longitude": 49.6193885}
    # a 200 body with no Maps URL at all still yields nothing (never a geocode, never a guess)
    r2 = _Resp(200)
    r2.text = "<html>nothing here</html>"
    s2 = _Sess({"https://maps.app.goo.gl/f": r2})
    assert pin_from_short_link("https://maps.app.goo.gl/f", lambda u: resolve_redirect(s2, u)) == {}


def test_the_browser_hop_runs_last_and_only_where_the_job_installed_chromium(monkeypatch):
    # owner 2026-10-20 («get the 3 small sites»): when both HTTP hops read nothing, a headless
    # Chromium opens the short link — but only under PIN_BROWSER_HOP=1 (matrix.browser), and never
    # when an HTTP hop already found the pair.
    import scrapers.common.page_pin as pp
    calls = []
    final = "https://www.google.com/maps/place/x/@25.3152163,49.6193885,17z/data=y"

    def fake_hop(url, wait_s=15.0):
        calls.append(url)
        return final
    monkeypatch.setattr(pp, "_browser_hop", fake_hop)
    monkeypatch.delenv("PIN_BROWSER_HOP", raising=False)
    assert resolve_redirect(_Sess({}), "https://maps.app.goo.gl/dead") is None
    assert calls == []                                   # not installed here → not tried
    monkeypatch.setenv("PIN_BROWSER_HOP", "1")
    assert resolve_redirect(_Sess({}), "https://maps.app.goo.gl/dead") == final
    assert calls == ["https://maps.app.goo.gl/dead"]     # the ORIGINAL short link, not a hop's result
    assert pin_from_short_link("https://maps.app.goo.gl/dead", lambda u: resolve_redirect(_Sess({}), u)) == {
        "latitude": 25.3152163, "longitude": 49.6193885}
    s = _Sess({"https://maps.app.goo.gl/p": _Resp(302, "https://maps.google.com?q=25.3152163,49.6193885&entry=gps")})
    n = len(calls)
    assert resolve_redirect(s, "https://maps.app.goo.gl/p") is not None
    assert len(calls) == n                               # HTTP hop found it → browser never opened
    # the workflow installs Chromium and sets the flag for exactly the three office sites
    wf = (ROOT / ".github" / "workflows" / "small-sources-sync.yml").read_text(encoding="utf-8")
    assert "python -m playwright install --with-deps chromium" in wf
    assert "PIN_BROWSER_HOP: ${{ matrix.browser && '1' || '' }}" in wf
    for site in ("abralosol", "bossbih", "aqalemhajer"):
        line = next(l for l in wf.splitlines() if f"source: {site}," in l)
        assert "browser: true" in line, site


def test_the_short_link_hop_uses_the_proxy_only_when_the_job_has_one(monkeypatch):
    # owner 2026-10-19 («ok use the proxy»): only the goo.gl hop, only when WASALT_PROXY_URL is set
    class _Cap(_Sess):
        def __init__(self, hops):
            super().__init__(hops)
            self.kw = []

        def get(self, url, allow_redirects=False, timeout=20, proxies=None):
            self.kw.append(proxies)
            return super().get(url, allow_redirects, timeout)
    monkeypatch.setenv("WASALT_PROXY_URL", "http://user:pw@gw.example:823")
    s = _Cap({"https://maps.app.goo.gl/p": _Resp(302, "https://maps.google.com?q=25.3152163,49.6193885&entry=gps")})
    assert resolve_redirect(s, "https://maps.app.goo.gl/p") is not None
    assert s.kw == [{"http": "http://user:pw@gw.example:823", "https": "http://user:pw@gw.example:823"}]
    monkeypatch.delenv("WASALT_PROXY_URL")
    s2 = _Cap({"https://maps.app.goo.gl/p": _Resp(302, "https://maps.google.com?q=25.3152163,49.6193885&entry=gps")})
    assert resolve_redirect(s2, "https://maps.app.goo.gl/p") is not None
    assert s2.kw == [None]
