"""sirdab and vmksa are scored by a reader that can SEE a dead ad, never by HTTP status (2026-11-09).

Both are Next.js sites that answer 200 for an ad that cannot exist, so the 09:05 dead-visible score voided
them every night as «status-only» (backlog 1627: sirdab 564 shown, vmksa 199, never measured). Executes the
real readers against fake pages; no network.
"""
import types

from scrapers.common import lifecycle_spot_check as sc
from scrapers.common import dead_visible_score as dv
from scrapers.sirdab import run as sd

RID = "ff01d58e-6161-48d2-9b03-c4f3538bd869"
CTL = {"ad_number": "SRD" + RID, "listing_url": "https://marketplace.sirdab.co/ar/ads/9441f837-387b-4a6a-a4a5-6b07a7ddbbf3"}
GONE_RID = "11111111-2222-3333-4444-555555555555"
URLS = {"SRD" + RID: CTL["listing_url"], "SRD" + GONE_RID: "https://marketplace.sirdab.co/ar/ads/goneSlug12345"}


class _Resp:
    def __init__(self, status, text, url):
        self.status_code, self.text, self.url = status, text, url


def _session(pages):
    return types.SimpleNamespace(get=lambda url, **k: _Resp(*pages[url], url))


def _reader(monkeypatch, pages):
    monkeypatch.setattr(sd.time, "sleep", lambda *_: None)
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda *_: None)
    return sd._make_reader(CTL, url_for=URLS.get, session=_session(pages))


NEG = sd._negative_url(CTL["listing_url"])
NOT_FOUND = '<script>self.__next_f.push([1,"{\\"digest\\":\\"NEXT_NOT_FOUND\\"}"])</script>'


def test_live_page_with_own_record_id_is_live_and_not_found_page_is_gone(monkeypatch):
    pages = {NEG: (200, NOT_FOUND), CTL["listing_url"]: (200, f'..."id":"{RID}"...'),
             URLS["SRD" + GONE_RID]: (200, NOT_FOUND)}
    read = _reader(monkeypatch, pages)
    assert read("SRD" + RID)[0] == "live"
    assert read("SRD" + GONE_RID)[0] == "gone"


def test_a_shell_without_the_ads_id_or_marker_is_no_verdict(monkeypatch):
    pages = {NEG: (200, NOT_FOUND), CTL["listing_url"]: (200, f'"id":"{RID}"'),
             URLS["SRD" + GONE_RID]: (200, "<html>app shell</html>")}
    assert _reader(monkeypatch, pages)("SRD" + GONE_RID)[0] == "unknown"


def test_a_reader_that_cannot_see_death_says_nothing(monkeypatch):
    # the impossible ad reads 200 like a live page (the status-only blindness): every verdict is UNKNOWN
    pages = {NEG: (200, "<html>shell</html>"), CTL["listing_url"]: (200, f'"id":"{RID}"'),
             URLS["SRD" + GONE_RID]: (200, NOT_FOUND)}
    read = _reader(monkeypatch, pages)
    assert read("SRD" + RID)[0] == "unknown"
    assert read("SRD" + GONE_RID)[0] == "unknown"


def test_a_gone_reading_is_withheld_when_the_live_control_does_not_read_live(monkeypatch):
    pages = {NEG: (200, NOT_FOUND), CTL["listing_url"]: (200, "<html>shell</html>"),
             URLS["SRD" + GONE_RID]: (404, "<html>Page not found</html>")}
    v, why = _reader(monkeypatch, pages)("SRD" + GONE_RID)
    assert v == "unknown" and "withheld" in why


def test_both_sites_are_scored_and_spot_checked_by_their_oracle_not_status(monkeypatch):
    from scrapers.common import fleet_liveness as FL
    monkeypatch.setattr(FL, "oracle_for", lambda spec, control: (lambda ad: ("gone", "fake")))
    for p in ("sirdab", "vmksa"):
        assert sc.pick_reader(p, None, None)[0] == "site-oracle", p
    monkeypatch.setattr(dv, "oracle_for", lambda spec, control: (lambda ad: ("gone", "fake")))
    for p in ("sirdab", "vmksa"):
        assert dv.reader_for(p, None)[0] == "site-oracle", p
