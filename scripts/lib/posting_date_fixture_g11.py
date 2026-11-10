"""Posting-date fixtures, group 11. Contract: scripts/lib/posting_date_fixture_more.py.

fahadalshahri: the WooCommerce Store API carries no date; each product page carries a Yoast JSON-LD ItemPage block
with datePublished (and a separate dateModified). The page is a verbatim excerpt of the live product page read
2026-11-10 (scrapers/fahadalshahri/testdata/20851.page.excerpt.html, the office e-mail removed). The Store-API record
is built from the stored row (id, title, price, link); its description names the city as the live one does. No
network, no database.
"""
import os
import re

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
_URL = "https://fahadalshahri.com/product/%d9%81%d9%8a%d9%84%d8%a7-%d8%af%d9%88%d8%b1%d9%8a%d9%86-%d9%88%d9%85%d9%84%d8%ad%d9%82/"
_OTHER = "https://fahadalshahri.com/product/%d8%b4%d9%82%d9%82-%d8%ad%d9%8a-%d8%a7%d9%84%d9%85%d8%b1%d9%88%d8%a9-%d8%ac%d8%af%d8%a9/"


def _page():
    with open(os.path.join(_ROOT, "scrapers", "fahadalshahri", "testdata", "20851.page.excerpt.html"), encoding="utf-8") as fh:
        return fh.read()


def fahadalshahri_args(page_mode):
    """page_mode: 'live' (the saved page), 'none' (the page read failed — a 403 wall or an error), 'other_page' (the
    saved page, but the product's own link is another product's), 'modified_only' (datePublished removed; only
    dateModified remains)."""
    product = {
        "id": 20851,
        "name": "فيلا دورين وملحق دوبلكس حي الرحمانيه",
        "description": "<p>فيلا دورين وملحق دوبلكس للبيع في جدة حي الرحمانيه</p>",
        "permalink": _OTHER if page_mode == "other_page" else _URL,
        "prices": {"price": "1600000"},
        "images": [],
        "is_in_stock": True,
    }
    page = _page()
    if page_mode == "none":
        page = None
    elif page_mode == "modified_only":
        page, n = re.subn(r'"datePublished":"[^"]*",?', "", page)
        assert n == 1, "datePublished not found once in the saved page"
    return [product, page]


PLATFORMS = {
    "fahadalshahri": ("scrapers.fahadalshahri.run", fahadalshahri_args, lambda m, a: m.map_listing(*a)[::2]),
}

CASES = {
    "fahadalshahri": [
        [["live"], "2026-08-23T10:40:17+03:00",
         "product 20851's page ItemPage datePublished «2026-08-23T09:40:17+02:00» (read live; first seen by us"
         " 2026-09-20; dateModified 2026-09-13) → the same instant in Saudi time"],
        [["none"], None, "the page read failed (the site's 403 wall) → NULL, the product still maps"],
        [["other_page"], None, "the page block's url is not this product's link → never another page's date → NULL"],
        [["modified_only"], None, "only dateModified (an edit) on the page → NULL"],
    ],
}

MUTATIONS = {
    "fahadalshahri": [
        ("fahadalshahri reading dateModified (an edit) as the posting date", "scrapers/fahadalshahri/run.py",
         'isinstance(n.get("datePublished"), str):\n                return n["datePublished"]',
         'isinstance(n.get("dateModified"), str):\n                return n["dateModified"]', ["live"]),
        ("fahadalshahri taking a page block's date without checking it is this product's page",
         "scrapers/fahadalshahri/run.py",
         'if _page_key(n.get("url") or n.get("@id")) == want and isinstance',
         'if isinstance', ["other_page"]),
    ],
}
