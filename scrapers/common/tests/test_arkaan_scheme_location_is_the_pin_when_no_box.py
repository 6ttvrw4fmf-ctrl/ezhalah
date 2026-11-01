"""arkaan: a plot ad with no map box still publishes its subdivision's location (owner 2026-10-20).

Sampled 2026-10-20 from the 359 arkaan ads the app served with no pin: 25 of 25 carried the
«لوكيشن المخطط» button with a maps?q= pair and no #box-map (property/1758 → 25.371765,49.594828).
When the exact box exists it wins (property/1267: box 25.342466,49.744928, scheme 25.352035,49.742286);
«الاتجاهات» repeats the box pair and is never a pin on its own.
"""
import scrapers.arkaan.run as R

BOX = '<div id="box-map" class="x" data-map-url="https://www.google.com/maps?q=25.342466,49.744928&z=16"></div>'
DIRS = ('<a class="btn details-soft-action-btn" href="https://www.google.com/maps?q=25.342466,49.744928&amp;z=16" '
        'target="_blank"> <i class="bi bi-signpost"></i> الاتجاهات </a>')
SCHEME = ('<a class="btn details-soft-contact-btn details-soft-action-btn fw-bold" '
          'href="https://www.google.com/maps?q=25.371765,49.594828&amp;z=16" target="_blank" rel="noopener"> '
          '<i class="bi bi-geo-alt me-2"></i> لوكيشن المخطط </a>')
PLAN = ('<a class="btn details-soft-action-btn" href="https://files.example/plan.jpg" target="_blank">'
        '<i class="bi bi-image me-2"></i> صورة المخطط </a>')


def _pair(html):
    co = R._COORDS.findall(html)
    if not co:
        m = R._SCHEME.search(html)
        co = [(m.group(1), m.group(2))] if m else []
    return co[0] if co else None


def test_box_wins_over_the_scheme_button():
    assert _pair(BOX + DIRS + SCHEME) == ("25.342466", "49.744928")


def test_scheme_button_is_the_pin_when_there_is_no_box():
    assert _pair(PLAN + SCHEME) == ("25.371765", "49.594828")


def test_directions_button_alone_is_not_a_pin():
    assert _pair(PLAN + DIRS) is None
    assert _pair(PLAN) is None


def test_fetch_detail_reads_the_scheme_pair(monkeypatch):
    monkeypatch.setattr(R, "_get", lambda s, u: (200, "<html><body>" + PLAN + SCHEME + "</body></html>"))
    d = R.fetch_detail(None, "1758")
    assert (d["lat"], d["lng"]) == (25.371765, 49.594828)
    monkeypatch.setattr(R, "_get", lambda s, u: (200, "<html><body>" + BOX + DIRS + SCHEME + "</body></html>"))
    d = R.fetch_detail(None, "1267")
    assert (d["lat"], d["lng"]) == (25.342466, 49.744928)
    monkeypatch.setattr(R, "_get", lambda s, u: (200, "<html><body>" + PLAN + DIRS + "</body></html>"))
    assert R.fetch_detail(None, "x")["lat"] is None
