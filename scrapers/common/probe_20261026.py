"""One-off CI probe (⚡ 2026-10-26, backlog 867/868). Prints only; writes nothing."""
import os, re, time
from curl_cffi import requests as cc

PURL = os.environ.get("WASALT_PROXY_URL", "").strip()


def routes():
    yield "direct", None
    if PURL:
        yield "proxy", {"http": PURL, "https": PURL}


def get(url, proxies=None, prof="chrome124", **kw):
    s = cc.Session(impersonate=prof, proxies=proxies)
    t = time.time()
    try:
        r = s.get(url, timeout=kw.pop("timeout", 45), **kw)
        return r, f"{r.status_code} {len(r.content)}B {time.time()-t:.1f}s"
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {str(e)[:150]} {time.time()-t:.1f}s"


def senan():
    base = "https://www.senanrealestate.sa"
    for rt, px in routes():
        r, info = get(base + "/", px)
        print(f"SENAN {rt} / -> {info}", flush=True)
        if r is None or r.status_code != 200:
            continue
        html = r.text
        print("SENAN title:", re.findall(r"<title>(.*?)</title>", html, re.S)[:1])
        print("SENAN generator/meta:", re.findall(r'<meta[^>]+(?:generator|og:site_name)[^>]*>', html)[:5])
        srcs = re.findall(r'<script[^>]+src="([^"]+)"', html)
        print("SENAN scripts:", srcs[:30])
        links = sorted(set(re.findall(r'href="(/[^"#?]{1,80})"', html)))
        print("SENAN links:", links[:80])
        apis = sorted(set(re.findall(r'https?://[a-zA-Z0-9.\-]+/[^"\'\s<>]{0,80}', html)))
        print("SENAN abs urls:", [a for a in apis if 'api' in a.lower() or 'nuzul' in a.lower()][:40])
        print("SENAN html head 1500:", html[:1500].replace("\n", " "))
        for src in srcs[:25]:
            u = src if src.startswith("http") else base + src
            jr, ji = get(u, px)
            if jr is None or jr.status_code != 200:
                continue
            found = sorted(set(re.findall(r'["\'`](/api/[^"\'`]{2,90}|https?://[a-z0-9.\-]*(?:api|nuzul)[a-z0-9.\-]*[^"\'`]{0,80})["\'`]', jr.text)))
            if found:
                print(f"SENAN js {src[:80]} -> {found[:40]}", flush=True)
        for p in ("/api/public/v2/projects?page=1&per_page=1", "/api/public/v3/properties?page=1&per_page=1",
                  "/api/public/v1/properties?page=1&per_page=1", "/properties", "/projects", "/sitemap.xml",
                  "/robots.txt", "/ar/properties", "/units", "/en/properties"):
            pr, pi = get(base + p, px)
            body = (pr.text[:300].replace("\n", " ") if pr is not None else "")
            print(f"SENAN {rt} {p} -> {pi} :: {body}", flush=True)
        break


def holoul():
    api = "https://app.holoul.io/customer/api/v1/units/"
    for rt, px in routes():
        for path in ("https://app.holoul.io/", "https://holoul.io/", f"{api}?page=0&per_page=1",
                     f"{api}?page=0&per_page=10", f"{api}?page=0&per_page=100",
                     "https://app.holoul.io/customer/api/v1/projects/?page=0&per_page=5",
                     "https://app.holoul.io/units"):
            for prof in ("chrome124", "safari17_0"):
                r, info = get(path, px, prof, headers={"Accept-Language": "ar", "Accept": "application/json, text/plain, */*",
                                                     "Referer": "https://app.holoul.io/", "Origin": "https://app.holoul.io"}, timeout=90)
                body = r.text[:250].replace("\n", " ") if r is not None else ""
                hdr = {k: v for k, v in (r.headers.items() if r is not None else []) if k.lower() in ("server", "via", "x-cache", "cf-ray", "content-type")}
                print(f"HOLOUL {rt}/{prof} {path} -> {info} {hdr} :: {body}", flush=True)
        r, _ = get("https://app.holoul.io/", px)
        if r is not None and r.status_code == 200:
            srcs = re.findall(r'(?:src|href)="([^"]+\.js)"', r.text)
            print("HOLOUL scripts:", srcs[:20])
            for src in srcs[:15]:
                u = src if src.startswith("http") else "https://app.holoul.io" + src
                jr, _ = get(u, px)
                if jr is not None and jr.status_code == 200:
                    f = sorted(set(re.findall(r'["\'`]((?:https?://[a-z0-9.\-]+)?/(?:customer/)?api/[^"\'`]{2,80})["\'`]', jr.text)))
                    if f:
                        print(f"HOLOUL js {src[:70]} -> {f[:30]}", flush=True)


if __name__ == "__main__":
    senan()
    holoul()


def sakani():
    import json as _j
    from scrapers.sakani import run as S
    s = S.session()
    for size, pg in ((20, 1), (1000, 1), (1000, 2), (1000, 3), (1000, 4)):
        t = time.time()
        got = S.fetch_json(s, S.SEARCH, {"filter[marketplace_purpose]": "sale", "page[size]": size, "page[number]": pg})
        if not got:
            print(f"SAKANI sale size={size} pg={pg}: unread", flush=True)
            continue
        st, b = got
        data = (b or {}).get("data") or []
        rich = (((b or {}).get("meta") or {}).get("first_page") or {}).get("data") or []
        kinds = {}
        for d in data:
            a = d.get("attributes") or {}
            k = f"{a.get('resource_type')}:{','.join(a.get('unit_types') or []) if isinstance(a.get('unit_types'), list) else a.get('unit_types')}"
            kinds[k] = kinds.get(k, 0) + 1
        print(f"SAKANI sale size={size} pg={pg}: HTTP {st} data={len(data)} rich={len(rich)} {time.time()-t:.1f}s meta_keys={list(((b or {}).get('meta') or {}).keys())}", flush=True)
        print("SAKANI kinds:", sorted(kinds.items(), key=lambda x: -x[1])[:25], flush=True)
        if size == 20:
            mu = [d for d in data if (d.get("attributes") or {}).get("resource_type") == "market_units"][:2]
            print("SAKANI search row:", _j.dumps(mu[:1], ensure_ascii=False)[:2500], flush=True)
            ids = {d.get("id") for d in mu}
            rr = [r for r in rich if r.get("id") in ids]
            print("SAKANI rich types:", sorted({r.get('type') for r in rich}), flush=True)
            print("SAKANI rich row:", _j.dumps(rr[:1], ensure_ascii=False)[:3500], flush=True)
            pr = [d for d in data if (d.get("attributes") or {}).get("resource_type") != "market_units"][:1]
            print("SAKANI project row:", _j.dumps(pr, ensure_ascii=False)[:1200], flush=True)
        time.sleep(2)
    for uid in ("22147", "24798"):
        st, d = S.fetch_detail(s, uid)
        print(f"SAKANI detail {uid}: {st}", _j.dumps({k: (d or {}).get(k) for k in ("status", "publish", "unit_type", "unit_price", "unit_area", "district_id", "land_type", "description", "rega_ad_license", "city_id", "marketplace_purpose", "price", "selling_price")}, ensure_ascii=False)[:2500], flush=True)
        print(f"SAKANI detail {uid} keys:", sorted((d or {}).keys()), flush=True)
        time.sleep(2)


def holoul_pages():
    api = "https://app.holoul.io/customer/api/v1/units/"
    h = {"Accept-Language": "ar"}
    for size, n in ((100, 3), (10, 24)):
        for pg in range(n):
            r, info = get(f"{api}?page={pg}&per_page={size}", None, "chrome124", headers=h, timeout=90)
            ids = ""
            if r is not None and r.status_code == 200:
                try:
                    ids = [u.get("id")[:8] for u in r.json().get("result") or []][:12]
                except Exception as e:  # noqa: BLE001
                    ids = f"json {e}"
            else:
                ids = (r.text[:200] if r is not None else "")
            print(f"HOLOULPG size={size} pg={pg} -> {info} {ids}", flush=True)
    for pg in range(10, 24):
        for sub in range(10):
            r, info = get(f"{api}?page={pg*10+sub}&per_page=1", None, "chrome124", headers=h, timeout=60)
            if r is None or r.status_code != 200:
                print(f"HOLOUL1 bad page={pg*10+sub} -> {info}", flush=True)


def senan2():
    import re as _re
    base = "https://senanrealestate.sa"
    r, i = get(base + "/sitemap.xml")
    locs = _re.findall(r"<loc>([^<]+)</loc>", r.text if r is not None else "")
    print("SENAN2 sitemap", i, len(locs), locs, flush=True)
    r, i = get(base + "/assets/site.js")
    js = r.text if r is not None else ""
    print("SENAN2 site.js", i, flush=True)
    print("SENAN2 JS head 3000:", js[:3000], flush=True)
    for m in _re.finditer(r"(fetch\(|\.json|data/|price|سعر)", js):
        print("SENAN2 JS ctx:", js[max(0, m.start()-150):m.start()+200].replace("\n", " "), flush=True)
    r, i = get(base + "/projects")
    t = r.text if r is not None else ""
    body = t[t.find("<body"):]
    print("SENAN2 /projects body:", i, _re.sub(r"\s+", " ", body)[:6000], flush=True)
    pages = [u for u in locs if "project" in u or "unit" in u or "propert" in u][:3]
    for u in pages:
        r, i = get(u)
        t = r.text if r is not None else ""
        print(f"SENAN2 PAGE {u} {i}", flush=True)
        for ld in _re.findall(r'<script type="application/ld\+json">(.*?)</script>', t, _re.S)[:4]:
            print("SENAN2 LD:", _re.sub(r"\s+", " ", ld)[:2500], flush=True)
        b = t[t.find("<body"):]
        print("SENAN2 BODY:", _re.sub(r"\s+", " ", b)[:7000], flush=True)
    for p in ("/data/projects.json", "/assets/data.json", "/projects.json", "/data.json", "/assets/projects.json"):
        r, i = get(base + p)
        print(f"SENAN2 {p} {i} :: {(r.text[:300] if r is not None else '')}", flush=True)
