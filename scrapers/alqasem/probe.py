"""PROBE ONLY (branch probe/alqasem-cg-1114, never merged): per-row verdict for every served alqasem link."""
import re, sys, time, html
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scrapers.alqasem.run import session
ROWS = [
('C',13107276,'%d8%a7%d8%b1%d8%b6-%d8%aa%d8%ac%d8%a7%d8%b1%d9%8a%d8%a9-%d8%b3%d9%83%d9%86%d9%8a%d8%a9-%d9%84%d9%84%d8%a8%d9%8a%d8%b9'),
('R',13107227,'%d8%b9%d9%85%d8%a7%d8%b1%d8%a9-%d9%83%d8%a7%d9%85%d9%84%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1'),
('R',13107228,'%d9%81%d9%8a%d9%84%d8%a7-%d9%81%d8%a7%d8%ae%d8%b1%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1'),
('R',13107229,'%d8%b4%d9%82%d8%a9-%d8%b1%d8%a7%d9%82%d9%8a%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1'),
('R',13107230,'%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%ad%d8%b3%d9%86-%d8%a7%d9%84%d8%a8%d8%af%d8%b1'),
('R',13107231,'%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%b7%d9%86%d8%ac%d8%a9'),
('R',13107232,'%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%b4%d8%a7%d8%b1%d8%b9-%d8%a7%d9%84%d9%82%d8%b4%d8%a7%d8%b4%d9%8a%d8%a9'),
('R',13107242,'%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%af%d9%88%d8%b1-%d9%81%d8%a7%d8%ae%d8%b1-%d8%a8%d8%ad%d9%8a-%d8%b9%d9%84%d9%8a%d8%b4%d8%a9-f4a'),
('R',13107243,'%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%af%d9%88%d8%b1-%d9%81%d8%a7%d8%ae%d8%b1-%d8%a8%d8%ad%d9%8a-%d8%b9%d9%84%d9%8a%d8%b4%d8%a9-f5b'),
('R',13107246,'%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%af%d9%88%d8%b1-%d9%81%d8%a7%d8%ae%d8%b1-%d8%a8%d8%ad%d9%8a-%d8%b9%d9%84%d9%8a%d8%b4%d8%a9-r9c'),
('R',13107252,'%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%af%d9%88%d8%b1-%d9%81%d8%a7%d8%ae%d8%b1-%d8%a8%d8%ad%d9%8a-%d8%b9%d9%84%d9%8a%d8%b4%d8%a9-r7a'),
('R',13107253,'%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%af%d9%88%d8%b1-%d9%81%d8%a7%d8%ae%d8%b1-%d8%a8%d8%ad%d9%8a-%d8%b9%d9%84%d9%8a%d8%b4%d8%a9-f6c'),
('R',13107256,'%d8%af%d9%88%d8%b1-vip-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-r2b'),
('R',13107257,'%d8%af%d9%88%d8%b1-vip-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-r1a'),
('R',13107258,'%d8%af%d9%88%d8%b1-vip-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-f2b'),
('R',13107259,'%d8%af%d9%88%d8%b1-vip-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-f1a'),
('R',13107260,'%d8%af%d9%88%d8%b1-vip-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-g2b'),
('R',13107261,'%d8%af%d9%88%d8%b1-vip-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-g1a'),
('R',13107263,'%d8%af%d9%88%d8%b1-%d9%84%d9%84%d8%a7%d9%8a%d8%ac%d8%a7%d8%b1-vip-g2'),
('R',13107267,'%d8%af%d9%88%d8%b1-%d9%84%d9%84%d8%a7%d9%8a%d8%ac%d8%a7%d8%b1-vip'),
('R',13107268,'%d8%af%d9%88%d8%b1-vip-%d9%84%d9%84%d8%a7%d9%8a%d8%ac%d8%a7%d8%b1'),
('R',13107271,'%d8%aa%d8%a7%d9%88%d9%86-%d9%87%d8%a7%d9%88%d8%b3-%d9%84%d9%84%d8%a8%d9%8a%d8%b9'),
('R',13107273,'%d9%81%d9%8a%d9%84%d8%a7-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81-%d8%ad%d9%8a-%d8%b9%d9%84%d9%8a%d8%b4%d9%87'),
]
s = session()
for t, i, slug in ROWS:
    u = f"https://alqasem.com.sa/property/{slug}/"
    try:
        r = s.get(u, timeout=30, allow_redirects=True); st, body, fin = r.status_code, r.text or "", str(r.url)
    except Exception as e:
        st, body, fin = -1, "", repr(e)[:80]
    time.sleep(1.2)
    gone = "هذا العقار لم يعد متاحاً" in body
    stamp = re.search(r"(تم البيع|تم التأجير|تم الإيجار)\s*\n?\s*(في [^<\n]{0,20})?", re.sub(r"<[^>]+>", "\n", body))
    title = (re.search(r"<title>(.*?)</title>", body, re.S) or [None, ""])[1][:70]
    lic = re.findall(r"72\d{8}", body)[:1]
    price = re.findall(r'"price"\s*:\s*"?([\d.]+)', body)[:1]
    print(f"VERDICT {t} {i} status={st} final={fin} gone_banner={gone} stamp={stamp.group(0).strip()[:30] if stamp else None} lic={lic} ldprice={price} title={html.unescape(title)}", flush=True)
