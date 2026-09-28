"""An id-sweep scraper must read the top of its range from the SOURCE, never from a constant.

THE AUDIT (2026-09-28, measured live). Two sequential-id scrapers stopped at a hard-coded ceiling:
  • muktamel — the workflow swept 24000..32300. Our highest active id was exactly 32300 while the
    site's ids ran to ~34311 (live, priced, REGA-licensed ads at 32320, 32450, 32620, 33720, 33890,
    34000, 34120, 34280 — none in our DB): ~890 listings never fetched. The site's ids also have a
    ~1,000-id /404 gap (32665..~33671), so a naive "stop after 300 dead ids" walk would stop in the
    hole and still miss the newest band.
  • alkhaas — ID_END=1040 with the newest ad at 1004: 36 ids from going blind.

Both tests drive the scraper's REAL main() (validation mode, no DB) with the network replaced by the
measured shape, and assert which ids the crawl actually hands to fetch_one.

    python -m pytest scrapers/common/tests/test_id_sweeps_find_their_own_ceiling.py -q
"""
from __future__ import annotations

import sys
import types

# ── Hermetic import: stub the network + credential deps so run.py imports offline ────────────────
for name, attrs in (
    ("supabase", {"Client": type("Client", (), {}), "create_client": lambda *a, **k: None}),
    ("dotenv", {"load_dotenv": lambda *a, **k: None}),
    ("curl_cffi", {}),
    ("curl_cffi.requests", {"Session": type("Session", (), {})}),
):
    if name not in sys.modules:
        m = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(m, k, v)
        sys.modules[name] = m
sys.modules["curl_cffi"].requests = sys.modules["curl_cffi.requests"]

from scrapers.alkhaas import run as alkhaas  # noqa: E402
from scrapers.muktamel import run as muktamel  # noqa: E402


def _swept_ids(monkeypatch, mod, argv) -> set[int]:
    swept: list[int] = []
    monkeypatch.setattr(mod, "fetch_one", lambda i: swept.append(i))  # records, returns None
    monkeypatch.setattr(sys, "argv", ["run", "--limit", "1", *argv])
    assert mod.main() == 0
    return set(swept)


class _Resp:
    def __init__(self, text: str = "", status: int = 200, location: str = ""):
        self.status_code, self.text, self.headers = status, text, {"location": location}


def test_muktamel_sweeps_past_the_floor_to_the_sources_ceiling_across_the_gap(monkeypatch):
    # The redirect shapes the site answered with on 2026-09-28 (allow_redirects=False).
    answers = {1: _Resp(status=302, location="/real-estates/1/%D8%B4%D9%82%D8%A9"),
               2: _Resp(status=302, location="https://www.muktamel.com/real-estates/2/slug"),
               3: _Resp(status=302, location="/404"),
               4: _Resp(status=302, location="/real-estates/40/another-listing")}
    monkeypatch.setattr(muktamel, "_session", lambda: types.SimpleNamespace(
        get=lambda url, **_k: answers[int(url.rsplit("/", 1)[1])]))
    assert [muktamel._id_exists(i) for i in (1, 2, 3, 4)] == [True, True, False, False]

    # Measured 2026-09-28: assigned, then a ~1,000-id /404 gap, then assigned again to 34311.
    assigned = set(range(32290, 32665)) | set(range(33672, 34312))
    monkeypatch.setattr(muktamel, "_id_exists", lambda i: i in assigned)
    shard = ["--min-id", "32290", "--max-id", "32300", "--shards", "8", "--shard", "3"]

    swept = _swept_ids(monkeypatch, muktamel, shard)
    assert all(i % 8 == 3 for i in swept), "sharding broke: a shard swept ids it does not own"
    missed = sorted(i for i in assigned if i % 8 == 3 and i not in swept)
    assert not missed, f"{len(missed)} assigned ids never fetched, e.g. {missed[:3]}…{missed[-3:]}"
    assert max(swept) < 34312 + muktamel.CEILING_STRIDE, "walk ran past the source's ceiling"

    # Negative control: a source that calls EVERY id assigned has a broken /404 signal — sweep the
    # floor exactly as before instead of walking to the backstop.
    monkeypatch.setattr(muktamel, "_id_exists", lambda i: True)
    assert max(_swept_ids(monkeypatch, muktamel, shard)) <= 32300


def test_alkhaas_sweeps_to_the_newest_id_its_own_index_pages_link(monkeypatch):
    pages = {"/": '<a href="/ads/1203">new</a><a href="/ads/1199">x</a>',
             "/category/0": '<a href="//alkhaas.net/ads/1150">x</a>',
             "/category/2": "<p>no ads</p>"}  # /category/1 is unreachable this run

    class _Session:
        def get(self, url, **_k):
            path = url.removeprefix(alkhaas.BASE)
            if path not in pages:
                raise ConnectionError(path)
            return _Resp(pages[path])

    monkeypatch.setattr(alkhaas, "_session", _Session)
    swept = _swept_ids(monkeypatch, alkhaas, [])
    assert 1203 in swept, f"newest ad never fetched: sweep stopped at {max(swept)}"
    assert max(swept) == 1203 + alkhaas.ID_MARGIN

    # Every index page down: never sweep less than the last hard-coded range did.
    pages.clear()
    assert max(_swept_ids(monkeypatch, alkhaas, [])) == alkhaas.ID_END_FLOOR
