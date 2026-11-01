"""abralosol: only the ad's OWN page hides it (2026-10-07).

prune_unseen ran WITHOUT verify_gone, so an ad missing from three crawls was hidden with no reading
of its own page (P1 unknown_treated_as_dead; 1 hide on 2026-10-07 05:00 UTC with no GONE row). The
crawl already reads a removed ad's own /{nid} as 404/410. These tests EXECUTE the oracle.
"""
from __future__ import annotations

from scrapers.abralosol import run

LIVE = '<html><article class="node" data-history-node-id="{nid}"><h1>شقة</h1></article></html>'


class _R:
    def __init__(self, status, text="", url=""):
        self.status_code, self.text, self.url = status, text, url


class _S:
    def __init__(self, answers):
        self.answers = answers

    def get(self, url, **_k):
        st, body = self.answers.get(url, (500, ""))
        return _R(st, body, url)


def _oracle(monkeypatch, answers, control="ABR1"):
    monkeypatch.setattr(run, "_session", lambda: _S(answers))
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda *_: None)
    return run._make_verify_gone({"ad_number": control} if control else None)


U = run.BASE + "/"


def test_404_with_a_live_control_is_gone(monkeypatch):
    vg = _oracle(monkeypatch, {U + "1": (200, LIVE.format(nid=1)), U + "9": (404, "<html>404</html>")})
    assert vg("ABR9")[0] == "gone"


def test_live_page_is_live(monkeypatch):
    vg = _oracle(monkeypatch, {U + "1": (200, LIVE.format(nid=1)), U + "9": (200, LIVE.format(nid=9))})
    assert vg("ABR9")[0] == "live"


def test_404_while_the_control_fails_hides_nothing(monkeypatch):
    vg = _oracle(monkeypatch, {U + "1": (403, ""), U + "9": (410, "<html>410</html>")})
    assert vg("ABR9")[0] == "unknown"


def test_no_control_hides_nothing(monkeypatch):
    vg = _oracle(monkeypatch, {U + "9": (404, "")}, control=None)
    assert vg("ABR9")[0] == "unknown"


def test_a_block_or_an_empty_200_is_unknown(monkeypatch):
    vg = _oracle(monkeypatch, {U + "1": (200, LIVE.format(nid=1)), U + "8": (403, ""),
                               U + "9": (200, "<html></html>")})
    assert vg("ABR8")[0] == "unknown" and vg("ABR9")[0] == "unknown"


def test_the_crawl_hands_the_oracle_to_prune_unseen():
    src = open(run.__file__, encoding="utf-8").read()
    assert "verify_gone=verify_gone)" in src
    assert "nn = db.prune_unseen(tbl, {r[\"ad_number\"] for r in rows_seen}, source=SOURCE)\n" not in src
