"""Card parity: does the card a customer opens say what the SOURCE ad says? (2026-11-06)

WHY. On 11-06 the Falcon found ~37,000 live ads on ~45 sites whose source shows a REGA licence that the card never
printed; on 11-05 Dwelleo's 4,791 served links had died and nobody saw it until the owner clicked one. Each check we
had looked at one layer (stored vs source for NEW ads, link status, licence key). This one looks where the customer
looks: OUR CARD next to THE SOURCE PAGE, for every active website, every day.

WHAT IT DOES, per run (one of SLOTS slices of loader_active_platforms_ar(), so the fleet is spread through the day):
  1. Picks 1-2 random served ads per website (search_listings_ar, production_ready, a type the Filter can tap).
  2. CARD: the real customer journey on production (e2e/engineers/customer-journey.mjs --card-full): Filter search,
     find the card, read its whole text and whether its photo painted, click it, record the page it opened.
     ONE browser at a time, batches of <= 12, and before every batch the database must be quiet
     (ops_capacity_db_activity, the capacity robot's own rule) or the run waits, then stops.
  3. SOURCE: the ad page rendered in Chromium with the honest UA «Ezhalah-bot/1.0», only where robots.txt allows
     it, <= 1 page a second per site, and the site is left alone on the first challenge/wall. Property Finder ad
     pages are robots-forbidden: its ads are picked FROM the robots-allowed category page and compared with that
     page's own __NEXT_DATA__ record.
  4. Field by field (price, rent period, area, rooms, baths, city, district, licence, photo, link): the stored value
     against the page with the tuned comparator of the nightly new-listings score (compare_listing), and the card's
     own text against the stored value («card_missing» = the source states it, we store it, the card does not
     print it). Unreadable / page-silent are never wrong.
  5. REPAIR FIRST: a link the site redirects to the same ad's new address is rewritten (served_link_check rules);
     a licence the page and our row agree on but the card key lacks is copied into additional_info.
  6. One row per website per night into ops_card_parity; mon_detect_card_parity raises P1 per website × field class.

  python -m scrapers.common.card_parity                          # this hour's slice, write + repair
  python -m scrapers.common.card_parity --sites tuba,muhaysini --dry-run
  python -m scrapers.common.card_parity --all                    # every website (first full run)
"""
from __future__ import annotations

import argparse
import html as _html
import json
import os
import random
import re
import subprocess
import sys
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path
from urllib import robotparser
from urllib.parse import urlsplit

from scrapers.common.db import sb
from scrapers.common.new_listings_score import (
    CONTACT_LINE, DISTRICT_ON_PAGE, MATCH, MISMATCH, PAGE_SILENT, PROSE_ONLY_DISTRICT, SKIP_PRICE, STORED,
    UNREADABLE, WE_MISS,
    closed_ad_page, compare_listing, is_other_ads_page, load_owner_district_aliases, norm, norm_district,
    page_lacks_its_ad, scope_to_its_ad,
)
from scrapers.common.served_link_check import classify, repairable
from scrapers.common.source_reread import page_evidence, page_image_count

TABLE = "ops_card_parity"
UA = "Ezhalah-bot/1.0 (+https://ezhalah.com)"
SLOTS = 6                    # slices a day; the cron fires every 4 hours, one slice each
PER_SITE = 2
BATCH = 12                   # the journey's own hard cap per run
PACE_S = 1.0
FOREIGN_ACTIVE_MAX = 8       # scripts/lib/capacityRamp.ts databaseBusy
CARD_MISSING, REPAIRED = "card_missing", "repaired"
VERDICTS = (MATCH, MISMATCH, WE_MISS, PAGE_SILENT, UNREADABLE, CARD_MISSING, REPAIRED)
FIELDS = ("price", "rent_period", "area", "bedrooms", "bathrooms", "city", "district", "licence", "photo", "link")
SOURCE_FIELDS = ("price", "rent_period", "area", "bedrooms", "bathrooms", "city", "district")
WALL = ("captcha", "security check", "attention required", "cf-chl", "access denied", "are you a robot",
        "verify you are human", "request blocked", "just a moment", "challenge-platform")
ROOT = Path(__file__).resolve().parents[2]
JOURNEY = ROOT / "e2e/engineers/customer-journey.mjs"
# The REGA AD licence (7xxxxxxxxx), never the broker's FAL licence (1xxxxxxxxx) printed beside it: muhaysini 34988
# prints «رقم رخصة فال: 1200025871 رقم ترخيص الاعلان: 7200990751» (smoke run 2026-11-06).
AD_LICENCE = re.compile(r"(?:ترخيص (?:ال)?[اإ]علان|رخص[ةه] (?:ال)?[اإ]علان|رقم الترخيص(?!\s*فال)|رقم ترخيص(?!\s*فال)|"
                        r"ad(?:vertis\w*)? licen[cs]e|advertising licen[cs]e)[^\d\n]{0,30}(7[12]\d{8})(?!\d)", re.I)
LICENCE = re.compile(r"(?:رخص|ترخيص|licen[cs]e|rega)[^\d\n]{0,40}(7[12]\d{8})(?!\d)", re.I)
# Only the REGA AD-licence shape 71/72xxxxxxxx: remaxsa's office licence «1100029634» and holoul's «7032067345» sat beside
# every ad's label on the first full run (2026-11-07) and read as the ad's licence.
_DIG = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


# ── pure parts ──────────────────────────────────────────────────────────────────────────────────

def slot_of(platform: str, slots: int = SLOTS) -> int:
    return zlib.crc32(platform.encode()) % slots


def numbers(text: str) -> set[int]:
    """Every whole figure printed in a text, thousands separators folded («1,200,000» → 1200000)."""
    out = set()
    for t in re.findall(r"\d[\d,٬]*(?:\.\d+)?", (text or "").translate(_DIG)):
        try:
            out.add(int(float(t.replace(",", "").replace("٬", ""))))
        except ValueError:
            pass
    return out


def licence_on_page(page_text: str) -> str | None:
    t = (page_text or "").translate(_DIG)
    m = AD_LICENCE.search(t) or LICENCE.search(t)
    return m.group(1) if m else None


_LABEL = re.compile(r"^(?:ال)?(?:مساحة|مساحه|المساحة الإجمالية|غرف(?: النوم)?|عدد الغرف|دورات المياه|عدد دورات المياه|"
                    r"الحمامات|السعر|الحي|عرض الشارع|عمر العقار)\s*:?$")


def paired_lines(text_head: str) -> list[str]:
    """A label printed on its own line with its value on the next one («المساحة» / «265 م», alqasem and alshawaf
    on the first full run, 2026-11-07) becomes one line, so the comparator reads the value next to its label."""
    lines = [x.strip() for x in (text_head or "").split(" | ")]
    # «04» is 4 (dwelleo prints «عدد دورات المياه» / «04», 2026-11-07 slot run)
    return [a + " " + re.sub(r"^0+(?=\d+(?![.\d]))", "", b.translate(_DIG))
            for a, b in zip(lines, lines[1:]) if _LABEL.match(a) and b and len(b) <= 40]


def is_home(url: str | None) -> bool:
    """A link to the site's home page names no ad (alajlan: all 10 ads share «https://alajlan-re.com/»)."""
    return urlsplit(url or "").path.strip("/") == "" and not urlsplit(url or "").query


def stored_licence(stored: dict) -> str | None:
    for v in (stored.get("card_licence"), stored.get("license_number")):
        v = str(v or "").strip()
        if re.fullmatch(r"\d{10}", v):
            return v
    return None


def card_shows(field: str, stored: dict, card_text: str) -> bool | None:
    """Does the card print the value we store? None = nothing stored to look for (pure)."""
    nums, txt = numbers(card_text), norm(card_text)
    if field == "price":
        pt, pa, ppm, area = (stored.get(k) for k in ("price_total", "price_annual", "price_per_meter", "area_m2"))
        cands = {int(round(float(x))) for x in (pt, pa) if x}
        if pa:
            cands |= {int(round(float(pa) / 12)), int(float(pa) // 12)}
        if ppm:
            cands.add(int(round(float(ppm))))
            if area:
                cands.add(int(round(float(ppm) * float(area))))
        return bool(cands & nums) if cands else None
    if field == "rent_period":
        # A rent with no price prints «السعر عند الطلب» with NO period suffix — an owner decision (2026-09-28,
        # src/data/remote.ts card-fetch comment): there is no figure a period could qualify. Nothing to look for
        # (hazim 13106686: yearly, priceless, flagged card_missing on 5 nights for the card working as designed).
        if not any(stored.get(k) for k in ("price_annual", "price_total", "price_per_meter")):
            return None
        p = stored.get("rent_period_ar")
        words = {"سنوي": r"سنوي|سنه|/yr|year", "شهري": r"شهري|شهر|/mo|month"}.get(p or "")
        return bool(re.search(words, txt, re.I)) if words else None
    if field in ("area", "bedrooms", "bathrooms"):
        v = stored.get({"area": "area_m2"}.get(field, field))
        return (int(round(float(v))) in nums) if v and float(v) > 0 else None
    if field == "city":
        v = norm(stored.get("city_ar") or "")
        return (v in txt) if v else None
    if field == "district":
        names = {norm_district(x) for x in (stored.get("district_ar"), stored.get("card_district_raw")) if x}
        names.discard("")
        return any(n in txt for n in names) if names else None
    if field == "licence":
        lic = stored_licence(stored)
        return (lic in (card_text or "").translate(_DIG)) if lic else None
    return None


_PRICE_WORD = r"(?:ريال|ر\.س|SAR)"
_FIGURE = r"\d[\d,٬]*(?:\.\d+)?"


def _figure(s: str) -> float:
    return float(s.replace(",", "").replace("٬", ""))


def _price_as_the_page_prints_it(stored: dict, page: dict, verdict: str) -> str:
    """Three ways a page states OUR price that the shared comparator reads as another one. Each was proven
    on the real page (2026-11-09) and each stays wrong the moment the page prints a different figure.

    1. A printed zero is not a price. macsaib 13604785: the office publishes no price, its page says
       «… 370 م² - 0 ريال», we store none. A real figure beside the currency word keeps WE_MISS.
    2. The page's own per-metre label carries our stored rate. macsaib 13604800: «السعر للمتر: 750», we
       store 750 per metre and no total. Another figure on that label (or «0») stays MISMATCH.
    3. The page prints our stored per-metre rate as its price and our total is that rate × the area.
       villassa 13108884: the ad page prints «1,400 ريال», the site's own list card 700,000 for the same
       500 m² plot; we store both. Any other figure on a price line stays MISMATCH.
    """
    lines = [str(x).translate(_DIG) for x in ([page.get("title") or ""] + list((page.get("meta") or {}).values())
                                              + list(page.get("evidence_lines") or [])
                                              + (page.get("text_head") or "").split(" | ")) if x]
    total, annual = stored.get("price_total"), stored.get("source_price_annual") or stored.get("price_annual")
    ppm, area = stored.get("price_per_meter"), stored.get("area_m2")
    beside = [_figure(a or b) for x in lines for a, b in re.findall(
        rf"({_FIGURE})\s*{_PRICE_WORD}|{_PRICE_WORD}\s*[:：]?\s*({_FIGURE})", x)]
    if verdict == WE_MISS and not (total or annual or ppm):
        # every currency line that carries a digit must carry a zero BESIDE the currency word and nothing else there
        bare = [x for x in lines if re.search(_PRICE_WORD, x) and re.search(r"\d", x)
                and not re.search(rf"{_FIGURE}\s*{_PRICE_WORD}|{_PRICE_WORD}\s*[:：]?\s*{_FIGURE}", x)]
        return PAGE_SILENT if beside and not bare and all(v == 0 for v in beside) else verdict
    if verdict != MISMATCH or not ppm:
        return verdict
    rate = float(ppm)
    if not (total or annual):
        labelled = [_figure(m) for x in lines for m in re.findall(
            rf"سعر\s*(?:ال|لل)?متر(?:\s*المربع)?\s*[:：]?\s*({_FIGURE})", x)]
        return MATCH if labelled and all(v == rate for v in labelled) else verdict
    if total and area and beside and abs(float(total) - rate * float(area)) < rate:
        printed = [v for v in beside if v]
        return MATCH if printed and all(v in (rate, float(total)) for v in printed) else verdict
    return verdict


# The OFFICE's own branch addresses, printed under every ad of the site: never the ad's district.
_OFFICE_ADDRESS = re.compile(r"موقعنا الجغرافي|العنوان\s+(?:الاول|الثاني)(?!\S)")
_DISTRICT_LABEL = re.compile(r"(?<!\S)الحي\s*[:：]\s*")
_NEXT_LABEL = r"(?=\s*$|\s*[|،,]|\s+\S+\s*[:：])"


def _district_as_the_page_states_it(stored: dict, page: dict) -> str:
    """Two ways a page that does NOT contradict our district scored MISMATCH. Each was proven on the real
    page (2026-11-09); a page that names another district of its own still scores MISMATCH.

    1. The page's own labelled field carries our district. fursaghyr 4367079: «الحي: أم الجود المدينة: مكة
       المكرمة» is what we store, and the only «حي X» the comparator saw was the deed prose («حي واحة مكة
       التطويري الأول … مساحة الوحدة»). Every «الحي:» label on the page must carry our district, whole.
    2. The only district named is the office's own address. sqcc 13707588: the ad page states no district
       (ours comes from the site's list card) and its footer prints «العنوان الاول الدمام حي احد … العنوان
       الثاني جدة حي السامر» under every ad. The page said nothing about the ad's district.
    """
    d = norm_district(stored.get("district_ar") or "")
    if not d:
        return MISMATCH
    text = norm(page.get("_text") or "")
    labels = [text[m.end():] for m in _DISTRICT_LABEL.finditer(text)]
    if labels and all(re.match(r"(?:حي\s+)?" + re.escape(d) + _NEXT_LABEL, rest) for rest in labels):
        return MATCH
    lines = [norm(str(x)) for x in ([page.get("title") or ""] + list((page.get("meta") or {}).values())
                                    + list(page.get("evidence_lines") or [])
                                    + (page.get("text_head") or "").split(" | ")) if x]
    naming = [x for x in lines if DISTRICT_ON_PAGE.search(x) and not CONTACT_LINE.search(x)]
    if naming and not labels and all(
            _OFFICE_ADDRESS.search(x) and not DISTRICT_ON_PAGE.search(x[:_OFFICE_ADDRESS.search(x).start()])
            for x in naming):
        return PAGE_SILENT
    return MISMATCH


def judge(stored: dict, card: dict | None, page: dict | None, *, platform: str, link_kind: str | None,
          link_repaired: bool = False, page_photo: bool | None = None) -> dict[str, str]:
    """One ad: every field's verdict. `card` None = the journey never reached the card (render checks skipped);
    `page` None = the source page was not readable (robots, wall, timeout). Pure."""
    out: dict[str, str] = {}
    src = compare_listing(stored, page, skip_price=platform in SKIP_PRICE,
                          prose_only_district=platform in PROSE_ONLY_DISTRICT) if page else {}
    # A land total we serve as the page's per-metre figure × the area is the page's own price (owner rule «PPM × area
    # = shown total»; akariyoun 12049505: page «5,000 ريال للمتر», served 5,600,000 for 1,120 m², 2026-11-07).
    if src.get("price") == MISMATCH and stored.get("price_total") and stored.get("area_m2"):
        total, area = float(stored["price_total"]), float(stored["area_m2"])
        rates = [float(m.replace(",", "").replace("٬", "")) for x in page.get("evidence_lines") or []
                 if re.search(r"للمتر|المتر|/\s*م", x) and re.search(r"ريال|ر\.س|سعر|SAR", x, re.I) for m in re.findall(r"\d[\d,٬]*(?:\.\d+)?", x.translate(_DIG))]
        if any(abs(round(r * area) - total) < 1 for r in rates if r):
            src["price"] = MATCH
    if page and src.get("price") in (MISMATCH, WE_MISS):
        src["price"] = _price_as_the_page_prints_it(stored, page, src["price"])
    if page and src.get("district") == MISMATCH:
        src["district"] = _district_as_the_page_states_it(stored, page)
    for f in SOURCE_FIELDS:
        v = src.get(f, UNREADABLE if page is None else PAGE_SILENT)
        if f == "price" and platform in SKIP_PRICE:
            v = PAGE_SILENT          # owner 10-02: stays are priced by length, the card shows a note, never a figure
        elif card is not None and v == MATCH and card_shows(f, stored, card.get("text", "")) is False:
            v = CARD_MISSING         # the page and our row agree, the customer does not see it
        out[f] = v
    # licence: the page's 10-digit REGA ad licence must be ours and on the card
    lic, plic = stored_licence(stored), (licence_on_page(page.get("_text", "")) if page else None)
    shown = card_shows("licence", stored, card.get("text", "")) if card is not None else None
    if page is None:
        out["licence"] = UNREADABLE
    elif not plic:
        out["licence"] = PAGE_SILENT
    elif not lic:
        out["licence"] = WE_MISS
    elif lic != plic and lic not in page.get("_text", "").translate(_DIG):
        out["licence"] = MISMATCH            # the page prints another licence and never ours
    else:
        out["licence"] = CARD_MISSING if shown is False else MATCH
    # photo: the source shows photos; the card must paint one
    has = card.get("photo") if card is not None else bool(stored.get("has_photo"))
    if page is None or has is None:     # has None = the card photo was still loading: unknown, never missing
        out["photo"] = UNREADABLE
    elif not page_photo:
        out["photo"] = PAGE_SILENT
    else:
        out["photo"] = MATCH if has else (CARD_MISSING if stored.get("has_photo") else WE_MISS)
    # link: the card opens the stored URL, and the stored URL opens this ad on the source
    out["link"] = {"ok": MATCH, "dead": MISMATCH, "moved": REPAIRED if link_repaired else MISMATCH}.get(
        link_kind or "", UNREADABLE)
    if card is not None and card.get("opened_ok") is False:
        out["link"] = MISMATCH
    return out


def empty_row(night: str, platform: str, **kw) -> dict:
    row = {"night": night, "platform": platform, "sampled": 0, "card_read": 0, "source_read": 0,
           "fields": {}, "samples": [], "repaired": 0, "note": None}
    row.update(kw)
    return row


def fold(row: dict, key: str, verdicts: dict[str, str], evidence: dict) -> None:
    row["sampled"] += 1
    for f, v in verdicts.items():
        row["fields"].setdefault(f, {k: 0 for k in VERDICTS})[v] += 1
        if v in (MISMATCH, CARD_MISSING, WE_MISS) and len(row["samples"]) < 20:
            row["samples"].append({"listing": key, "field": f, "verdict": v, **evidence.get(f, {})})


# ── I/O ─────────────────────────────────────────────────────────────────────────────────────────

def database_quiet(client, tries: int = 10, wait_s: int = 60) -> str | None:
    """None when quiet; else why it stayed busy (same rule as the capacity robot)."""
    why = "unread"
    for i in range(tries):
        try:
            a = client.rpc("ops_capacity_db_activity", {}).execute().data or {}
            a = a[0] if isinstance(a, list) else a
            active, slow = int(a.get("active") or 0), int(a.get("slow") or 0)
            why = (f"{active} foreign active queries" if active > FOREIGN_ACTIVE_MAX else
                   f"{slow} foreign queries > 5 s" if slow else None)
        except Exception as e:  # noqa: BLE001 — an unreadable load is not a quiet one
            why = f"load unreadable: {type(e).__name__}"
        if not why:
            return None
        time.sleep(wait_s if i < tries - 1 else 0)
    return why


def tappable_types() -> set[str]:
    src = (ROOT / "e2e/engineers/journey-lib.mjs").read_text(encoding="utf-8")
    block = src[src.index("export const TYPE_UI"):]
    return set(re.findall(r"^\s*'([^']+)': \{ cat:", block[:block.index("\n};")], re.M))


def pick(client, platform: str, rng: random.Random, types: set[str], n: int = PER_SITE) -> list[dict]:
    """n random served ads the Filter can reach (city + district + a tappable type)."""
    base = (lambda q: q.eq("platform", platform).eq("production_ready", True)
            .not_.is_("city_ar", "null").not_.is_("district_ar", "null").in_("type_ar", sorted(types)))
    total = base(client.table("search_listings_ar").select("listing_id", count="exact")).limit(1).execute().count or 0
    if not total:
        return []
    out: dict[tuple, dict] = {}
    for _ in range(n):            # one independent window per ad, so two picks are not neighbours
        off = rng.randrange(0, max(1, total - 30))
        rows = base(client.table("search_listings_ar").select("source_table,listing_id")).order("listing_id") \
            .range(off, off + 29).execute().data or []
        for r in rng.sample(rows, len(rows)):
            if (r["source_table"], r["listing_id"]) not in out:
                out[(r["source_table"], r["listing_id"])] = {"platform": platform, "source_table": r["source_table"],
                                                             "listing_id": r["listing_id"]}
                break
    return list(out.values())


def pick_propertyfinder(client, rng: random.Random, n: int = PER_SITE) -> list[dict]:
    """PF ad pages are robots-forbidden: pick ads FROM the allowed category pages, keep each page record."""
    from scrapers.propertyfinder import crawl
    props = []
    for _key, _deal, _cat, path in crawl.SIDES[:2]:
        try:
            sr = crawl.search_result(crawl.fetch(crawl.BASE + path), path)
        except Exception as e:  # noqa: BLE001 — a wall: stop, never work around it
            print(f"  propertyfinder category page refused: {e}", flush=True)
            break
        props += [it["property"] for it in sr.get("listings") or [] if isinstance(it, dict) and it.get("property")]
    out = []
    tables = sorted({r["source_table"] for r in client.table("search_listings_ar").select("source_table")
                     .eq("platform", "propertyfinder").limit(50).execute().data or []})
    for p in rng.sample(props, len(props)):
        url = crawl.BASE + (p.get("details_path") or "")
        for t in tables:
            hit = client.table(t).select("id").eq("listing_url", url).eq("active", True).limit(1).execute().data
            if hit:
                out.append({"platform": "propertyfinder", "source_table": t, "listing_id": hit[0]["id"], "pf": p})
                break
        if len(out) >= n:
            break
    return out


def pf_page(p: dict) -> tuple[dict, bool]:
    """The category page's own record of one PF ad, as page evidence lines (its JSON, our words only as labels)."""
    tree = {t.get("type"): t.get("name") for t in (p.get("location_tree") or []) if isinstance(t, dict)}
    pr, size = p.get("price") or {}, p.get("size") or {}
    period = {"yearly": "سنوي", "monthly": "شهري", "weekly": "اسبوعي", "daily": "يومي"}.get(pr.get("period") or "", "")
    lines = [x for x in (
        f"السعر {pr.get('value')} ريال {period}" if pr.get("value") and not pr.get("is_hidden") else "",
        f"المساحة {size.get('value')} م²" if size.get("unit") == "sqm" and size.get("value") else "",
        f"{p.get('bedrooms_value')} غرف نوم" if p.get("bedrooms_value") else "",
        f"{p.get('bathrooms_value')} دورات مياه" if p.get("bathrooms_value") else "",
        f"حي {tree.get('DISTRICT')}" if tree.get("DISTRICT") else "",
        " ".join(x for x in (tree.get("CITY"), tree.get("REGION")) if x),
        f"رقم رخصة الإعلان {p.get('rera')}" if p.get("rera") else "",
    ) if x]
    page = {"title": p.get("title"), "meta": {}, "jsonld": [], "evidence_lines": lines, "text_head": " | ".join(lines),
            "_text": "\n".join(lines)}
    return page, bool(p.get("images"))


def run_journeys(picks: list[dict], log=print) -> dict[str, dict]:
    """card key → {text, photo, opened_ok, status}. Keys missing = the journey never reached the card."""
    out: dict[str, dict] = {}
    for i in range(0, len(picks), BATCH):
        batch = [{k: p[k] for k in ("platform", "source_table", "listing_id")} for p in picks[i:i + BATCH]]
        try:
            proc = subprocess.run(["node", str(JOURNEY), "--mode", "normal", "--card-full", "--json",
                                   "--listings", json.dumps(batch, ensure_ascii=False)],
                                  capture_output=True, text=True, timeout=BATCH * 240, cwd=ROOT)
            lines = proc.stdout.splitlines()
        except subprocess.TimeoutExpired as e:
            lines = (e.stdout or b"").decode("utf-8", "replace").splitlines() if isinstance(e.stdout, bytes) else []
        for line in lines:
            if not line.startswith("{"):
                continue
            try:
                r = json.loads(line)
            except ValueError:
                log(f"  journey line cut short: {line[:120]}")
                continue
            ev = r.get("evidence") or {}
            if ev.get("cardFull") is None:
                log(f"  card unread {r.get('listing')}: {r.get('status')} {str(r.get('failedStep'))[:160]}")
                continue
            fs = str(r.get("failedStep") or "")
            out[r["listing"]] = {"text": ev["cardFull"], "photo": ev.get("cardPhoto"),
                                 "opened_ok": True if r.get("status") == "PASS" else (False if "≠ stored" in fs else None)}
    return out


class SourceReader:
    """Rendered source pages: honest UA, robots.txt obeyed, <= 1 page/s per site, stop a site at its first wall."""

    def __init__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        self._ctx = self._browser.new_context(user_agent=UA, locale="ar-SA")
        self._ctx.route("**/*", lambda r: r.abort() if r.request.resource_type in ("image", "media", "font")
                        else r.continue_())
        self._robots: dict[str, robotparser.RobotFileParser | None] = {}
        self._last: dict[str, float] = {}
        self.walled: set[str] = set()

    def allowed(self, url: str) -> bool:
        u = urlsplit(url)
        host = u.netloc
        if host not in self._robots:
            rp = robotparser.RobotFileParser()
            try:   # through the browser's own client: same honest UA, the browser's TLS trust store
                resp = self._ctx.request.get(f"{u.scheme}://{host}/robots.txt", timeout=15000)
                if resp.status in (401, 403) or resp.status >= 500:
                    rp.disallow_all = True    # RFC 9309: unreachable robots.txt (5xx) = complete disallow
                elif resp.status >= 400:
                    rp.allow_all = True       # no robots.txt (4xx) = no rule
                else:
                    rp.parse(resp.text().splitlines())
            except Exception:  # noqa: BLE001 — robots unreadable: we do not guess, we do not read
                rp = None
            self._robots[host] = rp
        rp = self._robots[host]
        return bool(rp and rp.can_fetch("Ezhalah-bot", url))

    def read(self, url: str) -> tuple[str, int | None, str | None, str]:
        """(why, status, landed, html). why = 'ok' | 'robots' | 'wall' | 'error'."""
        host = urlsplit(url).netloc
        if host in self.walled:
            return "wall", None, None, ""
        if not self.allowed(url):
            return "robots", None, None, ""
        time.sleep(max(0.0, self._last.get(host, 0) + PACE_S - time.monotonic()))
        page = self._ctx.new_page()
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=40000)
            page.wait_for_timeout(2500)
            body, landed, status = page.content(), page.url, (resp.status if resp else None)
        except Exception as e:  # noqa: BLE001
            return f"error: {type(e).__name__}", None, None, ""
        finally:
            self._last[host] = time.monotonic()
            page.close()
        # A 200 is a wall only when it is a challenge page, not an ad with a reCAPTCHA contact form (tuba 11-06):
        # its title says so, or a short page carries the challenge words.
        title = (re.search(r"(?is)<title[^>]*>(.*?)</title>", body) or [None, ""])[1].lower()
        hit = next((w for w in WALL if w in title or (len(body) < 30000 and w in body.lower())), None)
        if status in (401, 403, 429, 503) or hit:
            self.walled.add(host)
            print(f"  wall at {host}: HTTP {status} {hit or ''} — this site is left alone for the run", flush=True)
            return "wall", status, landed, ""
        return "ok", status, landed, body

    def close(self):
        self._browser.close()
        self._pw.stop()


def panel_licence(panel) -> str | None:
    """The licence the card's «رقم رخصة الإعلان» row prints, in either panel shape the card reads
    (src/data/remote.ts buildAdditionalInfo): the object's rega_ad_license_number key, or the label/value ROWS
    shape (aqargate, alhoshan, … and the {rows: [...]} wrapper) whose row is labelled «Ad license number».
    Reading only the object shape made every rows-shape site a permanent «we miss it» (🔧 2026-11-07: aqargate
    229 of 229 cards carry the row, parity still said we_miss)."""
    if isinstance(panel, dict) and isinstance(panel.get("rows"), list):
        panel = panel["rows"]
    if isinstance(panel, dict):
        v = panel.get("rega_ad_license_number")
        return (_html.unescape(str(v)).translate(_DIG).strip() or None) if v not in (None, "") else None
    if isinstance(panel, list):
        for r in panel:
            # The card drops a row with no label (buildAdditionalInfo), so parity must not compare one either.
            if not isinstance(r, dict) or not str(r.get("label") or "").strip():
                continue
            if r.get("key") == "rega_ad_license_number" or r.get("label") == "Ad license number":
                v = _html.unescape(str(r.get("value") or "")).translate(_DIG).strip()   # the card decodes too
                if v:
                    return v
    return None


def stored_of(client, table: str, rid: int) -> tuple[dict, str | None]:
    stored = (client.table("search_listings_ar").select(STORED + ",license_number").eq("source_table", table)
              .eq("listing_id", rid).limit(1).execute().data or [{}])[0]
    raw = (client.table(table).select("listing_url,neighborhood,photo_urls,additional_info,price_annual,rent_period")
           .eq("id", rid).limit(1).execute().data or [{}])[0]
    info = raw.get("additional_info") if isinstance(raw.get("additional_info"), dict) else {}
    stored = {**stored, "card_district_raw": raw.get("neighborhood"),
              "card_licence": panel_licence(raw.get("additional_info")),
              "has_photo": bool([u for u in (raw.get("photo_urls") or []) if isinstance(u, str) and u]),
              "source_rent_period": raw.get("rent_period"), "source_price_annual": raw.get("price_annual")}
    return stored, raw.get("listing_url")


def check(client, picks: list[dict], cards: dict[str, dict], reader: SourceReader, *, night: str,
          write: bool) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    for p in picks:
        plat, table, rid = p["platform"], p["source_table"], int(p["listing_id"])
        key = f"{table}:{rid}"
        row = rows.setdefault(plat, empty_row(night, plat))
        try:
            stored, url = stored_of(client, table, rid)
            card = cards.get(key)
            row["card_read"] += card is not None
            page, photo, link_kind, repaired, note = None, None, None, False, None
            if p.get("pf"):
                page, photo = pf_page(p["pf"])
                link_kind = "ok"                      # picked FROM the source's own list at this very URL
            elif url and is_home(url):
                note = "the stored link is the site's home page: it names no ad (nothing compared)"
            elif url:
                why, status, landed, body = reader.read(url)
                if why == "ok":
                    link_kind = classify(url, status, landed)
                    if link_kind == "moved" and repairable(url, landed):
                        repaired = True
                        if write:
                            client.table(table).update({"listing_url": landed}).eq("id", rid).execute()
                    if status == 200 and body and not closed_ad_page(plat, status, body):
                        scoped = scope_to_its_ad(url, body)
                        ev = page_evidence(scoped)
                        if not (is_other_ads_page(stored, ev) or page_lacks_its_ad(url, scoped)):
                            text = re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", scoped))
                            ev = {**ev, "evidence_lines": paired_lines(ev.get("text_head", ""))
                                  + list(ev.get("evidence_lines") or [])}
                            page = {**ev, "_text": re.sub(r"\s+", " ", _html.unescape(text))}
                            photo = bool(page_image_count(ev)) or bool((ev.get("meta") or {}).get("og:image"))
                else:
                    note = why
                    print(f"  source not read {key}: {why}", flush=True)
            if page is not None:
                row["source_read"] += 1
            v = judge(stored, card, page, platform=plat, link_kind=link_kind, link_repaired=repaired, page_photo=photo)
            # REPAIR: the page and our row agree on the licence, only the card key lacks it → copy it (db.py's rule).
            lic = stored_licence(stored)
            if v["licence"] == CARD_MISSING and lic and not stored.get("card_licence") and write:
                info = (client.table(table).select("additional_info").eq("id", rid).limit(1).execute().data or [{}])[0]
                ai = info.get("additional_info")
                if isinstance(ai, dict) or ai is None:
                    client.table(table).update({"additional_info": {**(ai or {}), "rega_ad_license_number": lic}}) \
                        .eq("id", rid).execute()
                    v["licence"] = REPAIRED
            row["repaired"] += sum(1 for x in v.values() if x == REPAIRED)
            evidence = {f: {"stored": stored.get(c)}
                        for f, c in (("price", "price_total"), ("area", "area_m2"), ("bedrooms", "bedrooms"),
                                     ("bathrooms", "bathrooms"), ("city", "city_ar"), ("district", "district_ar"),
                                     ("rent_period", "rent_period_ar"))}
            evidence["licence"] = {"stored": lic, "page": licence_on_page(page.get("_text", "")) if page else None}
            evidence["link"] = {"url": url}
            fold(row, key, v, evidence)
            if note:
                row["note"] = f"source not read: {note}"
            print(f"  {key}: " + " ".join(f"{f}={x}" for f, x in v.items() if x not in (MATCH, PAGE_SILENT)), flush=True)
        except Exception as e:  # noqa: BLE001 — one ad failing never loses the chunk; its row says so
            row["note"] = f"error on {key}: {type(e).__name__}: {e}"[:300]
            print(f"  {key}: error {type(e).__name__}: {e}", flush=True)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Our card vs the source page, field by field, every website a day")
    ap.add_argument("--sites", default="", help="comma/space list (default: this hour's slice)")
    ap.add_argument("--slot", type=int, default=None, help=f"0..{SLOTS - 1} (default: from the UTC hour)")
    ap.add_argument("--all", action="store_true", help="every active website (first full run)")
    ap.add_argument("--per-site", type=int, default=PER_SITE)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true", help="print the rows; repair nothing, write nothing")
    a = ap.parse_args()

    client = sb()
    load_owner_district_aliases(client)
    rng = random.Random(a.seed)
    night = datetime.now(timezone.utc).date().isoformat()
    run = [os.environ.get(k, "") for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID")]
    run_url = f"{run[0]}/{run[1]}/actions/runs/{run[2]}" if all(run) else None
    wanted = [s for s in a.sites.replace(",", " ").split() if s]
    active = wanted if wanted else sorted(client.rpc("loader_active_platforms_ar", {}).execute().data or [])
    slot = a.slot if a.slot is not None else datetime.now(timezone.utc).hour * SLOTS // 24
    sites = wanted or (active if a.all else [p for p in active if slot_of(p) == slot])
    print(f"card parity: {len(sites)} website(s) (slot {slot}/{SLOTS}, {len(active)} active)", flush=True)

    types, totals = tappable_types(), {"ads": 0, "cards": 0, "sources": 0, "sites": 0, "pick_errors": 0}
    reader = SourceReader()
    try:
        # One chunk = one journey batch (<= 12 ads): pick, check the database is quiet, open the cards, read the
        # sources, write the rows. A long run (--all, ~4 h) keeps every finished chunk even if it is cut short.
        per_chunk = max(1, BATCH // max(1, a.per_site))
        for i in range(0, len(sites), per_chunk):
            rows, picks = {}, []
            for p in sites[i:i + per_chunk]:
                try:
                    got = (pick_propertyfinder(client, rng, a.per_site) if p == "propertyfinder"
                           else pick(client, p, rng, types, a.per_site))
                except Exception as e:  # noqa: BLE001 — one website failing never stops the fleet
                    got, rows[p] = [], empty_row(night, p, note=f"pick error: {type(e).__name__}: {e}"[:300])
                    totals["pick_errors"] += 1
                if not got and p not in rows:
                    rows[p] = empty_row(night, p, note="no served ad the Filter can reach (city + district + tappable type)")
                picks += got
            busy = database_quiet(client) if picks else None
            cards = {} if busy or not picks else run_journeys(picks)
            if busy:
                print(f"production busy ({busy}): cards not opened for this chunk; sources still compared", flush=True)
            rows.update(check(client, picks, cards, reader, night=night, write=not a.dry_run))
            out = list(rows.values())
            for r in out:
                r["run_url"] = run_url
                if busy:
                    r["note"] = ((r.get("note") or "") + f" | cards not opened: {busy}").lstrip(" |")
                print(json.dumps({k: r[k] for k in ("platform", "sampled", "card_read", "source_read", "repaired", "note")},
                                 ensure_ascii=False), flush=True)
            if out and not a.dry_run:
                client.table(TABLE).upsert(out, on_conflict="night,platform").execute()
            totals["ads"] += len(picks)
            totals["cards"] += len(cards)
            totals["sources"] += sum(r["source_read"] for r in out)
            totals["sites"] += sum(1 for r in out if r["sampled"])
    finally:
        reader.close()
    print(f"{len(sites)} website(s), {totals['ads']} ad(s), {totals['cards']} card(s) read, "
          f"{totals['sources']} source page(s) read", flush=True)
    if totals["pick_errors"] and not totals["ads"]:
        return 1                  # nothing sampled because picking failed: a red run, never a quiet green
    return 0 if totals["sites"] or not totals["ads"] else 1


if __name__ == "__main__":
    sys.exit(main())
