"""An enumeration must reach the source's OWN declared total, or say that it did not (coverage audit
2026-09-28). Three scrapers read a short catalogue as a whole one:

  vmksa    — CI read 154 of the 190 the index declares (lastPage 13), identical on three runs: an
             index page that came back as a throttled shell (0 ids) was taken as-is. The audit's walk
             got 0 ids from pages 12 and 13, then 15 and 10 on a retry.
  sodasyat — read /search page 1 only, while the site's «18 نتيجه» counter spans ?page=2.
  abeea    — a detail page whose fetch failed was dropped silently (133 of 171 on 2026-09-27) and
             prune still ran on that absence.

    python -m pytest scrapers/common/tests/test_enumeration_walks_to_the_declared_total.py -q
"""
from __future__ import annotations

import json
import sys
import types

# ── Hermetic import: stub supabase + dotenv so db.py imports with no credentials/network ─────────
_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

from scrapers.abeea import run as abeea  # noqa: E402
from scrapers.sodasyat import run as sodasyat  # noqa: E402
from scrapers.vmksa import run as vmksa  # noqa: E402


class _Index:
    """vm-ksa's /ar/ads?page=N: 190 ads, 15 a page, lastPage 13. Page p serves a throttled shell
    (no ids, no pagination object) for its first shells[p] requests."""

    def __init__(self, shells):
        self.shells = dict(shells)

    def get(self, url, **_kw):
        page = int(url.rsplit("=", 1)[1])
        if self.shells.get(page, 0) > 0:
            self.shells[page] -= 1
            return types.SimpleNamespace(text="<html>shell</html>")
        ids = range(1000 + 15 * (page - 1), min(1000 + 15 * page, 1190))
        payload = json.dumps('1:{"pagination":{"total":190,"lastPage":13}}\n')
        links = "".join(f'<a href="/ar/ads/{i}">' for i in ids)
        return types.SimpleNamespace(text=f"<script>self.__next_f.push([1,{payload}])</script>{links}")


def test_vmksa_retries_a_throttled_index_page_until_the_declared_total(monkeypatch):
    monkeypatch.setattr(vmksa.time, "sleep", lambda *_: None)
    # The audit's shape: pages 12 and 13 answer a shell twice before serving their ids.
    ids, declared = vmksa.list_ids(_Index({12: 2, 13: 2}))
    assert declared == 190 and len(ids) == 190
    # A page that never recovers leaves the union SHORT (main() then withholds prune and flags the
    # run) — it is never padded, and the walk still ends.
    ids, declared = vmksa.list_ids(_Index({13: 10**6}))
    assert declared == 190 and len(ids) == 180


def test_sodasyat_follows_search_pages_until_the_sites_counter(monkeypatch):
    def card(i):
        return f'<div class="item"><a href="https://sodasyat.sa/single/{i}"><span>شقة</span></a></div>'

    pages = {
        "https://sodasyat.sa/search": "<p>18 نتيجه</p>" + "".join(card(i) for i in range(2741, 2729, -1)),
        "https://sodasyat.sa/search?page=2": "<p>18 نتيجه</p>" + "".join(card(i) for i in range(2729, 2723, -1)),
    }
    monkeypatch.setattr(sodasyat, "fetch", lambda _s, url: (200, url, pages.get(url, "<p>18 نتيجه</p>")))
    ids, counter, cards = sodasyat.list_catalogue(None)
    assert counter == 18 and len(ids) == 18 and "2724" in ids and "2724" in cards


def test_abeea_retries_failed_detail_pages_and_withholds_prune_while_any_stay_unread(monkeypatch):
    urls = [f"https://abeea.com.sa/en/property/p{i}/" for i in range(3)]
    tries: dict[str, int] = {}

    def fetch_one(url):
        tries[url] = tries.get(url, 0) + 1
        if url == urls[1] and tries[url] == 1:
            return None                    # fails in the burst, reads on the second chance
        if url == urls[2]:
            return None                    # never readable this run
        return "<html/>", url

    upserted, pruned, ended = [], [], {}
    monkeypatch.setattr(sys, "argv", ["run"])
    monkeypatch.setattr(abeea.time, "sleep", lambda *_: None)
    monkeypatch.setattr(abeea, "discover_urls", lambda _s: (urls, {}))
    monkeypatch.setattr(abeea, "fetch_one", fetch_one)
    monkeypatch.setattr(abeea, "map_listing",
                        lambda _b, u, _f: ({"ad_number": "AB" + u[-2]}, "residential", False))
    monkeypatch.setattr(abeea, "_pin_sold_inactive", lambda *a, **k: None)
    monkeypatch.setattr(abeea.db, "begin_run", lambda _slug: 1)
    monkeypatch.setattr(abeea.db, "upsert_abeea_residential_batch", lambda rows: upserted.extend(rows))
    monkeypatch.setattr(abeea.db, "upsert_abeea_commercial_batch", lambda rows: upserted.extend(rows))
    monkeypatch.setattr(abeea.db, "retire_superseded_siblings", lambda **_k: 0)
    monkeypatch.setattr(abeea.db, "prune_unseen", lambda *a, **k: pruned.append(a) or 0)
    monkeypatch.setattr(abeea.db, "end_run", lambda _id, **k: ended.update(k) or True)

    assert abeea.main() == 0
    assert sorted(r["ad_number"] for r in upserted) == ["AB0", "AB1"]   # p1 recovered
    assert pruned == []                                                 # p2 unread → no prune
    assert "fetch_failed=1/3" in ended["notes"]
