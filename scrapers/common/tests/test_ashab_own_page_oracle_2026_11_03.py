"""ashab retires a row on its OWN page's word, never on absence (2026-11-03).

Measured live: ASB490139 is still on the list but its own badge reads «محجوز» (the crawl refuses it, so it
could never be re-seen); ASB523764-U1796..1798's unit pages answer 200 «متاح» while their parent ad
/properties/1211 answers 404. The 404-only default reader held both for weeks (missing_count 23..25).
"""
import pytest

from scrapers.ashab import run


def page(deal, status):
    return (f'<div id="page-title"><span class="badge">{deal}</span><span class="badge">{status}</span>'
            '<b class="d-flex a">t</b><div id="gallery-carousel"></div></div>')


@pytest.mark.parametrize("status", ["محجوز", "مباع", "مؤجر"])
def test_closed_badge_on_its_own_page_is_gone(status):
    assert run._own_signal(200, page("بيع", status), False) == "gone"


def test_available_is_live_and_unknowns_stay_unknown():
    assert run._own_signal(200, page("بيع", "متاح"), False) == "live"
    assert run._own_signal(404, "", False) == "gone"
    assert run._own_signal(200, page("بيع", "متاح جزئي"), False) is None
    assert run._own_signal(200, page("بيع", "محجوز"), True) is None      # a redirect is not this ad
    assert run._own_signal(403, page("بيع", "محجوز"), False) is None


def _probe(monkeypatch, answers):
    monkeypatch.setattr(run, "_url_of", lambda ad: answers["url"])
    monkeypatch.setattr(run, "_session", lambda: object())
    monkeypatch.setattr(run.LivenessProbe, "fetch", lambda self, url: answers[url])
    monkeypatch.setattr(run.time, "sleep", lambda *_: None)


U = "https://ashab.sa/properties/1211/unit/1798"
P = "https://ashab.sa/properties/1211"


def test_unit_of_a_deleted_parent_ad_is_gone(monkeypatch):
    _probe(monkeypatch, {"url": U, U: (200, page("بيع", "متاح"), False), P: (404, "nf", False)})
    v, why = run._verify_gone("ASB523764-U1798")
    assert v == "gone" and "parent ad" in why


def test_unit_of_a_live_parent_is_live(monkeypatch):
    _probe(monkeypatch, {"url": U, U: (200, page("بيع", "متاح"), False), P: (200, page("بيع", "متاح"), False)})
    assert run._verify_gone("ASB523764-U1798")[0] == "live"


def test_parent_blocked_is_unknown_never_gone(monkeypatch):
    _probe(monkeypatch, {"url": U, U: (200, page("بيع", "متاح"), False), P: (403, "denied", False)})
    assert run._verify_gone("ASB523764-U1798")[0] == "unknown"


def test_no_stored_url_is_unknown(monkeypatch):
    _probe(monkeypatch, {"url": None})
    assert run._verify_gone("ASB1")[0] == "unknown"
