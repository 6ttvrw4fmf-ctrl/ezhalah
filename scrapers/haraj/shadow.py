"""Haraj SHADOW crawl (backlog 311) — reads, classifies and PRINTS; writes nothing anywhere.

The owner's gate: Haraj goes live only after a random 100 real-estate posts are hand-checked with
0 requests and 0 non-property among the posts classified «offer». This prints that sample (titles
and a short body excerpt, PII-redacted) so the hand-check can be done from the job log.

Honest access only (owner rule): our own bot user-agent, no browser impersonation, no login,
<= 1 request a second, only paths robots.txt allows (it disallows /post/*, /chat, /users/*/edit).

  python -m scrapers.haraj.shadow --max-posts 150
"""
from __future__ import annotations

import argparse
import html as _html
import json
import random
import re
import sys
import time
from collections import Counter
from urllib.parse import quote

from curl_cffi import requests as cc  # NO impersonate: an honest client, owner rule

from scrapers.common.pii import redact_pii
from scrapers.haraj.classify import classify

UA = "Ezhalah-bot/1.0 (+https://ezhalah-app.vercel.app)"
BASE = "https://haraj.com.sa"
TAG = "حراج العقار"
_last = [0.0]


def fetch(url: str, timeout: int = 30) -> tuple[int, str]:
    wait = 1.05 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    try:
        r = cc.get(url, headers={"User-Agent": UA, "Accept-Language": "ar"}, timeout=timeout)
        return r.status_code, r.text
    except Exception as e:  # noqa: BLE001 — a failed fetch is printed, never read as empty
        return -1, str(e)[:200]


_POST_RE = re.compile(r'(?:https://haraj\.com\.sa)?/(1\d{9,11})/([^"\'\s<>?#]*)')


def post_ids(text: str) -> list[str]:
    return list(dict.fromkeys(m.group(1) for m in _POST_RE.finditer(text)))


def _meta(html: str, prop: str) -> str:
    m = re.search(r'<meta[^>]+(?:property|name)="%s"[^>]+content="([^"]*)"' % re.escape(prop), html)
    return _html.unescape(m.group(1)) if m else ""


def read_post(pid: str) -> dict:
    st, h = fetch(f"{BASE}/{pid}/")
    out = {"id": pid, "status": st}
    if st != 200:
        return out
    out["title"] = _meta(h, "og:title") or (re.search(r"<title>(.*?)</title>", h, re.S) or [None, ""])[1]
    out["body"] = _meta(h, "og:description") or _meta(h, "description")
    nd = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    out["has_next_data"] = bool(nd)
    out["ld_types"] = re.findall(r'"@type"\s*:\s*"([A-Za-z]+)"', " ".join(
        re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', h, re.S)))[:8]
    out["has_tag"] = TAG in h or quote(TAG) in h
    for blob in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', h, re.S):
        if "RealEstateListing" in blob:
            out["ld_listing"] = redact_pii(blob) or ""
            break
    out["geo"] = bool(re.search(r'"(?:lat|latitude|geo)"\s*:', h))
    out["len"] = len(h)
    if nd:
        try:
            data = json.loads(nd.group(1))
            out["nd_keys"] = list((data.get("props", {}).get("pageProps") or {}).keys())[:15]
        except ValueError:
            out["nd_keys"] = ["<unparseable>"]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-posts", type=int, default=150)
    ap.add_argument("--seed", type=int, default=20261010)
    ap.add_argument("--skip-hours", type=int, default=6,
                    help="skip the newest N hourly sitemap files (already hand-checked in an earlier run)")
    ap.add_argument("--want", type=int, default=110, help="stop after this many real-estate posts")
    a = ap.parse_args()

    ids: list[str] = []
    st, rb = fetch(f"{BASE}/robots.txt")
    print(f"robots.txt {st}:\n{rb[:600]}\n", flush=True)
    for path in (f"/tags/{TAG}/", f"/tags/{TAG}/2", f"/tags/{TAG}/3", f"/tags/{TAG}/?page=2"):
        st, h = fetch(BASE + quote(path))
        got = post_ids(h) if st == 200 else []
        print(f"tag page {path}: {st} len={len(h)} posts={len(got)}", flush=True)
        ids += [i for i in got if i not in ids]
    st, sm = fetch(f"{BASE}/sitemap.xml")
    locs = re.findall(r"<loc>([^<]+)</loc>", sm) if st == 200 else []
    print(f"sitemap.xml: {st} locs={len(locs)} first={locs[:3]} last={locs[-3:]}", flush=True)
    files = locs[-(3 + a.skip_hours):len(locs) - a.skip_hours] if a.skip_hours else locs[-3:]
    for u in files[::-1]:
        st2, t = fetch(u)
        got = post_ids(t) if st2 == 200 else []
        print(f"  sitemap file {u}: {st2} posts={len(got)}", flush=True)
        sm_ids = [i for i in got if i not in ids]
        random.Random(a.seed).shuffle(sm_ids)
        ids += sm_ids
    print(f"\ncandidate posts: {len(ids)}", flush=True)

    rows, n_fetch = [], 0
    for pid in ids:
        if n_fetch >= a.max_posts:
            break
        p = read_post(pid)
        n_fetch += 1
        if p.get("ld_listing") and sum(1 for r in rows if r.get("printed_ld")) < 3:
            p["printed_ld"] = True
            print(f"LD-JSON {pid}: {p['ld_listing'][:1500]}", flush=True)
        if n_fetch <= 2:
            print(f"STRUCTURE {pid}: { {k: v for k, v in p.items() if k not in ('title', 'body')} }", flush=True)
        if p.get("status") != 200:
            print(f"  {pid}: HTTP {p.get('status')}", flush=True)
            continue
        if not p["has_tag"]:
            continue
        verdict, why = classify(p.get("title"), p.get("body"))
        p["verdict"], p["why"] = verdict, why
        rows.append(p)
        if len(rows) >= a.want:
            break

    c = Counter(r["verdict"] for r in rows)
    print(f"\nfetched={n_fetch} real-estate-tagged={len(rows)} verdicts={dict(c)}\n", flush=True)
    for r in rows:
        t = redact_pii(r.get("title") or "") or ""
        b = (redact_pii(r.get("body") or "") or "").replace("\n", " ")[:160]
        print(f"[{r['verdict']:7}] {r['id']} | {t[:80]} | {b} | ({r['why']}) geo={r['geo']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
