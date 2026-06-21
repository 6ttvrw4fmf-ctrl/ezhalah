"""One-off recovery: restore the real city for Wasalt listings stuck in city='Other'.

Root cause: the base scraper does `city = CITY_MAP.get(raw_city) or "Other"`, so any Wasalt
city spelling NOT in CITY_MAP (e.g. "Hayil" vs "Hail", "Hafar Al-Batin" vs "Hafar Al Batin",
"Al Jumum - Bahra") was dropped to "Other" — and the raw spelling was never stored. The real
city is still on each listing's detail page, so we re-fetch it.

Phase 1 (collect): re-fetch every Other listing's detail page, read the raw city, cache to JSON.
Phase 2 (apply):   normalize raw->canonical, then UPDATE the DB rows (city + region).

Usage:
  python -m scrapers.wasalt.recover_other collect   # fetch real cities -> /tmp cache (resumable)
  python -m scrapers.wasalt.recover_other apply      # map + backfill DB from the cache
"""
from __future__ import annotations
import json, re, sys, time
from collections import Counter
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from curl_cffi import requests as cc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))
from scrapers.common import db  # noqa: E402

OUT = Path("/tmp/wasalt_other_recovery.json")
BASE = "https://wasalt.sa"
TABLES = ("wasalt_residential_listings", "wasalt_commercial_listings")


def _load() -> dict:
    return json.loads(OUT.read_text()) if OUT.exists() else {}


def _save(p: dict) -> None:
    OUT.write_text(json.dumps(p))


def _slug(url: str | None) -> str | None:
    return url.rsplit("/property/", 1)[-1] if url and "/property/" in url else None


def _dig(obj, keys) -> dict:
    found: dict = {}
    def rec(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in keys and isinstance(v, (str, int, float)) and str(v).strip():
                    found.setdefault(k, str(v).strip())
                rec(v)
        elif isinstance(o, list):
            for x in o:
                rec(x)
    rec(obj)
    return found


def _fetch(slug: str) -> dict:
    s = cc.Session(impersonate="chrome124")
    for attempt in range(3):
        try:
            r = s.get(f"{BASE}/en/property/{slug}", timeout=30)
            m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
            if not m:
                time.sleep(1); continue
            data = json.loads(m.group(1))
            return _dig(data, {"city", "cityName", "state", "stateName",
                               "region", "regionName", "district", "province"})
        except Exception:
            time.sleep(2 * (attempt + 1))
    return {}


def _other_rows() -> list[dict]:
    c = db.sb()
    rows: list[dict] = []
    for tbl in TABLES:
        off = 0
        while True:
            batch = (c.table(tbl).select("ad_number,listing_url")
                     .eq("source", "Wasalt").eq("active", True).eq("city", "Other")
                     .range(off, off + 999).execute().data) or []
            for b in batch:
                b["_tbl"] = tbl
            rows += batch
            if len(batch) < 1000:
                break
            off += 1000
    return rows


def collect() -> int:
    rows = _other_rows()
    prog = _load()
    todo = [r for r in rows if r["ad_number"] not in prog]
    print(f"Other rows={len(rows)}  cached={len(prog)}  todo={len(todo)}", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=10) as ex:
        futs = {ex.submit(_fetch, _slug(r["listing_url"])): r for r in todo}
        for fut in as_completed(futs):
            r = futs[fut]
            f = fut.result()
            prog[r["ad_number"]] = {
                "tbl": r["_tbl"],
                "raw": f.get("city") or f.get("cityName") or "",
                "state": f.get("state") or f.get("region") or f.get("province") or "",
                "district": f.get("district") or "",
            }
            done += 1
            if done % 50 == 0:
                _save(prog)
                print(f"  {done}/{len(todo)}", flush=True)
    _save(prog)
    tally = Counter(v["raw"] for v in prog.values())
    print(f"\n=== distinct raw cities: {len(tally)} ===", flush=True)
    for city, n in tally.most_common(120):
        print(f"  {n:5}  {city!r}", flush=True)
    return 0


# raw Wasalt city spelling → our canonical DB city label
RAW_TO_CANONICAL: dict[str, str] = {
    # Already-covered cities with new spelling variants found in recovery
    "Hayil": "Hail",
    "Hafar Al-Batin": "Hafar Al Batin",
    "Al Hayathem": "Al Hayathim",
    "Al Jumum - Bahra": "Al Jumum",
    "Aljumum": "Al Jumum",
    "Ahad Rafidah": "Ahad Rafidah",
    "Ahad Rifaydah - Al-Wadyin Station": "Ahad Rafidah",
    "Ahad Almasarihah": "Ahad Al Masarihah",
    "Samith": "Samtah",
    "Samtah - Alqafl": "Samtah",
    "Tbwk": "Tabuk",
    "Abu Arish - 'Abu Earish": "Abu Arish",
    "Sibya'": "Sabya",
    "Ar Rass": "Ar Rass",
    "Al Jubaylah": "Jubail",
    "Alliyth": "Al Lith",
    "Bisha": "Bisha",
    "Al-Majma'Ah": "Al Majmaah",
    "Malahum": "Mahayel",
    "Muhayil": "Mahayel",
    "Almudhanib": "Al Mithnab",
    "King Abdullah Economic City": "KAEC",
    "Biqaea'": "Baqaa",
    "Albadayie": "Al Badai",
    "Al-Quway'Iyah": "Al Quwayiyah",
    "Al Quwayiyah - Al Ruwaydah": "Al Quwayiyah",
    "Earear": "Arar",
    "Eafif": "Afif",
    "Al-Qassab": "Al Quwayiyah",
    "Al Aflaj": "As Sulayyil",
    "Rabigh": "Rabigh",
    "Riyadh Al Khabra": "Riyadh Al Khabra",
    "Al Khafji": "Khafji",
    "Dawadmi": "Dawadmi",
    "Alghat": "Al Ghat",
    "Qurayyat": "Qurayyat",
    "Al Hayathem": "Al Hayathim",
    "Wadi Ad-Dawasir": "As Sulayyil",
    "Sharurah": "Sharurah",
    "Sakakah": "Sakaka",
    "Baysh": "Baysh",
    "Thadiq": "Thadiq",
    "Shaqra": "Shaqra",
    "Baljurashi": "Al Baha",
    "Al-Makhwah": "Al Baha",
    "Al-Aqiq": "Al Baha",
    "Darih": "Al Baha",
    "Nariya": "An Nairyah",
    "Aleuyun": "Al Uyun",
    "Alnabhaniyah": "An Nabhaniyah",
    "Almajardah": "Al Majardah",
    "Damad": "Jazan",
    "Al Ghazalah - Al Ghazalah": "Al Ghazalah",
    "Al Ghazalah - Alruwduh": "Al Ghazalah",
    "Ash Shinan": "Ash Shanan",
    "Aldalimih": "Dawadmi",
    "Darma": "Diriyah",
    "Rawdat Sudair": "Al Majmaah",
    "Ashayrah Sudair": "Al Majmaah",
    "Thuqbah": "Khobar",
    "Al Qaisumah": "Hafar Al Batin",
    "Mahd Al Thahab": "Mahd adh Dhahab",
    "Sarat Ubaida": "Khamis Mushait",
    "Harimla'": "Thadiq",
    "Ramah": "Rumah",
}

# 99-city → 13-region map (authoritative, reconciled to exact DB totals)
CITY_TO_REGION: dict[str, str] = {
    "Riyadh": "Riyadh", "Al Kharj": "Riyadh", "Al Muzahimiyah": "Riyadh",
    "Diriyah": "Riyadh", "Al Majmaah": "Riyadh", "Thadiq": "Riyadh",
    "Shaqra": "Riyadh", "Al Quwayiyah": "Riyadh", "Al Zulfi": "Riyadh",
    "Dawadmi": "Riyadh", "Hawtat Bani Tamim": "Riyadh", "Rumah": "Riyadh",
    "Al Ghat": "Riyadh", "Al Dalam": "Riyadh", "Afif": "Riyadh",
    "As Sulayyil": "Riyadh", "Al Hariq": "Riyadh", "Al Ammariyah": "Riyadh",
    "Malham": "Riyadh", "Al Hayathim": "Riyadh",
    "Jeddah": "Makkah", "Mecca": "Makkah", "Taif": "Makkah",
    "Thuwal": "Makkah", "KAEC": "Makkah", "Al Qunfudhah": "Makkah",
    "Rabigh": "Makkah", "Al Jumum": "Makkah", "Al Lith": "Makkah",
    "Al Kamil": "Makkah", "Raniyah": "Makkah", "Turabah": "Makkah", "Al Khurma": "Makkah",
    "Medina": "Madinah", "Al Hanakiyah": "Madinah", "Yanbu": "Madinah",
    "Al Ula": "Madinah", "Mahd adh Dhahab": "Madinah", "Badr": "Madinah", "Khaybar": "Madinah",
    "Dammam": "Eastern Province", "Khobar": "Eastern Province", "Hofuf": "Eastern Province",
    "Dhahran": "Eastern Province", "Jubail": "Eastern Province", "Hafar Al Batin": "Eastern Province",
    "Abqaiq": "Eastern Province", "An Nairyah": "Eastern Province", "Safwa": "Eastern Province",
    "Qatif": "Eastern Province", "Sayhat": "Eastern Province", "Khafji": "Eastern Province",
    "Tarout": "Eastern Province", "Ras Tanura": "Eastern Province", "Anak": "Eastern Province",
    "Al Uyun": "Eastern Province",
    "Buraidah": "Qassim", "Unaizah": "Qassim", "Al Bukayriyah": "Qassim",
    "Riyadh Al Khabra": "Qassim", "Al Badai": "Qassim", "Ar Rass": "Qassim",
    "An Nabhaniyah": "Qassim", "Al Mithnab": "Qassim", "Ash Shamasiyah": "Qassim",
    "Khamis Mushait": "Asir", "Abha": "Asir", "Mahayel": "Asir", "Al Majardah": "Asir",
    "Bisha": "Asir", "Ahad Rafidah": "Asir", "Tathlith": "Asir", "Balsamar": "Asir", "Al Namas": "Asir",
    "Jazan": "Jazan", "Sabya": "Jazan", "Baysh": "Jazan", "Abu Arish": "Jazan",
    "Samtah": "Jazan", "Ahad Al Masarihah": "Jazan",
    "Hail": "Hail", "Baqaa": "Hail", "Al Ghazalah": "Hail", "Ash Shanan": "Hail",
    "Tabuk": "Tabuk", "Tayma": "Tabuk", "Duba": "Tabuk", "Al Wajh": "Tabuk", "Umluj": "Tabuk",
    "Arar": "Northern Borders", "Rafha": "Northern Borders", "Turaif": "Northern Borders",
    "Sakaka": "Al Jawf", "Dawmat Al Jandal": "Al Jawf", "Qurayyat": "Al Jawf",
    "Najran": "Najran", "Sharurah": "Najran",
    "Al Baha": "Al Bahah",
}


def apply() -> int:
    prog = _load()
    if not prog:
        print("No cache file found — run collect first"); return 1

    c = db.sb()
    updated = 0
    skipped_no_city = 0

    # Group by table
    by_tbl: dict[str, list[tuple[str, str, str]]] = {}
    for ad_num, v in prog.items():
        raw = v.get("raw", "")
        canonical = RAW_TO_CANONICAL.get(raw) or (raw if raw in CITY_TO_REGION else "")
        if not canonical:
            skipped_no_city += 1
            continue
        region = CITY_TO_REGION.get(canonical, "")
        tbl = v["tbl"]
        by_tbl.setdefault(tbl, []).append((ad_num, canonical, region))

    for tbl, rows in by_tbl.items():
        for i in range(0, len(rows), 100):
            batch = rows[i:i+100]
            for ad_num, city, region in batch:
                c.table(tbl).update({"city": city, "region": region}).eq("ad_number", ad_num).execute()
            updated += len(batch)
            print(f"  {tbl}: {min(i+100, len(rows))}/{len(rows)} updated", flush=True)

    print(f"\n✓ Backfilled {updated} rows with real city")
    print(f"  Still 'Other' (genuinely no city on Wasalt): {skipped_no_city}")
    return 0


def stamp_region_all() -> int:
    """Stamp clean region on ALL listings across all 4 sources using CITY_TO_REGION map."""
    c = db.sb()
    tables = [
        "aqar_residential_listings", "aqar_commercial_listings",
        "wasalt_residential_listings", "wasalt_commercial_listings",
        "aldarim_residential_listings", "aldarim_commercial_listings",
        "aqargate_residential_listings", "aqargate_commercial_listings",
    ]
    total = 0
    for tbl in tables:
        for city, region in CITY_TO_REGION.items():
            r = c.table(tbl).update({"region": region}).eq("city", city).execute()
            cnt = len(r.data) if r.data else 0
            if cnt:
                total += cnt
        print(f"  ✓ {tbl} done", flush=True)
    print(f"\n✓ Stamped region on {total} rows across all tables")
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "collect"
    if cmd == "collect":
        raise SystemExit(collect())
    elif cmd == "apply":
        raise SystemExit(apply())
    elif cmd == "stamp_region":
        raise SystemExit(stamp_region_all())
    else:
        print(f"Unknown cmd: {cmd}"); raise SystemExit(1)
