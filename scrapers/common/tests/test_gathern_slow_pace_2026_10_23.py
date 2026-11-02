"""Gathern throttling: a «Too many requests» answer must WAIT OUT the window and SLOW the pace.

Measured 2026-10-23 (run 39901526732): at a 0.3 s pace Riyadh stopped at page 128 of ~390 and ~40
towns were refused, because a throttled page waited 3/6/9/12/15 s in total and the city was given up.
"""
import os
import pathlib
import re
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
os.environ.pop("SCRAPE_MIN_INTERVAL", None)

from scrapers.gathern import run  # noqa: E402


class _Resp:
    def __init__(self, code, text="", payload=None):
        self.status_code, self.text, self._p = code, text, payload

    def json(self):
        if self._p is None:
            raise ValueError("no json")
        return self._p


class _Session:
    def __init__(self, answers):
        self.answers = list(answers)

    def get(self, *a, **k):
        return self.answers.pop(0)


THROTTLED = _Resp(400, '{"success":false,"message":"Too many requests. Please try again later."}')
OK = _Resp(200, "", {"items": [{"id": 1}], "_meta": {"totalCount": 1}})


class SlowPace(unittest.TestCase):
    def setUp(self):
        run._interval = run.MIN_INTERVAL
        run._THROTTLE_HITS = 0
        self.slept = []
        self._orig = run.time.sleep
        run.time.sleep = self.slept.append

    def tearDown(self):
        run.time.sleep = self._orig
        run._interval = run.MIN_INTERVAL

    def test_throttled_page_waits_long_then_succeeds(self):
        items, _, status = run.fetch_page(_Session([THROTTLED, THROTTLED, OK]), 3, 129, "a", "b")
        self.assertEqual(status, "ok")
        self.assertEqual(len(items), 1)
        waits = [w for w in self.slept if w >= 1]
        self.assertGreaterEqual(sum(waits), 60, f"throttle waits too short: {waits}")

    def test_429_also_counts_as_throttle(self):
        run.fetch_page(_Session([_Resp(429), OK]), 3, 1, "a", "b")
        self.assertEqual(run._THROTTLE_HITS, 1)

    def test_pace_only_slows_and_is_capped(self):
        start = run._interval
        for i in range(30):
            run._on_throttled(0, sleep=lambda s: None)
        self.assertGreater(run._interval, start)
        self.assertLessEqual(run._interval, run.MAX_INTERVAL)

    def test_default_pace_is_gentle(self):
        self.assertGreaterEqual(run.MIN_INTERVAL, 0.6)

    def test_workflow_does_not_override_to_a_fast_pace(self):
        wf = (ROOT / ".github/workflows/gathern-sync.yml").read_text(encoding="utf-8")
        m = re.search(r'SCRAPE_MIN_INTERVAL:\s*"([\d.]+)"', wf)
        self.assertIsNotNone(m)
        self.assertGreaterEqual(float(m.group(1)), 1.0, "nightly crawl pace faster than 1 request/s")
        par = re.search(r"max-parallel:\s*(\d+)", wf)
        self.assertLessEqual(int(par.group(1)), 6)

    def test_mutation_old_short_ladder_is_caught(self):
        saved = run.THROTTLE_WAITS_S
        run.THROTTLE_WAITS_S = (3, 6, 9, 12, 15)
        try:
            run.fetch_page(_Session([THROTTLED, THROTTLED, OK]), 3, 129, "a", "b")
            self.assertLess(sum(w for w in self.slept if w >= 1), 60)
        finally:
            run.THROTTLE_WAITS_S = saved


if __name__ == "__main__":
    unittest.main()
