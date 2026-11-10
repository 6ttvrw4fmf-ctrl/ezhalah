"""Posting-date fixtures, group 10 (round 2). Contract: scripts/lib/posting_date_fixture_more.py.

Both sites print no date on the ad page; WordPress's own public RSS feed carries the post's publish date
(<pubDate> = post_date_gmt). Every input is a real page / feed read live on 2026-11-09 and saved under
scrapers/<site>/testdata/ (item bodies removed). No network, no database.
"""
import copy
import json
import os
import re

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def _testdata(site, name):
    with open(os.path.join(_ROOT, "scrapers", site, "testdata", name), encoding="utf-8") as fh:
        return fh.read()


def _strip_pubdate(feed, guid_id):
    """The feed with ONE item's <pubDate> removed (the channel's <lastBuildDate>, an edit time, stays)."""
    out, n = [], 0
    for part in re.split(r"(<item>.*?</item>)", feed, flags=re.S):
        if part.startswith("<item>") and re.search(rf"p={guid_id}\s*</guid>", part):
            part, n = re.subn(r"\s*<pubDate>[^<]*</pubDate>", "", part)
        out.append(part)
    assert n == 1, f"item {guid_id} not found once"
    return "".join(out)


# ── sqcc: post 215 «فيلا للبيع» + page 2 of /feed/?post_type=realestate (which lists it) ─────────────
_SQCC_URL = "https://sqcc.sa/realestate/فيلا-للبيع-الضاحيه/"
_SQCC_CATS = {"وحدات للبيع": {_SQCC_URL}, "العقارات المتاحة": {_SQCC_URL}}


def sqcc_args(feed_mode):
    """feed_mode: 'live' (the saved feed page), 'none' (the feed walk read nothing), 'no_pubdate' (215's item
    without its <pubDate>; only the channel <lastBuildDate> remains), 'zoneless' (215's stamp with «-0000»,
    which states no zone)."""
    feed = _testdata("sqcc", "feed-realestate.page2.xml")
    if feed_mode == "none":
        feed = None
    elif feed_mode == "no_pubdate":
        feed = _strip_pubdate(feed, 215)
    elif feed_mode == "zoneless":
        assert feed.count("Tue, 16 Jul 2024 08:05:11 +0000") == 1
        feed = feed.replace("Tue, 16 Jul 2024 08:05:11 +0000", "Tue, 16 Jul 2024 08:05:11 -0000")
    return [_testdata("sqcc", "215.page.html"), feed]


def _sqcc_call(m, a):
    page, feed = a
    posted = m.feed_dates(feed) if feed else {}
    got, why = m.map_listing(_SQCC_URL, m.parse_page(page), _SQCC_CATS, "ضاحية الملك فهد", posted)
    return (got[0] if got else None), why


# ── hasaad: project 8292 «شقق مسكني 8» (parse_project of the live page) + unit 8519's one-item feed ──
_HSD_URL = "https://hasaadestate.com/projects/%d8%b4%d9%82%d9%82-%d9%85%d8%b3%d9%83%d9%86%d9%8a-8/"


def hasaad_args(unit_id, feed_mode="live"):
    """unit_id: the unit model whose row is returned, and whose feed was asked for. feed_mode: 'live' (the saved
    feed of unit 8519), 'none' (the read failed), 'no_pubdate' (the item without <pubDate>; the channel's
    <lastBuildDate> — the post's last edit, 2026-02-10 — remains)."""
    proj = json.loads(_testdata("hasaad", "8292.project.json"))
    proj.pop("_note", None)
    feed = _testdata("hasaad", "8519.unit-feed.xml")
    if feed_mode == "none":
        feed = None
    elif feed_mode == "no_pubdate":
        feed = _strip_pubdate(feed, 8519)
    return [proj, feed, unit_id]


def _hasaad_call(m, a):
    proj, feed, uid = a
    pub = m.unit_feed_pub(feed, uid) if feed else None
    rows, skips = m.map_units(_HSD_URL, copy.deepcopy(proj), {uid: pub} if pub else {})
    row = next((r for r in rows if r["additional_info"].get("unit_post_id") == uid), None)
    return row, "" if row else ",".join(skips)


PLATFORMS = {
    "sqcc": ("scrapers.sqcc.run", sqcc_args, _sqcc_call),
    "hasaad": ("scrapers.hasaad.run", hasaad_args, _hasaad_call),
}

CASES = {
    "sqcc": [
        [["live"], "2024-07-16T11:05:11+03:00",
         "feed <pubDate> of post 215 «Tue, 16 Jul 2024 08:05:11 +0000» (read live; first seen by us 2026-09-27)"
         " → Saudi time"],
        [["none"], None, "the feed walk read nothing → NULL, the ad still maps"],
        [["no_pubdate"], None, "215's item has no <pubDate>; only the channel <lastBuildDate> (an edit) → NULL"],
        [["zoneless"], None, "«-0000» states no zone → not an instant → NULL"],
    ],
    "hasaad": [
        [["8519"], "2025-11-03T17:09:16+03:00",
         "unit 8519's one-item feed <pubDate> «Mon, 03 Nov 2025 14:09:16 +0000» (read live; first seen by us"
         " 2026-09-24) → Saudi time"],
        [["8519", "none"], None, "the feed read failed → NULL, the unit still maps"],
        [["8519", "no_pubdate"], None,
         "item without <pubDate>; only the channel <lastBuildDate> (last edit 2026-02-10) → NULL"],
        [["8556"], None, "the answer's <guid> names unit 8519, not 8556 → never another unit's date → NULL"],
    ],
}
