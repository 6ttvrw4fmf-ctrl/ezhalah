"""TEMPORARY read-only probe (scraping-engineer 2026-10-09): what does dwelleo publish now? No DB writes."""
import re, json, curl_cffi.requests as cc

s = cc.Session(impersonate="chrome")
def get(url, **kw):
    try:
        r = s.get(url, timeout=40, **kw)
        return r.status_code, r.text
    except Exception as e:  # noqa
        return None, repr(e)

for u in ["https://api.dwelleo.sa/api/v1/properties?page=1",
          "https://api.dwelleo.sa/api/v1/properties?page=1&listing_type=for-sale",
          "https://api.dwelleo.sa/api/v1/properties?page=1&status=publish",
          "https://api.dwelleo.sa/api/v2/properties?page=1",
          "https://api.dwelleo.sa/api/v1/properties/search?page=1",
          "https://api.dwelleo.sa/api/v1/projects?page=1",
          "https://dwelleo.sa/sitemap.xml", "https://www.dwelleo.sa/sitemap.xml",
          "https://dwelleo.sa/sitemaps/properties.xml", "https://www.dwelleo.sa/sitemaps/properties.xml",
          "https://www.dwelleo.sa/robots.txt"]:
    st, t = get(u, headers={"Accept": "application/json, text/xml, */*", "Accept-Language": "ar"})
    print(f"=== {st} {len(t)} {u}\n{t[:900]}\n", flush=True)

for u in ["https://www.dwelleo.sa/ar/properties", "https://www.dwelleo.sa/ar/properties/for-sale",
          "https://www.dwelleo.sa/ar/properties/for-rent", "https://www.dwelleo.sa/ar"]:
    st, t = get(u, headers={"Accept-Language": "ar"})
    print(f"=== HTML {st} {len(t)} {u}", flush=True)
    links = sorted(set(re.findall(r'/ar/properties/for-[a-z-]+/[^"\'\s<>\\]+', t)))
    print("detail-links", len(links), links[:8])
    apis = sorted(set(re.findall(r'https?://api\.dwelleo\.sa/[A-Za-z0-9_/\-?.=&]+', t)))
    print("api-urls", apis[:30])
    apis2 = sorted(set(re.findall(r'["\'](/api/v\d/[A-Za-z0-9_/\-]+)', t)))
    print("api-paths", apis2[:30])
    for k in ("__NEXT_DATA__", "self.__next_f", "__NUXT__", "total", "pagination"):
        i = t.find(k); print(k, i, t[i:i+300].replace("\n", " ") if i >= 0 else "")
    js = sorted(set(re.findall(r'(/_next/static/[^"\']+\.js|/_nuxt/[^"\']+\.js)', t)))[:60]
    print("js", len(js))
    for j in js:
        st2, jt = get("https://www.dwelleo.sa" + j)
        hits = sorted(set(re.findall(r'(?:api\.dwelleo\.sa)?/api/v\d/[A-Za-z0-9_/\-]+', jt)))
        if hits: print("  JS", j, hits[:40])
    print(flush=True)
