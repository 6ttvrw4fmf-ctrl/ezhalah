"""Posting-date fixtures, group 8 (round 2): alshawaf. Contract: scripts/lib/posting_date_fixture_more.py.

Every input is a real page read live on 2026-11-10 and stored under scrapers/<site>/testdata/ (authors'
names removed). Builders touch no network and no database; the catalog lookups alshawaf's location code
makes are stubbed for the one mapping and restored afterwards.

The trap this group guards: alshawaf (Drupal 10) prints «التاريخ» on the index and the node page, and that
is the node's `changed` — a BUMP date. The posting date is the node's `created`, which the site publishes
only as <pubDate> in the district term's RSS feed (/taxonomy/term/<tid>/feed). A row with only the bump
date must give None.
"""
import os
import re

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")

PLATFORMS = {}
CASES = {}
MUTATIONS = {}


# ── alshawaf: the real /table row of node 22416 + the real feed of its district term (tid 3) ─────────
def _alshawaf_read(name):
    with open(os.path.join(_ROOT, "scrapers", "alshawaf", "testdata", name), encoding="utf-8") as fh:
        return fh.read()


def alshawaf_args(feed="term-3"):
    """feed: "term-3" (the real feed), "term-3-without-22416" (the same feed with that node's <item>
    cut, i.e. the node has fallen out of its term's 10 newest), or None (no feed read)."""
    from scrapers.alshawaf import run as m
    page = _alshawaf_read("22416.table-page.excerpt.html")
    ix = m.parse_index(m.index_rows(page)[0])
    created = {}
    if feed:
        xml = _alshawaf_read("term-3.feed.xml")
        if feed == "term-3-without-22416":
            xml = re.sub(r"<item>(?:(?!</item>).)*?<guid[^>]*>22416 at [^<]*</guid>.*?</item>", "", xml,
                         flags=re.S)
        tid = m.term_ids(page).get(m._term_key(ix["district_term"]))
        if tid == "3":                       # the feed on disk is term 3's; the page must name it
            created = m.parse_term_feed(xml)
    ix["created_raw"] = created.get(ix["nid"])
    return [ix, {}]


def _alshawaf(mod, args):
    # «الامراء ، الهفوف»: the term names its town (الهفوف, catalog city 12, region 5). No database.
    saved = (mod.to_catalog, mod.find_district_in_text)
    mod.to_catalog = lambda name, region_hint=None: {"الهفوف": (12, 5), "الاحساء": (3677, 5)}.get(
        name, (None, None))
    mod.find_district_in_text = lambda text, city_id: None
    try:
        row, _cat, why = mod.map_listing(*args)
    finally:
        mod.to_catalog, mod.find_district_in_text = saved
    return row, why


PLATFORMS |= {
    "alshawaf": ("scrapers.alshawaf.run", alshawaf_args, _alshawaf),
}

CASES |= {
    "alshawaf": [
        [["term-3"], "2026-11-05T07:46:14+03:00",
         "term 3 feed <pubDate> «Thu, 05 Nov 2026 04:46:14 +0000» for node 22416 (read live 2026-11-10; "
         "the index printed the same instant, 2026-11-05T07:46:14+03:00, because it was never bumped) → Saudi time"],
        [["term-3-without-22416"], None,
         "the node is not among its term feed's 10 newest → NULL (the upsert keeps any date read earlier)"],
        [[None], None,
         "only the index «التاريخ» (Drupal `changed`, a bump date) is present → NULL, a bump is not a posting"],
    ],
}

MUTATIONS |= {
    "alshawaf": [
        ["alshawaf reading the index «التاريخ» (`changed`, a bump date) as the posting date",
         "scrapers/alshawaf/run.py",
         '"date_added": site_posting_date(rfc822_to_iso(ix.get("created_raw"))),',
         '"date_added": site_posting_date(ix.get("bump_date")),',
         [None]],
    ],
}
