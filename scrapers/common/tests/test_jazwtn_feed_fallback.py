"""jazwtn's RSS-feed fallback — and above all, its COMPLETENESS CONTRACT.

WHY THE FALLBACK EXISTS (senior production run, 2026-08-31). jazwtn's WAF serves GitHub Actions
egress a ~7KB decoy for /projects-sitemap.xml — HTTP 200, zero <loc> entries — on ALL FIVE TLS
fingerprints including no-impersonation. That makes it IP-shaped, not fingerprint-shaped, so
retrying the same path can never win. But the block is PATH-dependent rather than blanket: from an
unrelated datacenter egress the same host returns 403 on `/` while serving the real 53,865-byte
sitemap and this feed. A second, independent entry point is therefore a real second chance and not
a retry in disguise.

Measured against the live source that day: feed pages 1-9 return HTTP 200 (12 then 13 items each)
and page 10+ returns HTTP 404. The 116 distinct URLs are a strict SUPERSET of the sitemap's 108,
with zero sitemap-only entries — a complete catalogue, not a recent-items window.

WHAT THIS FILE MOSTLY GUARDS is not the happy path but the dangerous one. A discovery path that
returns HALF the catalogue is far worse than one that returns nothing: the short list goes to
prune_unseen, and absence from a partial crawl is not evidence a listing is gone
(docs/ops/LISTING_LIVENESS.md §3). Half the site missing would look exactly like half the site
being delisted. So `feed_entries` returns entries ONLY when enumeration ended on the natural HTTP
404 terminator; every other ending discards what it collected and returns [].

Run: python -m pytest scrapers/common/tests/test_jazwtn_feed_fallback.py -v
"""
import inspect

from scrapers.jazwtn import run as jz

BASE = "https://jazwtn.sa"


def _item(slug: str) -> str:
    return f"<item><title>x</title><link>{BASE}/projects/{slug}/</link></item>"


def _feed(*slugs: str) -> str:
    return "<rss><channel>" + "".join(_item(s) for s in slugs) + "</channel></rss>"


class _R:
    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text


class _Session:
    """Serves a scripted list of responses, one per successive request."""

    def __init__(self, *responses):
        self._responses = list(responses)
        self.calls: list[str] = []

    def get(self, url, **kw):
        self.calls.append(url)
        r = self._responses.pop(0) if self._responses else _R(404, "")
        if isinstance(r, Exception):
            raise r
        return r


# ── The happy path: a complete walk ending on the 404 ────────────────────────────
def test_natural_404_terminator_returns_every_page():
    s = _Session(_R(200, _feed("a", "b")), _R(200, _feed("c")), _R(404, ""))
    entries = jz.feed_entries(s)
    assert [u for u, _ in entries] == [
        f"{BASE}/projects/a/", f"{BASE}/projects/b/", f"{BASE}/projects/c/"]
    # Featured image has no feed equivalent; _images() merges the detail page's own gallery.
    assert all(img is None for _, img in entries)


def test_pagination_uses_the_paged_query_form():
    s = _Session(_R(200, _feed("a")), _R(404, ""))
    jz.feed_entries(s)
    assert s.calls[0] == jz.FEED
    assert s.calls[1] == f"{jz.FEED}?paged=2"


# ── The contract that actually matters: incomplete NEVER returns partial data ────
def test_mid_walk_decoy_discards_everything_collected():
    """THE REGRESSION THIS FILE EXISTS FOR. A 200 with 0 new items mid-walk is the decoy shape.
    Returning page 1 alone would hand a truncated catalogue to prune_unseen."""
    s = _Session(_R(200, _feed("a", "b")), _R(200, "<rss><channel></channel></rss>"), _R(404, ""))
    assert jz.feed_entries(s) == [], "a decoy mid-walk must discard the partial catalogue"


def test_mid_walk_error_status_discards_everything_collected():
    s = _Session(_R(200, _feed("a", "b")), _R(503, "nope"), _R(404, ""))
    assert jz.feed_entries(s) == []


def test_mid_walk_transport_failure_discards_everything_collected():
    s = _Session(_R(200, _feed("a", "b")), ConnectionError("reset by peer"))
    assert jz.feed_entries(s) == []


def test_running_into_the_page_cap_without_a_404_is_incomplete():
    """A feed that never 404s (infinite/looping pagination) must not be trusted either."""
    pages = [_R(200, _feed(f"s{i}")) for i in range(jz._FEED_MAX_PAGES + 2)]
    assert jz.feed_entries(_Session(*pages)) == []


def test_repeated_items_do_not_masquerade_as_progress():
    """Same items served again = 0 new = incomplete, not an endless walk."""
    s = _Session(_R(200, _feed("a")), _R(200, _feed("a")), _R(404, ""))
    assert jz.feed_entries(s) == []


def test_archive_root_url_is_never_emitted_as_a_listing():
    s = _Session(_R(200, f"<rss><channel><item><link>{BASE}/projects/</link></item>"
                        f"{_item('real')}</channel></rss>"), _R(404, ""))
    assert [u for u, _ in jz.feed_entries(s)] == [f"{BASE}/projects/real/"]


# ── Wiring: the fallback is reached, and total failure still fails loudly ────────
def test_main_falls_back_to_the_feed_and_never_proceeds_on_an_empty_catalogue():
    src = inspect.getsource(jz.main)
    assert "feed_entries(s)" in src, "main() must try the feed when the sitemap yields nothing"
    assert src.index("sitemap_entries(s)") < src.index("feed_entries(s)"), \
        "the sitemap stays PRIMARY; the feed is the fallback"
    # Both paths failing must raise — an empty catalogue must never reach the prune.
    assert "raise RuntimeError(" in src
    assert src.index("feed_entries(s)") < src.index("raise RuntimeError(")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("all jazwtn feed-fallback contracts hold")
