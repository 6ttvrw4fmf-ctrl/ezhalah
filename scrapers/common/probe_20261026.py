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
