"""مكتب أقاليم هجر للخدمات العقارية (aqalemhajer.com) — a single-office Al-Ahsa brokerage on Drupal 8.

Everything below was MEASURED live on 2026-09-23 over the WHOLE catalogue (1,229 listings). The
site is the same Drupal/Views product as scrapers/bossbih (sister Al-Ahsa office), so the traps
are the same family; the numbers here are this office's own.

WHAT THE SITE IS. One Views TABLE at `/` — 50 rows/page, `?page=` 0-indexed, pages 0-24 (page 24
carries 29 rows, page 25 is empty). The site prints its own total («عدد العقارات: 1229») and the
crawl matched it exactly: 1,229 distinct ad ids. Detail page = the bare numeric path `/{nid}`.
No structured endpoint (no JSON-LD, no /jsonapi); DOM only, keyed off Views FIELD MACHINE NAMES.

INDEX ROW (4 cells, `td.views-field-<name>`):
    field-als-r   «السعر\n700,000» + a views counter after the eye icon      price LABEL + amount
    nothing-1     «المساحة\n455م\nشارع\n15»                                   area, street
    field-tags    «الدانة» / «الراشدية … العمر 30» / «شرق شرق الحديقة 103 / أ»  district term (+ plot,
                                                                             block letter, age)
    nothing       «تاون هاوس للبيع» link, thumb, «23/09/2026» badge, «اعلان 4865» badge
The «اعلان {id}» badge is the identity (the href flips form on this Drupal product — bossbih §2).

DETAIL PAGE. `<article>` carries the full-size photos (a.lightbox hrefs, already percent-encoded,
verified image/jpeg). The facts live in the `block-views-block-whatsapp-block-1` block as
`div.views-field-field-<name> > .field-content`, one fact per div:
    nw-al-qar   «📜 أرض للبيع في شرق شرق الحديقة / أ»   type + deal + district + block letter
    rgm «رقم الأرض 103» · almsaha «المساحة 455 م» · shar-rd «شارع عرض 15» / «15*20» ·
    alwajht «الواجهة غرب» · alhdwd-walatwal «الحدود والأطوال 14*32.5» · halt-al-qar «حالة العقار
    جاهز/عظم» · al-mr «العمر 18» · rqm-alshqt · _dd-alghrf · aldwr · almmyzat · wsf-al-qar (prose)
    · als-r «💵 المتر 1,000» (label AND amount) · _dd-alwsta «العرض مباشر» · rabt-mwq-al-qar (map)
    · mlahzat · nothing (FAL licence + the office's PHONE NUMBERS) · sahb-al-qar (the OWNER — PII)
The `nothing` and `sahb-al-qar` fields are never read. The page also embeds a related-ads table
with OTHER listings' prices; nothing is ever read outside the whatsapp block / <article>.

THE THINGS THIS SOURCE GETS WRONG IF YOU TRUST THE OBVIOUS THING:
1. THE PRICE FIGURE IS BASIS-FREE; THE LABEL DECIDES THE COLUMN. Measured label vocabulary over all
   1,229 index cells: «السعر» 595, «المتر» 199, «على السوم» 159 (no figure at all), «السوم» 107,
   «السعر قابل للتفاوض» 37, no label 30 (27 empty + 3 bare numbers), «الحد» 27, «السعر شامل» 22,
   «السوم للمتر» 12, «السعر للمتر» 8, «المتر قابل للتفاوض» 7, «شامل الرهن» 7, «الايجار السنوي» 3,
   «شامل القرض» 3, «سعر الايجار» 2, «السعر للقطعه» 2, and one each of «شامل ( قابل للتفاوض)»,
   «سعر القطعة», «سعر البطن», «سعر المنفصل», «السعر الرغبه», «البيع بالوضع الراهن».
   EVERY per-metre label contains «المتر»/«للمتر» and NO total label does (test-pinned), so the
   rule is one line: the definite-article metre in the label → price_per_meter, otherwise the
   figure is the total the office printed. Area is NEVER multiplied here (the ≈ total is derived in the display layer). A bare
   number with no label (3 rows) stays as printed in the deal's own column, basis recorded as
   "unlabelled". «السعر قابل للتفاوض 1,050» on 390 m² (nid 3819) is stored as the 1,050 total the
   label says — owner ruling 2026-08-03, no plausibility gate anywhere in this file.
   Exactly ONE whole-riyal figure is read from a cell: a second figure («السعر شامل 5% الضريبة
   500,000») or a fraction («1.5») fills no price column and the cell is kept VERBATIM in
   additional_info.price_label; dotted thousands («1.200.000») are the shared to_int grouping.
   Both shapes are latent (0 of 1,229 live cells) and pinned so a first-number guess or a floor
   can never come back.
2. RENT PERIOD. 21 rent cards; only «الايجار السنوي» (3) states a period → annual through
   N.rent_period_and_annual. «السعر 45,000» / «سعر الايجار 30,000» state none → rent_period NULL,
   figure unconverted in price_annual. The description is never searched for a period. A
   يومي/أسبوعي/نصف سنوي label is the shared helper's (None, None): the figure survives only in
   additional_info.price_amount_raw, never parked in price_annual (0 live; pinned).
3. NO LISTING PUBLISHES A CITY. Al-Ahsa is a governorate of several real towns, so the row carries
   the governorate «الاحساء» (catalog 3677, region 5) through to_catalog(), never a town — the
   owner's 2026-09-13 ruling for exactly this shape (bossbih §3). Titles that name a place OUTSIDE
   the governorate (measured: «ضاحية الملك فهد بالدمام», «الدمام - حي الزهور», «حفر الباطن حي
   التلال», «البايونيه الخبر», «القصيم ثادج», «الهجرة بمكة المكرمة», «قرية العليا», «محافظة
   المزاحمية») are SKIPPED, never stamped with the default. A bare «الرياض» district (2 rows) is
   ambiguous — this office's «مخطط الرياض» (64 rows) is an Al-Ahsa subdivision whose catalog
   district is «حي الرياض» under الهفوف — so a text that BEGINS with «الرياض» is skipped as
   ambiguous. Deliberately NOT outside tokens: «الظهران» («شارع الظهران» is a Hofuf street),
   «العليا» (a Hofuf district; only «قرية العليا» is the other place), «بقيق» (inside the
   governorate).
4. THE DISTRICT is the site's own tags term (kept verbatim in `neighborhood`); district_ar comes
   from find_district_in_text against each Al-Ahsa town's catalog pool, accepted only when the
   pools agree (bossbih.resolve_district shape). «الضاحية الحي <ordinal>» (ضاحية هجر, ~270 rows)
   has no catalog entry → NULL, as on bossbih. Texts beginning «بالقرب من» / «قريب» / «شارع» name
   a landmark or a street, not the district → NULL.
5. «ثلاث غرف» IS NOT THREE BEDROOMS, and بيت descriptions list rooms PER FLOOR («الدور الارضي فيه
   ثلاث غرف نوم … الدور الثاني شقه فيها غرفتين», nid 4178). Bedrooms are read only from explicit
   «… غرف نوم» phrases, only for a single-dwelling type, and only when every phrase agrees.
6. «تأسيس مصعد» (an elevator SHAFT, nid 5351) is prepared-only → NULL; the shared matcher only knows
   the suffix form «مصعد مؤسس», so that prefix form is guarded here.
7. 194 index thumbs are `logos.png` (the office logo) — never published as a photo.
8. The Views fields aldwr (floor), _dd-alghrf (rooms), rqm-alshqt (flat no.), almmyzat (features)
   and mlahzat (notes) exist in the template but are EMPTY on every one of the 1,229 pages, and
   halt-al-qar carries only جاهز/عظم/مليص/عربي. Floor, bathrooms, furnished-as-a-field, ad
   licence: source-does-not-publish. «رخصة فال 1200020821» is the office's FAL broker licence,
   never license_number (that column is the AD licence).
9. FIVE CARDS PUBLISH NO AREA AT ALL (4659, 4587, 4556, 4535, 3886): the index area cell is just
   «شارع 15» and the detail page has no almsaha field. The area is ONLY the figure after the
   «المساحة» label — the street width never becomes area_m2 (reviewer finding 2026-09-23; golden
   old-vs-new diff over all 1,229 rows: exactly these 5 rows changed, only area_m2).
10. OFF-PLAN markers — «قريباً» in its tanween forms, «على الخارطة», «بدأ البيع» in the ad's own
   title/prose/notes — are skipped as off_plan. A bare «قريبا» is the proximity sense («قريبا جدا
   من حي الجابرية», nid 5243, the single live hit) and «تقريباً» is "approximately", so the matcher
   requires the tanween and a letter boundary. 0 live off-plan ads over all 1,229 descriptions.
11. PDPL: every stored free-text column — title, neighborhood, description, additional_info,
   source_capture — goes through the shared redactor (0 live hits in titles/tags; pinned).
12. CATEGORY: the shared N.category_for_type() answers "Commercial" for "Duplex" and "Studio" (its
   residential set is missing both — cannot be fixed here, scrapers/common/normalize.py). This
   file's own DWELLING_TYPES set is correct and wins over the shared helper (reviewer finding
   2026-09-24; live repro nid 4311 «دبلكس سكنية صك»). 58 دبلكس/دبلكسات/دبلكس وشقة rows would
   otherwise land in aqalemhajer_commercial_listings and never show under Residential.

REMOVAL ORACLE (measured 2026-09-23 with the full 1,229-id index in hand): the office DELETES a
sold node. 1,568 ids inside the live range (2646-5442) are absent from the catalogue; 8 of 8
sampled + /1 + /99999999 answer HTTP 404 with the themed page «عذرا ... تم بيع العقار أو تأجيرة»
(12.6 KB, no node id, no whatsapp block). 6 of 6 live controls answer 200 with
data-history-node-id="<nid>" and the whatsapp block. Re-measured by the fixer the same day over a
30-id stride sample of the 1,568 absent ids: 29 → HTTP 404 (signal gone), 1 → 200 for a
NON-listing node (/3146 «الجابرية», no whatsapp block; signal live, so never pruned — and never in
our tables either); 3/3 live controls (3817, 4659, 5442) → 200 live; canary 3817 → (True, HTTP
200). STATUS decides a death, the node-id marker a life; a themed 404 is still a parseable page.
Pruning is gated on a complete enumeration (cards == the site's printed total) and an in-run
positive control (a known-live card re-read inside the probe's canary) that fails CLOSED.

MEASURED COVERAGE (2026-09-23: the full 1,229-card index and ALL 1,229 detail pages, run through
this file's own parse/map functions offline; the two catalog helpers seeded read-only from
loc_catalog_* through the public anon key, since there is no service key outside production).
1,175 rows map (1,026 residential / 149 commercial; 1,157 Buy / 18 Rent); 54 are skipped and
counted: 31 no deal stated, 9 outside the governorate, 8 unmapped type (4 empty, «سكنية»,
«اراضي سكنية تجارية صك», «محل محل او مستودع», «للبيع»), 4 unmappable (منتجع/برج), 2 ambiguous
«الرياض», 0 off-plan, 0 retired in place. Per field, of 1,175: price_total 767 · price_per_meter
222 · price_annual 11 (rent_period 2 — the only rent labels that state a period) · no figure at
all 175 («على السوم» + empty cells) · area_m2 1,148 · district_ar 549 · photo_urls 1,000 ·
description 990 · street_width_m 729 · direction 548 · property_age 100 · bedrooms 75 · kitchen
271 · parking 58 · maid_room 34 · private_entrance 32 · elevator 26 · air_conditioner 9 ·
furnished 4 · driver_room 2 · views_count 1,000.

    python -m scrapers.aqalemhajer.run --type all --limit 15 --dry-run   # validate, no DB writes
    python -m scrapers.aqalemhajer.run --type all                        # full crawl + prune
"""
from __future__ import annotations

import argparse
import html as html_mod
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize as N  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.pii import redact_capture, redact_pii  # noqa: E402

BASE = "https://aqalemhajer.com"
SOURCE = "مكتب أقاليم هجر للخدمات العقارية"
PREFIX = "AQH"
PLATFORM = "aqalemhajer"
RES_TABLE = "aqalemhajer_residential_listings"
COM_TABLE = "aqalemhajer_commercial_listings"

MAX_PAGES = 60           # safety stop; the catalogue is 25 pages
PAGE_PAUSE = 0.5
DETAIL_PAUSE = 0.3

OFFICE_CITY_AR = "الاحساء"       # governorate grain on purpose (docstring §3)
REGION_HINT = "Eastern Province"
# District-NAME pools: the Al-Ahsa towns whose districts the catalog carries (الهفوف 110, المبرز 53,
# الجفر 49, العمران 32, العيون 31, بقيق 13, جواثا 12, يبرين 7; the governorate «الاحساء» has 0).
AHSA_DISTRICT_POOLS = (12, 2748, 2038, 2764, 2653, 243, 3700, 2643)
# MEASURED tokens only — each matches a real 2026-09-23 district text and nothing else (docstring §3).
OUTSIDE_AREA_TOKENS = ("الدمام", "حفر الباطن", "الخبر", "القصيم", "مكة", "قرية العليا", "المزاحمية")
_AMBIGUOUS_RIYADH_RE = re.compile(r"^\s*الرياض(?![ء-ي])")
_NOT_A_DISTRICT_RE = re.compile(r"^\s*(?:بالقرب|قريب|شارع)(?![ء-ي])")
# «الضاحية الحي الرابع» — a numbered slice of ضاحية هجر, never a district (bossbih's rule).
_SUBDIVISION_RE = re.compile(
    r"ال(?:حي|حى)\s+(?:ال)?(?:أول|اول|ثاني|ثانى|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر|"
    r"حادي|حادى|عشر)\S*(?:\s+عشر)?")
_ADMIN_PREFIX_RE = re.compile(
    r"(?<![ء-ي])[بل]?(?:مدينة|مدينه|محافظة|محافظه|قرية|قريه|مركز|هجرة|هجره)(?![ء-ي])")

# Per-platform EXACT overrides (map_type_exact contract: the office's own spellings, every target
# an existing canonical type). Counts are 2026-09-23 index cards.
TYPE_OVERRIDES = {
    "دبلكس": "Duplex", "دبلكسات": "Duplex", "دبلكس وشقة": "Duplex",           # 54 + 3 + 1
    "نص ارض": "Residential Land", "نص أرض": "Residential Land",               # 37
    "انصاف اراضي": "Residential Land", "اراضي": "Residential Land",           # 6 + 1
    "ارضين متجاورتين": "Residential Land", "أرضين متجاورات": "Residential Land",
    "متجاورات": "Residential Land",                                            # 5 + 2 + 2
    "ارض تجارية": "Commercial Land",                                           # 7
    "تاون هاوس": "Villa",                                                      # 6 (normalize: Townhouse→Villa)
    "شقق دبلكسية": "Apartment", "شقة دبلكسية": "Apartment", "شقة علوية": "Apartment",  # bossbih precedent
    "بيت عربي": "Villa", "بيت شعبي": "Villa",                                  # 2
    # A house sold WITH its flats is one lot; the head noun decides (بيت → Villa, the shared map).
    "بيت و شقتين": "Villa", "بيت وثلاث شقق": "Villa", "بيت اربع شقق": "Villa",
    "بيت دور + شقتين": "Villa", "منزل فيلا و 3 شقق": "Villa", "فيلا + شقه": "Villa",
    "دور سكني": "Floor",
    "عمارة تجارية": "Commercial Building",
    "عمارة ومحلات ووحدات سكنيه": "Building", "عمارة عظم وأرض متجاورات": "Building",
    "معرض تجاري": "Showroom", "معارض تجارية": "Showroom",
    "محلات تجارية ومعارض": "Shop", "محل محلات ومعارض تجارية": "Shop",
    "مستودعات": "Warehouse",
    "استراحات شبابيه": "Rest House",
    "محطة بنزين تجارية": "Gas Station",
}
# No honest home in the taxonomy (shmoualshmal precedent). Skipped, never forced.
TYPE_UNMAPPABLE = ("منتجع", "برج", "مطعم", "كوفي")
# Condition/tenure words the office appends to the type noun («دبلكس سكنية صك», «فيلا عظم»,
# «شقة تمليك»): stripped before a second exact lookup. «تجارية» is NOT here — it changes the type.
_TYPE_QUALIFIERS = {"سكنية", "سكني", "سكنيه", "صك", "الصك", "مرهون", "جاهز", "جاهزة", "عظم", "مليص",
                    "تمليك", "مسلح", "ركني", "فضا", "فضاء"}      # «أرض زراعية فضا» (vacant) → the canon's أرض زراعية

RETIRED_TOKENS = ("مزاد", "تم البيع", "مباع", "تم الإيجار", "تم الايجار", "تم التأجير", "تم التاجير",
                  "محجوز", "ملغي")
# Off-plan / coming-soon markers → skipped with their own reason (rule 3). «قريباً» is matched in
# its tanween forms ONLY: the bare «قريبا» is the proximity sense («قريبا جدا من حي الجابرية»,
# nid 5243 — the single live hit over all 1,229 descriptions, a real listing NEAR a district).
_OFF_PLAN_RE = re.compile(r"(?<![ء-ي])قريب(?:اً|ًا)|على الخارطة|بدأ البيع")   # «تقريباً» (approx.) is not it
_WORD_NUM = {"غرفة": 1, "غرفه": 1, "غرفتين": 2, "غرفتان": 2, "ثلاث": 3, "ثلاثة": 3, "ثلاثه": 3,
             "اربع": 4, "أربع": 4, "اربعة": 4, "أربعة": 4, "خمس": 5, "خمسة": 5, "خمسه": 5,
             "ست": 6, "ستة": 6, "سته": 6, "سبع": 7, "سبعة": 7, "ثمان": 8, "ثماني": 8, "تسع": 9,
             "عشر": 10}
# «3 غرف نوم» · «غرفتين نوم» · «ثلاث غرف نوم» · «غرفة نوم». «نوم» is REQUIRED (docstring §5).
_BED_RE = re.compile(r"(?:([0-9٠-٩]{1,2}|[ء-ي]{2,7})\s+)?(غرفتين|غرفتان|غرفة|غرفه|غرف)\s*(?:ال)?نوم")
DWELLING_TYPES = {"Apartment", "Villa", "Duplex", "Studio", "Floor", "Room", "Rest House", "Chalet"}
PLACEHOLDER_IMG = "logos.png"


def session() -> cc.Session:
    # impersonate OWNS the User-Agent (feedback_impersonate_owns_the_user_agent).
    s = cc.Session(impersonate="chrome")
    s.headers.update({"Accept-Language": "ar,en;q=0.7"})
    return s


def _txt(fragment: Optional[str]) -> str:
    """De-tag one fragment, <br> → line break, entities unescaped, blank lines dropped."""
    if not fragment:
        return ""
    s = re.sub(r"<br\s*/?>", "\n", fragment)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html_mod.unescape(s)
    lines = (re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in s.split("\n"))
    return "\n".join(ln for ln in lines if ln)


def _label_after(text: str, label: str) -> str:
    t = re.sub(r"^[^\w؀-ۿ]+", "", text.strip())   # drop the ▪ / 💵 / 📜 marks
    return t[len(label):].strip() if t.startswith(label) else t


# ── INDEX ───────────────────────────────────────────────────────────────────────────────────────
_CELL_RE = re.compile(r'<td headers="[^"]*" class="views-field views-field-([a-z0-9-]+)[^"]*">'
                      r"<strong>(.*?)</strong>\s*</td>", re.S)
_CARD_ID_RE = re.compile(r"[اإ]علان\s*(\d+)")
_CARD_DATE_RE = re.compile(r'<div class="badge">\s*(\d{2}/\d{2}/\d{4})')
_CARD_IMG_RE = re.compile(r'<img src="([^"]+)"')
_CARD_LINK_RE = re.compile(r"<a [^>]*hreflang=[^>]*>(.*?)</a>", re.S)
_TOTAL_RE = re.compile(r"عدد العقارات\s*:?\s*([0-9٠-٩,]+)")


def parse_index(page_html: str) -> list[dict]:
    """Every row of one index page, exactly as published."""
    out: list[dict] = []
    for block in page_html.split("<tr>")[1:]:
        block = block.split("</tr>")[0]
        cells = {name: raw for name, raw in _CELL_RE.findall(block)}
        m_id = _CARD_ID_RE.search(html_mod.unescape(cells.get("nothing", "")))
        if not m_id:
            continue
        price_raw, _, views_raw = cells.get("field-als-r", "").partition('<i class="fa fa-eye"')
        m_views = re.search(r"\d+", _txt(views_raw))
        m_img = _CARD_IMG_RE.search(cells.get("nothing", ""))
        m_date = _CARD_DATE_RE.search(cells.get("nothing", ""))
        m_link = _CARD_LINK_RE.search(cells.get("nothing", ""))
        out.append({
            "nid": m_id.group(1),
            "type_deal": " ".join(_txt(m_link.group(1)).split()) if m_link else "",
            "price_text": " ".join(_txt(price_raw).split("\n")),
            "area_text": _txt(cells.get("nothing-1", "")),
            "tags_text": _txt(cells.get("field-tags", "")),
            "views": int(m_views.group(0)) if m_views else None,
            "thumb": html_mod.unescape(m_img.group(1)) if m_img else None,
            "bump_date": m_date.group(1) if m_date else None,
        })
    return out


def fetch_index(s: cc.Session, limit: int = 0) -> tuple[list[dict], Optional[int]]:
    """Walk `?page=` until an empty page. Returns (cards, the site's OWN printed total)."""
    cards: list[dict] = []
    seen: set[str] = set()
    printed_total: Optional[int] = None
    for page in range(MAX_PAGES):
        r = s.get(f"{BASE}/?page={page}", timeout=60)
        if r.status_code != 200:
            break
        if printed_total is None and (m := _TOTAL_RE.search(r.text)):
            printed_total = N.to_int(m.group(1))
        rows = parse_index(r.text)
        if not rows:
            break
        for c in rows:
            if c["nid"] not in seen:
                seen.add(c["nid"])
                cards.append(c)
        if limit and len(cards) >= limit:
            return cards[:limit], printed_total
        time.sleep(PAGE_PAUSE)
    return cards, printed_total


# ── DETAIL ──────────────────────────────────────────────────────────────────────────────────────
_WA_BLOCK = 'id="block-views-block-whatsapp-block-1"'
_FIELD_RE = re.compile(r'class="views-field views-field-field-([a-z0-9_-]+)">'
                       r"<(?:div|span|strong)[^>]*>(.*?)</(?:div|span|strong)></div>", re.S)
_PHOTO_RE = re.compile(r'<a [^>]*class="lightbox"[^>]*href="([^"]+)"|<a [^>]*href="([^"]+)"[^>]*class="lightbox"')
_H1_RE = re.compile(r"<h1>\s*<span[^>]*>(.*?)</span>", re.S)
_FAL_RE = re.compile(r"رخصة فال\s*([0-9٠-٩]+)")
# The OWNER's name and the office's phone block — PII, never read (docstring).
_NEVER_READ = ("sahb-al-qar", "nothing")


def parse_detail(page_html: str) -> dict:
    """Everything the detail page publishes, verbatim. No interpretation here."""
    i = page_html.find(_WA_BLOCK)
    j = page_html.find('class="views-element-container', i + 1) if i >= 0 else -1
    blk = page_html[i:j if j > i else None] if i >= 0 else ""
    fields = {name: _txt(frag) for name, frag in _FIELD_RE.findall(blk) if name not in _NEVER_READ}
    fields = {k: v for k, v in fields.items() if v}
    a, b = page_html.find("<article"), page_html.find("</article>")
    art = page_html[a:b] if 0 <= a < b else ""
    photos: list[str] = []
    for m in _PHOTO_RE.finditer(art):
        u = html_mod.unescape(m.group(1) or m.group(2))
        u = u if u.startswith("http") else BASE + u
        if u not in photos:
            photos.append(u)
    m_h1 = _H1_RE.search(page_html)
    m_fal = _FAL_RE.search(blk)
    return {
        "title": " ".join(_txt(m_h1.group(1)).split()) if m_h1 else None,
        "fields": fields,
        "photos": photos,
        "fal_license": m_fal.group(1) if m_fal else None,
    }


def fetch_detail(s: cc.Session, nid: str) -> Optional[dict]:
    r = s.get(f"{BASE}/{nid}", timeout=40)
    # The themed 404 is a fully parseable page, so the STATUS decides, never "did fields parse".
    if r.status_code != 200 or f'data-history-node-id="{nid}"' not in r.text:
        return None
    return parse_detail(r.text)


# ── PARSERS ─────────────────────────────────────────────────────────────────────────────────────
_NUM_RE = re.compile(r"[0-9٠-٩][0-9٠-٩,]*(?:[.٫][0-9٠-٩]+)?")
# A price figure as the office types it: «1,050» · «60,000» · «1.200.000» (dotted thousands) · «1.5».
_PRICE_FIG_RE = re.compile(r"[0-9٠-٩](?:[0-9٠-٩,.٫]*[0-9٠-٩])?")
_FRACTION_RE = re.compile(r"[.٫][0-9٠-٩]{1,2}$")
# «المتر» / «للمتر» — the definite-article metre; every per-metre label carries one (docstring §1).
_PER_METRE_RE = re.compile(r"(?:ال|لل)متر")
# The area is the figure right AFTER the «المساحة» label and nothing else (docstring §9).
_AREA_RE = re.compile(r"المساحة\s*(" + _NUM_RE.pattern + ")")


def parse_price(text: Optional[str]) -> tuple[str, Optional[int], Optional[str]]:
    """«💵 المتر 1,000» → ("المتر", 1000, "per_sqm"); «السعر 700,000» → total; «على السوم» →
    (label, None, None); a bare «60,000» → ("", 60000, "unlabelled"). The label is the cell's own
    words with the figure removed; «المتر»/«للمتر» anywhere in it is the per-metre basis (§1).
    Exactly ONE whole-riyal figure is stored. A cell with two figures («السعر شامل 5% الضريبة
    500,000») or a fractional one («1.5») fills no price column and comes back VERBATIM as the
    label (kept in additional_info.price_label): never a first-number guess, never a floor.
    Dotted thousands («1.200.000» → 1,200,000) are the shared to_int grouping rule."""
    t = re.sub(r"^[^\w؀-ۿ]+", "", (text or "").strip())
    figs = _PRICE_FIG_RE.findall(t)
    if len(figs) != 1 or _FRACTION_RE.search(figs[0]):
        return " ".join(t.split()), None, None
    label = " ".join(_PRICE_FIG_RE.sub(" ", t).split())
    amount = N.to_int(figs[0])
    if amount is None:
        return label, None, None
    if _PER_METRE_RE.search(label):
        return label, amount, "per_sqm"
    return label, amount, ("total" if label else "unlabelled")


def parse_area(text: Optional[str]) -> tuple[Optional[int], Optional[str]]:
    """«المساحة 487.5 م» → (487, "487.5"); fractions keep their exact figure in the raw. A cell
    with no «المساحة» label («شارع 15» — 5 cards publish only the street) → (None, None): the only
    number there is the street width, never an area (docstring §9)."""
    m = _AREA_RE.search(text or "")
    if not m:
        return None, None
    raw = m.group(1)
    n = N.to_int(raw.split(".")[0].split("٫")[0])
    return (n if n and n > 0 else None), raw


_PHRASE_RE = re.compile(r"^(?P<type>.*?)(?:\s+(?P<deal>للبيع|للايجار|للإيجار))?(?:\s+في(?:\s+(?P<tail>.*))?)?$")


def split_type_deal_district(phrase: Optional[str]) -> tuple[str, Optional[str], Optional[str], Optional[str]]:
    """«📜 دبلكس سكنية صك للبيع في شرق شرق الحديقة / أ» →
    ("دبلكس سكنية صك", "Buy", "شرق شرق الحديقة", "أ"). «بيت في محاسن» (no deal word, 36 cards)
    → ("بيت", None, "محاسن", None): the deal is the source's to state, never defaulted."""
    t = " ".join(_label_after(phrase or "", "").split())
    m = _PHRASE_RE.match(t)
    if not m:
        return t, None, None, None
    deal = None if not m.group("deal") else ("Buy" if m.group("deal") == "للبيع" else "Rent")
    tail = (m.group("tail") or "").strip()
    district, letter = tail, None
    if (k := tail.rfind(" / ")) >= 0:
        district, letter = tail[:k].strip(), tail[k + 3:].strip()
    elif tail.startswith("/"):
        district, letter = "", tail[1:].strip()
    return m.group("type").strip(), deal, (district or None), (letter or None)


def map_type(phrase: str) -> Optional[str]:
    p = " ".join(phrase.split())
    if t := N.map_type_exact(p, TYPE_OVERRIDES):
        return t
    core = " ".join(w for w in p.split() if w not in _TYPE_QUALIFIERS)
    return N.map_type_exact(core, TYPE_OVERRIDES) if core and core != p else None


def resolve_district(district_raw: Optional[str]) -> Optional[str]:
    """The catalog's canonical name for the office's district text, accepted only when every
    Al-Ahsa town pool that recognizes anything recognizes the SAME name (docstring §4)."""
    if not district_raw or _NOT_A_DISTRICT_RE.search(district_raw):
        return None
    text = _SUBDIVISION_RE.sub(" ", _ADMIN_PREFIX_RE.sub(" ", district_raw))
    found = {d for d in (find_district_in_text(text, cid) for cid in AHSA_DISTRICT_POOLS) if d}
    return found.pop() if len(found) == 1 else None


def bedrooms_from_prose(text: Optional[str]) -> Optional[int]:
    """A count ONLY when every «… غرف نوم» phrase in the body agrees (docstring §5)."""
    found: set[int] = set()
    for lead, noun in _BED_RE.findall(text or ""):
        n = (N.to_int(lead) if re.fullmatch(r"[0-9٠-٩]+", lead) else _WORD_NUM.get(lead)) if lead \
            else _WORD_NUM.get(noun)
        if n is None:
            return None
        found.add(n)
    return found.pop() if len(found) == 1 and 1 <= max(found) <= 20 else None


def amenities(text: Optional[str]) -> dict[str, bool]:
    """N.amenities_from_text per line (one fact per line here, as on bossbih), merged; a column
    whose lines disagree is dropped. «تأسيس مصعد» is a shaft, not a lift → NULL (docstring §6)."""
    seen: dict[str, set[bool]] = {}
    for line in re.split(r"[\n\r]+", text or ""):
        for col, val in N.amenities_from_text(line).items():
            if col == "elevator" and re.search(r"ت[أا]سيس\s+(?:ال)?مصعد", line):
                continue
            seen.setdefault(col, set()).add(val)
    return {col: next(iter(v)) for col, v in seen.items() if len(v) == 1}


# ── MAPPING ─────────────────────────────────────────────────────────────────────────────────────
def _own_words(title: Optional[str], f: dict[str, str]) -> str:
    """The ad's OWN title, prose, notes and condition — never the related-ads table."""
    return " ".join(x for x in (title, f.get("wsf-al-qar"), f.get("mlahzat"), f.get("halt-al-qar")) if x)


def is_retired(title: Optional[str], f: dict[str, str]) -> bool:
    """An ad the office retired IN PLACE: a marker in its title, prose, notes or condition."""
    return any(tok in _own_words(title, f) for tok in RETIRED_TOKENS)


def is_off_plan(title: Optional[str], f: dict[str, str]) -> bool:
    """«قريباً» / «على الخارطة» / «بدأ البيع» in the ad's own words: nothing priced to show yet."""
    return bool(_OFF_PLAN_RE.search(_own_words(title, f)))


def map_listing(ix: dict, detail: Optional[dict]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). row is None exactly when the source leaves it unpublishable."""
    detail = detail or {}
    f: dict[str, str] = detail.get("fields") or {}
    description = f.get("wsf-al-qar") or None
    type_phrase, deal, district_tail, letter = split_type_deal_district(f.get("nw-al-qar") or ix["type_deal"])
    title = detail.get("title") or " ".join(_label_after(f.get("nw-al-qar") or ix["type_deal"], "").split())

    if is_retired(title, f):
        return None, "residential", "retired_or_auction"
    if is_off_plan(title, f):
        return None, "residential", "off_plan"
    if any(tok in type_phrase for tok in TYPE_UNMAPPABLE):
        return None, "residential", "type_unmappable_at_source"
    property_type = map_type(type_phrase)
    if not property_type:
        return None, "residential", "type_unmapped"
    # N.category_for_type answers "Commercial" for "Duplex"/"Studio" (its residential set predates
    # them, shared fleet-wide, cannot be edited here) — matches every other platform on this helper.
    # The app's Residential filter already recovers these via kinds:BOTH + the broad-Residential
    # misfile-recovery path (owner decision 2026-09-24, docs/ARCHITECTURE.md §21).
    category = N.category_for_type(property_type).lower()
    if not deal:
        return None, category, "no_deal_stated"
    transaction_type = "Rent" if deal == "Rent" else "Buy"

    # The site's own tags term is the district; the title tail is the fallback (docstring §4).
    district_raw = (ix.get("tags_text") or "").split("\n")[0].strip() or district_tail
    if district_raw and any(tok in district_raw for tok in OUTSIDE_AREA_TOKENS):
        return None, category, "outside_office_area"
    if district_raw and _AMBIGUOUS_RIYADH_RE.search(district_raw):
        return None, category, "location_ambiguous"
    city_id, region_id = to_catalog(OFFICE_CITY_AR, region_hint=REGION_HINT)
    if not city_id:
        return None, category, "city_not_in_catalog"

    label, amount, basis = parse_price(f.get("als-r") or ix.get("price_text"))
    price_total = price_annual = price_per_meter = rent_period = None
    if basis == "per_sqm":
        price_per_meter = amount
    elif basis and transaction_type == "Rent":
        # PERIOD = SOURCE: only the price label may state it. Silence → (None, figure unconverted);
        # «الايجار السنوي» → annual; شهري → ×12; يومي/أسبوعي/نصف سنوي → (None, None), the figure
        # kept only in additional_info.price_amount_raw — the helper's verdict is never overridden.
        rent_period, price_annual = N.rent_period_and_annual(amount, label)
    elif basis:
        price_total = amount

    area_m2, area_raw = parse_area(f.get("almsaha") or ix.get("area_text"))
    street_raw = _label_after(f.get("shar-rd") or "", "شارع عرض") or None
    direction_raw = _label_after(f.get("alwajht") or "", "الواجهة") or None
    age_raw = _label_after(f.get("al-mr") or "", "العمر") or None
    photos = list(detail.get("photos") or [])
    if not photos and ix.get("thumb") and PLACEHOLDER_IMG not in ix["thumb"]:
        u = ix["thumb"] if ix["thumb"].startswith("http") else BASE + ix["thumb"]
        photos = [quote(u, safe="/:%?=&")]
    bedrooms = bedrooms_from_prose(description) if property_type in DWELLING_TYPES else None

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{ix['nid']}",
        "listing_url": f"{BASE}/{ix['nid']}",
        "source": SOURCE,
        "active": True,
        "title": redact_pii(title or None),
        "description": redact_pii(description),
        **amenities("\n".join(x for x in (description, f.get("almmyzat")) if x)),
        "property_type": property_type,
        "transaction_type": transaction_type,
        "city": N.map_city(OFFICE_CITY_AR),
        "city_ar": OFFICE_CITY_AR,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": resolve_district(district_raw),
        "neighborhood": redact_pii(district_raw or None),
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "bathrooms": None,                       # stated per floor/section on this source
        "property_age": N.exact_age(age_raw) if age_raw else None,
        "street_width_m": N.one_street_width(street_raw) if street_raw else None,
        "direction": N.one_direction(direction_raw) if direction_raw else None,
        "price_total": price_total,
        "price_annual": price_annual,
        "price_per_meter": price_per_meter,
        "rent_period": rent_period,
        "views_count": ix.get("views"),
        "photo_urls": photos[:20] if (detail or photos) else None,
        "additional_info": redact_capture({k: v for k, v in {
            "price_label": label or None,
            "price_basis": basis,
            "price_amount_raw": amount,
            "type_ar": type_phrase or None,
            "area_raw": area_raw if area_raw and not area_raw.replace(",", "").isdigit() else None,
            "plot_no": _label_after(f.get("rgm") or "", "رقم الأرض") or None,
            "block_letter": letter,
            "plot_dimensions": _label_after(f.get("alhdwd-walatwal") or "", "الحدود والأطوال") or None,
            "street_raw": street_raw,
            "direction_raw": direction_raw,
            "condition": _label_after(f.get("halt-al-qar") or "", "حالة العقار") or None,
            "property_age_raw": age_raw,
            "rooms_raw": f.get("_dd-alghrf"),
            "floor_raw": f.get("aldwr"),
            "flat_no": f.get("rqm-alshqt"),
            "features_raw": f.get("almmyzat"),
            "notes": f.get("mlahzat"),
            "offer_basis": _label_after(f.get("_dd-alwsta") or "", "") or None,
            "map_url": _label_after(f.get("rabt-mwq-al-qar") or f.get("mwq-al-qar") or "", "موقع العقار") or None,
            "fal_license": detail.get("fal_license"),
            "bump_date": ix.get("bump_date"),        # a refresh date, not created_at
            "city_basis": "office_published_city_governorate_grain",
            "district_source": "site_tags_term" if district_raw else None,
        }.items() if v is not None}),
        "source_capture": redact_capture({
            "schema": "aqalemhajer.v1",
            "nid": ix["nid"],
            "index_card": {k: ix.get(k) for k in ("type_deal", "price_text", "area_text", "tags_text",
                                                  "views", "thumb", "bump_date")},
            "detail_fields": f,
            "detail_photos": detail.get("photos") or [],
        }),
    }
    return row, category, ""


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
def _signal_for(nid: str):
    def _signal(status, body, _moved):
        if status == 404:
            return "gone"
        if status == 200 and f'data-history-node-id="{nid}"' in body:
            d = parse_detail(body)
            return "gone" if is_retired(d.get("title"), d.get("fields") or {}) else "live"
        return None
    return _signal


def _canary_for(live_nid: str):
    """In-run positive control: a card THIS crawl just enumerated must still read as live, or no
    removal is allowed (fails CLOSED)."""
    def _canary() -> tuple[bool, str]:
        try:
            r = session().get(f"{BASE}/{live_nid}", timeout=40)
        except Exception as e:  # noqa: BLE001
            return False, f"canary {live_nid} unreachable: {e}"
        ok = r.status_code == 200 and f'data-history-node-id="{live_nid}"' in r.text
        return ok, f"canary {live_nid} HTTP {r.status_code}"
    return _canary


def verify_gone_for(live_nid: str):
    def _verify_gone(ad_number: str) -> tuple[str, str]:
        nid = ad_number[len(PREFIX):]
        if not nid.isdigit():
            return "unknown", f"{ad_number!r} is not a {PREFIX}<nid> ad number"
        return LivenessProbe(platform=PLATFORM, signal=_signal_for(nid), session=session,
                             url_for=lambda _ad: f"{BASE}/{nid}",
                             canary=_canary_for(live_nid)).verify_gone(ad_number)
    return _verify_gone


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(PLATFORM)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        cards, printed_total = fetch_index(s, limit=args.limit)
        if not cards:
            raise RuntimeError("index returned no cards (0 of an expected ~1,229)")
        complete = bool(printed_total) and not args.limit and len(cards) == printed_total
        note = f"{len(cards)} cards, site printed total {printed_total}"
        print(f"{SOURCE}: {note}", flush=True)
        if printed_total and not args.limit and not complete:
            print(f"  ! crawl/total mismatch: enumerated {len(cards)} vs printed {printed_total}")
        for c in cards:
            detail = fetch_detail(s, c["nid"])
            time.sleep(DETAIL_PAUSE)
            if detail is None:
                skipped["detail_fetch_failed"] = skipped.get("detail_fetch_failed", 0) + 1
                continue
            row, cat, why = map_listing(c, detail)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        tally = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if tally:
            print(f"  skipped (not guessed): {tally}")
        if dry:
            rows = res + com
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            cols = ("price_total", "price_per_meter", "price_annual", "rent_period", "area_m2",
                    "district_ar", "photo_urls", "bedrooms", "property_age", "street_width_m",
                    "direction", "description", "elevator", "parking", "kitchen", "furnished",
                    "maid_room", "driver_room", "private_entrance", "air_conditioner", "views_count")
            print("  coverage: " + ", ".join(
                f"{c}={sum(1 for r0 in rows if r0.get(c) not in (None, []))}" for c in cols))
            for r0 in rows[:12]:
                print(f"   {r0['ad_number']:>8} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):16} d={str(r0['district_ar'])[:14]:14} "
                      f"a={str(r0['area_m2']):>6} bd={str(r0['bedrooms']):>4} pt={r0['price_total']} "
                      f"ppm={r0['price_per_meter']} pa={r0['price_annual']} rp={r0['rent_period']} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        # Public upsert_aqalemhajer_* wrappers are added centrally in db.py later; the batch
        # helper is the same call they wrap.
        db._wasalt_batch("aqalemhajer_residential_listings", res)
        db._wasalt_batch("aqalemhajer_commercial_listings", com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        degraded = False
        # Prune ONLY after a COMPLETE enumeration (cards == the site's own printed total) of the
        # whole catalogue, with a positive control from this very run; anything less fails CLOSED.
        if args.type == "all" and complete and (res or com):
            live_nid = (res or com)[0]["ad_number"][len(PREFIX):]
            for table, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                pruned = db.prune_unseen(table, {r["ad_number"] for r in rows}, SOURCE,
                                         verify_gone=verify_gone_for(live_nid))
                degraded = degraded or pruned < 0
                print(f"  {table}: pruned {pruned}")
        elif args.type == "all":
            degraded = True
            print("  prune withheld: enumeration incomplete or empty", flush=True)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(cards),
                             rows_upserted=len(res) + len(com), degraded=degraded,
                             notes=f"{note}; skipped: {tally or 'none'}"[:300],
                             check_tables=["aqalemhajer_residential_listings",
                                           "aqalemhajer_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"{e}; skipped: "
                             f"{', '.join(f'{k}x{v}' for k, v in skipped.items()) or 'none'}"[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
