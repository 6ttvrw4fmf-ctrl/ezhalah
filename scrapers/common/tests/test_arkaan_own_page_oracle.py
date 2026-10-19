"""arkaan: only the ad's OWN page hides it (2026-10-06).

arkaan's crawler called prune_unseen WITHOUT verify_gone, so an ad was hidden after three crawls it
was missing from: absence alone (open P1 unknown_treated_as_dead, LISTING_LIVENESS.md §1). Measured
from CI the same day (oracle-feasibility-probe run 37456672928): 12/12 removed ads answer HTTP 410 at
/property/{id}, 12/12 live ads answer 200. These tests EXECUTE the oracle against stub responses.
"""
from __future__ import annotations

from scrapers.arkaan import run

LIVE = ('<html><script type="application/ld+json">{"@graph":[{"@type":"RealEstateListing",'
        '"name":"ارض للبيع"}]}</script></html>')


class _R:
    def __init__(self, status, text="", url=""):
        self.status_code, self.text, self.url = status, text, url


class _S:
    def __init__(self, answers):
        self.answers = answers

    def get(self, url, **_k):
        st, body = self.answers.get(url, (500, ""))
        return _R(st, body, url)


def _oracle(monkeypatch, answers, control="AK1"):
    monkeypatch.setattr(run, "_session", lambda: _S(answers))
    monkeypatch.setattr("scrapers.common.http_liveness.time.sleep", lambda *_: None)
    return run._make_verify_gone({"ad_number": control} if control else None)


U = run.BASE + "/property/"


def test_410_with_a_live_control_is_gone(monkeypatch):
    vg = _oracle(monkeypatch, {U + "1": (200, LIVE), U + "9": (410, "<html>410 Gone</html>")})
    assert vg("AK9")[0] == "gone"


def test_live_page_is_live(monkeypatch):
    vg = _oracle(monkeypatch, {U + "1": (200, LIVE), U + "9": (200, LIVE)})
    assert vg("AK9")[0] == "live"


def test_410_while_the_control_fails_hides_nothing(monkeypatch):
    vg = _oracle(monkeypatch, {U + "1": (403, ""), U + "9": (410, "<html>410 Gone</html>")})
    assert vg("AK9")[0] == "unknown"


def test_a_block_or_an_empty_200_is_unknown(monkeypatch):
    vg = _oracle(monkeypatch, {U + "1": (200, LIVE), U + "8": (403, ""), U + "9": (200, "<html></html>")})
    assert vg("AK8")[0] == "unknown" and vg("AK9")[0] == "unknown"


def test_the_crawl_hands_the_oracle_to_prune_unseen(monkeypatch):
    calls = []
    monkeypatch.setattr(run, "crawl", lambda limit=0, dry_run=False: (
        [{"ad_number": "AK1"}], [], 1))
    monkeypatch.setattr(run.db, "begin_run", lambda *_a, **_k: 1)
    monkeypatch.setattr(run.db, "end_run", lambda *_a, **_k: True)
    monkeypatch.setattr(run.db, "upsert_arkaan_residential_batch", lambda *_a, **_k: None)
    monkeypatch.setattr(run.db, "retire_superseded_siblings", lambda **_k: 0)
    monkeypatch.setattr(run.db, "prune_unseen",
                        lambda tbl, seen, source=None, verify_gone=None, **_k: calls.append(verify_gone) or 0)
    monkeypatch.setattr("sys.argv", ["run", "--type", "all"])
    assert run.main() == 0
    assert len(calls) == 2 and all(callable(v) for v in calls)
