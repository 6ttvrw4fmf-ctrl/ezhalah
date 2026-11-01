"""awal must try more than one handshake before a crawl calls the source unreadable.

2026-09-24 → 2026-09-27: every awal crawl ended «stop=http_status page=1 | HTTP 500» and the site was
set dormant, but the scraper had only ever asked with ONE fingerprint (chrome124), directly, once.
docs/ops/SCRAPING_ENGINEER.md only calls a site "down on their side" after 2+ browser profiles AND
the residential proxy. This executes the REAL negotiate_list_session against stub sessions:

  1. a profile the source refuses is skipped for the next one, and the run uses the route that
     answered (detail pages included);
  2. the proxy leg runs only when a proxy is configured, and only after every direct profile;
  3. when nothing answers, the result is None and the ledger line names every attempt and what the
     source said — never an empty catalogue.

Run: python scrapers/awal/test_handshake_negotiation.py
"""
import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

import scrapers.awal.run as A  # noqa: E402


class _Resp:
    def __init__(self, status: int, body: str):
        self.status_code, self.text = status, body

    def json(self):
        return json.loads(self.text)


class _Sess:
    def __init__(self, status: int, body: str):
        self.status, self.body, self.calls = status, body, 0

    def get(self, *_a, **_k):
        self.calls += 1
        return _Resp(self.status, self.body)


WP_500 = "<html><body><p>There has been a critical error on this website.</p></body></html>"
PROXY = {"http": "http://p", "https": "http://p"}


def factory(answers):
    """answers: {(profile, proxied?): (status, body)}; records the order routes were tried."""
    tried = []

    def make(profile, proxies=None):
        key = (profile, bool(proxies))
        tried.append(key)
        return _Sess(*answers.get(key, (500, WP_500)))

    return make, tried


# 1. chrome124 refused, safari17_0 answers → safari17_0 is used for the whole run
make, tried = factory({("safari17_0", False): (200, "[]")})
diag = {}
s = A.negotiate_list_session(diag, make=make, pause=0)
assert s is not None, "a profile the source answers must be used"
assert tried == [("chrome124", False), ("safari17_0", False)], tried
assert A._ROUTE == {"profile": "safari17_0", "proxies": None}, A._ROUTE
assert diag["probes"][0].startswith("chrome124:HTTP 500") and "critical error" in diag["probes"][0], diag
assert diag["probes"][1] == "safari17_0:200", diag

# 2. every direct profile refused, proxy answers → proxy tried only AFTER all direct profiles
make, tried = factory({("chrome124", True): (200, "[]")})
diag = {}
s = A.negotiate_list_session(diag, make=make, proxies=PROXY, pause=0)
assert s is not None
assert tried == [(p, False) for p in A.PROBE_PROFILES] + [("chrome124", True)], tried
assert A._ROUTE["proxies"] == PROXY and A._ROUTE["profile"] == "chrome124"
assert len(A.PROBE_PROFILES) >= 2 and len(set(A.PROBE_PROFILES)) == len(A.PROBE_PROFILES)

# 3. no proxy configured → never a proxy leg
make, tried = factory({})
assert A.negotiate_list_session({}, make=make, proxies=None, pause=0) is None
assert all(not px for _p, px in tried) and len(tried) == len(A.PROBE_PROFILES), tried

# 4. nothing answers (including a 200 that is not a JSON list) → None, and the ledger says why
make, tried = factory({("firefox133", True): (200, "<html>parked</html>")})
diag = {}
assert A.negotiate_list_session(diag, make=make, proxies=PROXY, pause=0) is None
assert len(diag["probes"]) == 2 * len(A.PROBE_PROFILES), diag
assert "firefox133+proxy:200 not a JSON list" in diag["probes"], diag
diag.update(stop="no_route", detail="no profile or route answered the list endpoint")
line = A.why_no_listings(diag)
assert "UNKNOWN" in line and "probes: chrome124:HTTP 500" in line, line

print("ok — awal negotiates its handshake before calling the source unreadable")
