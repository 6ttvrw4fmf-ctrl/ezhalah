"""Property Finder Saudi — the polite CATEGORY-PAGE walk (owner approved the source 2026-11-04).

HONEST ACCESS, the owner's rule, no exceptions:
  * our own bot user-agent «Ezhalah-bot/1.0 (+https://ezhalah.com)», never a browser identity, no
    impersonation, no proxy, no fingerprint tricks;
  * <= 1 request a second (fetch() sleeps so two requests are never closer than 1.1 s);
  * only what robots.txt allows: the four top category pages and their standalone «?page=N»
    («Allow: *?page=*»). Never /search?*, /ajax/, any filter parameter (location=, price=, category=,
    bedrooms=, …), never «?page=N&…», and never a single-ad page /…/plp/…html — those answer 403 to
    robots and are never fetched;
  * ANY wall — HTTP 403 / 429 / 503, a CAPTCHA or «security check» page, a page with no __NEXT_DATA__ —
    raises Blocked and the whole run stops. It is never retried around.

THE FOUR SIDES (measured 2026-11-04, 25 ads a page, pagination NOT capped: page_count=140 is served):
  residential buy  /ar/للبيع/عقارات-للبيع.html                ~3,489
  residential rent /ar/للايجار/عقارات-للايجار.html            ~1,027
  commercial buy   /ar/تجارية-للبيع/عقارات-للبيع.html          ~23
  commercial rent  /ar/تجارية-للايجار/عقارات-للايجار.html      ~160
The Arabic pages carry Arabic field values (property_type «شقة», offering_type «للبيع»).
Each ad is props.pageProps.searchResult.listings[i].property; meta.total_count is the side's own count.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Callable, Optional
from urllib.parse import quote

from curl_cffi import requests as cc  # NO impersonate argument anywhere: an honest client

UA = "Ezhalah-bot/1.0 (+https://ezhalah.com)"
BASE = "https://www.propertyfinder.sa"
MIN_GAP_S = 1.1

# (side key, deal, category, path) — the side key is what coverage is proven per.
SIDES: tuple[tuple[str, str, str, str], ...] = (
    ("res_buy", "Buy", "residential", "/ar/" + quote("للبيع") + "/" + quote("عقارات-للبيع") + ".html"),
    ("res_rent", "Rent", "residential", "/ar/" + quote("للايجار") + "/" + quote("عقارات-للايجار") + ".html"),
    ("com_buy", "Buy", "commercial", "/ar/" + quote("تجارية-للبيع") + "/" + quote("عقارات-للبيع") + ".html"),
    ("com_rent", "Rent", "commercial", "/ar/" + quote("تجارية-للايجار") + "/" + quote("عقارات-للايجار") + ".html"),
)

_WALL_WORDS = ("captcha", "security check", "attention required", "cf-chl", "access denied",
               "are you a robot", "verify you are human", "request blocked")
_NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


class Blocked(RuntimeError):
    """The site refused the honest bot. The run stops; nothing is pruned; nobody works around it."""


_last = [0.0]


def fetch(url: str, *, session: Optional[Any] = None, sleep: Callable[[float], None] = time.sleep) -> str:
    """One polite GET. Raises Blocked on any wall; returns the HTML of a 200."""
    if "/plp/" in url or "?" in url and not re.search(r"\?page=\d+$", url):
        raise ValueError(f"refusing a URL robots.txt or the owner rule does not allow: {url}")
    wait = MIN_GAP_S - (time.time() - _last[0])
    if wait > 0:
        sleep(wait)
    _last[0] = time.time()
    get = (session or cc).get
    r = get(url, headers={"User-Agent": UA, "Accept-Language": "ar"}, timeout=45)
    body = r.text or ""
    low = body[:4000].lower()
    if r.status_code in (401, 403, 429, 503) or any(w in low for w in _WALL_WORDS):
        raise Blocked(f"HTTP {r.status_code} wall at {url}: {body[:160]!r}")
    if r.status_code != 200:
        raise Blocked(f"HTTP {r.status_code} at {url} (not a 200 — stopping, never guessing)")
    return body


def search_result(html: str, url: str) -> dict:
    m = _NEXT_DATA.search(html)
    if not m:
        raise Blocked(f"no __NEXT_DATA__ at {url} — the page shape changed or a wall was served")
    d = json.loads(m.group(1))
    return ((d.get("props") or {}).get("pageProps") or {}).get("searchResult") or {}


def walk_side(path: str, *, get: Callable[[str], str] = fetch, log: Callable[[str], None] = print) -> dict:
    """Every page of one side. Returns {"total_count", "page_count", "pages_read", "props": {id: property},
    "non_property_items", "first_total"}. A page that serves nothing new before page_count ends the walk."""
    props: dict[str, dict] = {}
    non_property = 0
    first_total = page_count = None
    totals: list[int] = []
    page = 1
    while True:
        url = BASE + path + ("" if page == 1 else f"?page={page}")
        sr = search_result(get(url), url)
        meta = sr.get("meta") or {}
        if page == 1:
            first_total = int(meta.get("total_count") or 0)
            page_count = int(meta.get("page_count") or 0)
        if meta.get("total_count"):
            totals.append(int(meta["total_count"]))
        items = sr.get("listings") or []
        fresh = 0
        for it in items:
            p = it.get("property") if isinstance(it, dict) else None
            if not p or not p.get("id"):
                non_property += 1
                continue
            pid = str(p["id"])
            if pid not in props:
                fresh += 1
            props[pid] = p
        log(f"  page {page}/{page_count}: {len(items)} items, {fresh} new, {len(props)} unique")
        if not items or page >= (page_count or 0):
            break
        page += 1
    return {"total_count": max(totals) if totals else 0, "first_total": first_total or 0,
            "min_total": min(totals) if totals else 0, "page_count": page_count or 0,
            "pages_read": page, "props": props, "non_property_items": non_property}


def complete(side: dict, *, floor: float = 0.98) -> bool:
    """A side is COMPLETE when the walk read every page and saw at least `floor` of the smallest total
    the site itself printed during the walk (the count drifts by a few ads while we read)."""
    want = side.get("min_total") or side.get("total_count") or 0
    return want > 0 and side["pages_read"] >= side["page_count"] and len(side["props"]) >= floor * want
