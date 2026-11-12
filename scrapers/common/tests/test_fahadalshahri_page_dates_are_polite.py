"""fahadalshahri's product-page reads (posting dates, 2026-11-10) are polite and honest.

CodeRabbit review of PR #11606, three findings, all held here against scrapers/fahadalshahri/run.py add_page_dates():
  1. at most one request per second to the product pages;
  2. a failed page read is counted by reason in the run notes, never swallowed;
  3. a bot check (the site's real reCAPTCHA «Bot Verification» 403, saved in testdata) stops the page reads for the
     rest of the run — never crossed, never retried on the next product.
"""
import os

from scrapers.fahadalshahri import run as m

_TD = os.path.join(os.path.dirname(__file__), "..", "..", "fahadalshahri", "testdata")
_URL = "https://fahadalshahri.com/product/%d9%81%d9%8a%d9%84%d8%a7-%d8%af%d9%88%d8%b1%d9%8a%d9%86-%d9%88%d9%85%d9%84%d8%ad%d9%82/"


def _read(name):
    with open(os.path.join(_TD, name), encoding="utf-8") as fh:
        return fh.read()


class _Resp:
    def __init__(self, status, text):
        self.status_code, self.text = status, text


class _Clock:
    def __init__(self):
        self.t = 0.0

    def now(self):
        return self.t

    def sleep(self, d):
        assert d > 0
        self.t += d


class _Sess:
    """Answers from a script; each request takes 0.05 s of the fake clock and records when it was made."""
    def __init__(self, clock, answers):
        self.clock, self.answers, self.calls = clock, list(answers), []

    def get(self, url, timeout=None):
        self.calls.append((self.clock.now(), url))
        self.clock.t += 0.05
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


def _run(answers, urls):
    clock = _Clock()
    s = _Sess(clock, answers)
    rows = [{"ad_number": f"FAS{i}"} for i in range(len(urls))]
    stats = m.add_page_dates(s, list(zip(rows, urls)), clock=clock.now, sleep=clock.sleep)
    return s, rows, stats


def test_page_requests_are_at_least_one_second_apart():
    page = _read("20851.page.excerpt.html")
    s, rows, stats = _run([_Resp(200, page)] * 3, [_URL, _URL, _URL])
    times = [t for t, _ in s.calls]
    assert len(times) == 3
    assert all(b - a >= m.PAGE_GAP_S for a, b in zip(times, times[1:])), times
    assert stats["dated"] == 3 and rows[0]["date_added"] == "2026-08-23T10:40:17+03:00"


def test_a_bot_check_stops_every_later_page_read():
    wall = _read("bot-verification.403.html")
    page = _read("20851.page.excerpt.html")
    s, rows, stats = _run([_Resp(403, wall), _Resp(200, page), _Resp(200, page)], [_URL, _URL, _URL])
    assert len(s.calls) == 1, "asked again after a bot check"
    assert stats == {"asked": 1, "dated": 0, "failed": {"challenge": 1}, "stopped": "challenge"}
    assert all("date_added" not in r for r in rows)


def test_a_challenge_body_on_a_200_also_stops():
    wall = _read("bot-verification.403.html")
    s, _, stats = _run([_Resp(200, wall), _Resp(200, wall)], [_URL, _URL])
    assert len(s.calls) == 1 and stats["stopped"] == "challenge"


def test_a_failed_read_is_counted_and_the_next_page_still_read():
    page = _read("20851.page.excerpt.html")
    s, rows, stats = _run([ConnectionError("reset"), _Resp(502, "bad gateway"), _Resp(200, page)], [_URL, _URL, _URL])
    assert len(s.calls) == 3
    assert stats["failed"] == {"ConnectionError": 1, "http 502": 1} and stats["dated"] == 1
    assert "date_added" not in rows[0] and rows[2]["date_added"] == "2026-08-23T10:40:17+03:00"
    note = m.page_dates_note(stats)
    assert note == "page_dates=1/3 failed=ConnectionErrorx1,http 502x1", note


def test_the_run_note_names_a_stop():
    assert m.page_dates_note({"asked": 1, "dated": 0, "failed": {"challenge": 1}, "stopped": "challenge"}) == \
        "page_dates=0/1 failed=challengex1 stopped=challenge"


def test_a_real_product_page_is_not_mistaken_for_a_challenge():
    assert not m._CHALLENGE_RE.search(_read("20851.page.excerpt.html"))
