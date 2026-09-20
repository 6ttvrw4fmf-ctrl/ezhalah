"""Shared scraper for the inblaj.net WordPress platform — one parser, N tenant offices.

Three of the owner's backlog sites (غدي، سفيرة العقارات، الحميدان) are TENANTS of the same
inblaj.net WordPress product: identical theme, identical labelled «تفاصيل العقار» block, a
`property` custom post type, and a per-tenant sitemap. One parser covers them all; each tenant
keeps its own scrapers/<slug>/run.py entrypoint, its own tables, its own registry row and its own
run ledger, exactly like every standalone platform (عضل is a fourth tenant the owner declined
2026-09-19; أبو أيوب is a fifth whose site is a brochure with no listings).

SOURCE SHAPE (probed live 2026-09-19 on gudai, before any code):
  · Sitemap enumerates the catalogue under /property/. Two sitemap flavours exist across tenants —
    Yoast (`property-sitemap.xml`) and WP core (`wp-sitemap-posts-property-1.xml`) — so both are
    tried, tenant by tenant.
  · TWO THEME VARIANTS exist across tenants (both seen live 2026-09-19):
      A (gudai, alhumaidan): labelled «تفاصيل العقار» block —
            نوع العرض: للبيع   نوع الأرض/نوع العقار: تجاري   المساحة: 1200 م2
            المدينة: جدة       الحي: طريق الملك عبدالله
         title in the first <h2>; NO similar-ads block observed.
      B (safera): «نظرة عامة» block — نوع العقار / المساحة / «العنوان – التوفيق بريدة»; the city
         is NOT labelled and lives in «المنطقة: القصيم – بريدة» inside the description; and the
         page DOES end with a «عروض مشابهه» block carrying other listings' figures.
    Because variant B has a similar-ads tail, EVERY value on BOTH variants is read from a section
    truncated at «عروض مشابه»/«اعلانات مشابهة» BY CONSTRUCTION — the sadiqeltajer design. On the
    variant that lacks the block the truncation is a no-op, which costs nothing.
  · A title of «… تم الإيجار» or «… تم البيع» is a TRANSACTED ad still displayed by the office
    (alhumaidan's live sample). It is skipped, never ingested as an active listing.
  · «الحي:»/«العنوان» often hold a STREET, not a district. Offered to the catalog matcher and
    honestly null when unmatched.
  · Variant B prints «ترخيص : N» — captured as license_number.

DEATH SIGNAL (measured per tenant at registration time, not assumed): WordPress hard-404s a
deleted /property/ post. A 200 without the «تفاصيل العقار» block is a shell → UNKNOWN.
"""
from __future__ import annotations

import argparse
import html as ihtml
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome124")
    s.headers.update({"Accept": "text/html,application/xhtml+xml",
                      "Accept-Language": "ar,en-US;q=0.7,en;q=0.6"})
    return s


_SIMILAR_RE = re.compile(r"عروض\s*مشابه|اعلانات\s*مشابهة|إعلانات\s*مشابهة")


def visible_text(page_html: str) -> str:
    """The listing's OWN visible text, truncated at the similar-ads heading BY CONSTRUCTION so a
    neighbour's price/area can never be read (variant B carries such a block; on variant A the
    truncation is a no-op)."""
    b = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", page_html, flags=re.S | re.I)
    t = re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", b))).strip()
    m = _SIMILAR_RE.search(t)
    return t[:m.start()] if m else t


# ── the labelled «تفاصيل العقار» fields ──────────────────────────────────────────────────────────
# Variant A writes «نوع العرض: للبيع» (colon, next field also colon-terminated).
# Variant B writes «نوع العقار استراحة المساحة 2144 م2» — NO colons at all, one field running
# straight into the next. So a value ends at the next KNOWN field name, and the set of field
# names is closed and listed here rather than inferred from punctuation that variant B lacks.
_FIELD_NAMES = ("نوع العرض", "نوع العقار", "نوع الأرض", "نوع الايجار", "نوع الإيجار",
                "المساحة", "المدينة", "الحي", "العنوان", "المرافق", "الوصف", "نظرة عامة",
                "المميزات", "السعر", "غرف النوم", "دورات المياه", "الحمامات", "ترخيص",
                "المنطقة", "Playlist",
                # Added 2026-09-20 with the Advanced-Filter capture fix. These are real rows in the
                # variant-A «تفاصيل العقار» table; leaving them out of the stop-set let a preceding
                # label swallow the next row's value (e.g. «المساحة» ran on into «عدد الغرف 7»).
                "عدد الغرف", "مؤثثة", "عام الاكتمال", "العمر")


def _label(text: str, *names: str) -> Optional[str]:
    stop = "|".join(re.escape(f) for f in _FIELD_NAMES)
    for n in names:
        m = re.search(re.escape(n) + r"\s*:?\s*(.{1,60}?)(?=\s*(?:" + stop + r")\b|\s*$)", text)
        if m:
            v = re.sub(r"\s+", " ", m.group(1)).strip(" .،-:")
            if v and v not in _FIELD_NAMES:
                return v
    return None


# H1 leads with the type noun; CLOSED map — anything outside it is skipped, never bucketed.
# CLOSED map to the canonical vocabulary normalize.map_type_exact() accepts. Every key was seen in
# a real title or «نوع العقار» value on one of the three tenants; anything outside it yields None
# and the listing is SKIPPED rather than bucketed into a nearest guess.
_TYPE_AR = {
    "أرض تجارية": "أرض تجارية", "ارض تجارية": "أرض تجارية",
    "قطعة تجارية": "أرض تجارية",
    "أرض زراعية": "أرض زراعية", "ارض زراعية": "أرض زراعية",
    "أرض سكنية": "أرض", "ارض سكنية": "أرض", "قطعة سكنية": "أرض", "قطعه سكنية": "أرض",
    "أرض": "أرض", "ارض": "أرض", "قطعة": "أرض",
    "فيلا": "فيلا", "فلة": "فيلا", "فله": "فيلا", "فلل": "فيلا", "قصر": "قصر", "بيت": "بيت",
    "دبلكس": "دوبلكس", "دوبلكس": "دوبلكس",
    "شقة": "شقة", "شقه": "شقة", "شقق": "شقة",
    "استوديو": "استوديو", "ستوديو": "استوديو",
    "دور علوي": "دور", "دور أرضي": "دور", "دور ارضي": "دور", "دور": "دور",
    "عمارة": "عمارة", "عماره": "عمارة", "مبنى كامل": "عمارة", "مبنى تجاري": "عمارة",
    "مبنى": "عمارة", "برج": "عمارة",
    "استراحة": "استراحة", "استراحه": "استراحة", "استراحات": "استراحة",
    "شاليه": "شاليه", "شاليهات": "شاليه",
    "مزرعة": "مزرعة", "مزرعه": "مزرعة",
    "محل": "محل", "محلات": "محل", "معرض": "معرض", "صالة عرض": "معرض",
    "صالة تجارية": "محل", "صاله تجارية": "محل",
    "مكتب": "مكتب", "مكاتب": "مكتب",
    "مستودع": "مستودع", "مستودعات": "مستودع", "مخزن": "مستودع", "مخازن": "مستودع",
    "غرفة": "غرفة", "غرفه": "غرفة", "فندق": "فندق", "ورشة": "ورشة",
}
# longest-first so «أرض تجارية» wins over «أرض» and «دور علوي» over «دور»
_TYPE_TOKENS = sorted(_TYPE_AR, key=len, reverse=True)
_LAND_QUALIFIER = (("تجاري", "أرض تجارية"), ("زراعي", "أرض زراعية"), ("سكني", "أرض"))


def _qualify_land(base: str, text: str) -> str:
    """«أرض» alone → the source's own «نوع الأرض» qualifier when it states one."""
    if base != "أرض":
        return base
    q = _label(text, "نوع الأرض") or ""
    for needle, mapped in _LAND_QUALIFIER:
        if needle in q:
            return mapped
    return base


def parse_type_ar(title: str, text: str) -> Optional[str]:
    """The SOURCE's own type word, TITLE FIRST, dropdown second.

    Both are the source's own statements and they DISAGREE on real listings. Measured on safera:
    «للبيع شاليه شمال بريدة في حي الصقري» and «للبيع 3 شاليهات شمال بريدة» both carry
    «نوع العقار: فيلا», and «للإيجار صالة تجارية – سلطانة» carries «نوع العقار: مبنى كامل تجاري».
    In each case the office typed the specific property into the title and left the dropdown on a
    coarser value. The title is what that office wrote about THIS property, so it wins; the
    dropdown is kept in additional_info.type_ar_label so the disagreement is auditable rather than
    silently resolved. Nothing is invented either way — both are the source's own words.

    The title cannot be read with startswith(): variant B leads with the DEAL word
    («للبيع أرض في حي النقيب…»), so the type noun sits mid-string. Tokens are matched longest-first
    anywhere in the title, which is why the map is CLOSED — a substring scan over an open
    vocabulary is how a «مخطط» becomes a «مخط».
    """
    t = (title or "").strip()
    for tok in _TYPE_TOKENS:
        # Boundary = "not an Arabic letter or digit" on each side, NOT whitespace: titles run
        # emoji and punctuation flush against the word («للايجار السنوي ✨دور علوي بحي الريان»),
        # and a whitespace-only boundary silently fell through to the coarser dropdown value.
        if re.search(r"(?<![\u0621-\u064A0-9])" + re.escape(tok) + r"(?![\u0621-\u064A])", t):
            return _qualify_land(_TYPE_AR[tok], text)
    lab = _label(text, "نوع العقار")
    if lab:
        for tok in _TYPE_TOKENS:
            if lab.startswith(tok) or lab == tok:
                return _qualify_land(_TYPE_AR[tok], text)
    return None


def type_from_label(text: str) -> Optional[str]:
    """The dropdown's value alone — recorded alongside the title-derived type so a disagreement
    stays visible in additional_info instead of being silently resolved."""
    lab = _label(text, "نوع العقار")
    if not lab:
        return None
    for tok in _TYPE_TOKENS:
        if lab.startswith(tok) or lab == tok:
            return _qualify_land(_TYPE_AR[tok], text)
    return None


_PRICE_RE = re.compile(r"([\d٠-٩][\d٠-٩,\.]{2,})\s*(?:SAR|ريال|ر\.س)")
# Both variants print the headline price in the header, BEFORE the overview/detail block opens.
_HEADER_END_RE = re.compile(r"نظرة\s*عامة|تفاصيل\s*العقار")


def parse_price(text: str) -> Optional[int]:
    """The listing's HEADLINE price, read from the header span only.

    Not «the first money token on the page»: a description may quote several figures for the same
    property — a real safera قصر prints «حد البيع: 4,000,000 ريال» (the asking price) AND
    «السوم: 3,500,000 ريال» (the current BID). Both are this listing's own numbers, so no
    similar-ads truncation would separate them, and taking the wrong one understates the price by
    12.5%. The header figure is the one the source displays as THE price, so the span is bounded at
    «نظرة عامة»/«تفاصيل العقار» by construction rather than relying on match order.
    """
    m0 = _HEADER_END_RE.search(text)
    head = text[:m0.start()] if m0 else text
    m = _PRICE_RE.search(head)
    if not m:
        return None
    try:
        n = int(float(m.group(1).translate(_AR_DIGITS).replace(",", "")))
        return n if n > 0 else None
    except ValueError:
        return None


_AREA_RE = re.compile(r"المساحة\s*:?\s*([\d٠-٩][\d٠-٩,\.]*)\s*م")
# Variant A prints «عدد الغرف: 7»; only «غرف النوم» was matched, so every gudai/safera row
# stored bedrooms=NULL while bathrooms parsed fine from «الحمامات» — the asymmetry that gave
# the bug away. Both spellings are the source's own, so both are read.
_BED_RE = re.compile(r"(?:غرف\s*النوم|عدد\s*الغرف)\s*:?\s*([\d٠-٩]+)")
# «مؤثثة: نعم/لا» is a real tri-state: «لا» is the source SAYING no, not staying silent.
# The colon is required — the summary chip above prints a bare «غير مؤثثة» and matching that
# loosely would read the negation as the label's value.
_FURN_RE = re.compile(r"مؤثثة\s*:\s*(نعم|لا)")
# «عام الاكتمال: 2021» (a completion YEAR) and, in variant B's prose, «العمر : 16 سنه».
_YEAR_RE = re.compile(r"عام\s*الاكتمال\s*:?\s*([\d٠-٩]{4})")
_AGE_RE = re.compile(r"العمر\s*:?\s*([\d٠-٩]{1,3})\s*سن")
_BATH_RE = re.compile(r"(?:دورات\s*المياه|الحمامات|حمامات)\s*:?\s*([\d٠-٩]+)")


def _int_of(rx: re.Pattern, text: str) -> Optional[int]:
    """int() of the source's own number. float() first because areas are routinely DECIMAL here
    («70.31 م2», «627.37 م2», «829.87 م2»); an int()-only parse raised ValueError and silently
    dropped the area on every such listing."""
    m = rx.search(text)
    if not m:
        return None
    try:
        return int(float(m.group(1).translate(_AR_DIGITS).replace(",", "")))
    except ValueError:
        return None


_H2_RE = re.compile(r"<h2[^>]*>(.*?)</h2>", re.S)
_TITLE_TAG_RE = re.compile(r"<title>([^<]+)</title>", re.I)
_IMG_RE = re.compile(r'<img[^>]+src="([^"]+/wp-content/uploads/[^"]+)"')
# A transacted ad the office keeps on display — never an active listing.
_TRANSACTED_RE = re.compile(r"تم\s*(الإيجار|الايجار|البيع)")


def parse_title(page_html: str) -> Optional[str]:
    """Variant A: the first <h2> is the listing title (these pages have no <h1>). Variant B's h2s
    are section headings, so fall back to <title> with the trailing « – office name» segment cut."""
    for m in _H2_RE.finditer(page_html):
        t = re.sub(r"\s+", " ", ihtml.unescape(re.sub(r"<[^>]+>", " ", m.group(1)))).strip()
        if t and any(t.startswith(tok) for tok in _TYPE_TOKENS):
            return t
    m = _TITLE_TAG_RE.search(page_html)
    if not m:
        return None
    t = ihtml.unescape(m.group(1)).strip()
    parts = re.split(r"\s+[–-]\s+", t)
    if len(parts) > 1:
        parts = parts[:-1]  # the last segment is the office's own name
    return " – ".join(p.strip() for p in parts).strip() or None


def photos(page_html: str) -> Optional[list[str]]:
    urls = [u for u in dict.fromkeys(_IMG_RE.findall(page_html))
            if "logo" not in u.lower() and "cropped-" not in u
            and not re.search(r"-\d{2,3}x\d{2,3}\.(?:png|jpe?g|webp)$", u)]
    return urls[:20] or None


def map_listing(url: str, page_html: str, *, source: str, prefix: str) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason). row None → skipped for skip_reason."""
    text = visible_text(page_html)
    title = parse_title(page_html)
    if not title or not re.search(r"تفاصيل العقار|نظرة عامة", text):
        return None, "residential", "no_detail_block"
    if _TRANSACTED_RE.search(title):
        return None, "residential", "already_transacted"

    type_ar = parse_type_ar(title, text)
    if not type_ar:
        return None, "residential", "type_unmapped"
    property_type = normalize.map_type_exact(type_ar)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    offer = _label(text, "نوع العرض") or ""
    deal = ("Rent" if re.search(r"إيجار|ايجار", offer or title) else
            "Buy" if re.search(r"بيع", offer or title) else None)
    if not deal:
        return None, category, "no_deal"

    # Variant A labels the city; variant B states «المنطقة: القصيم – بريدة» in the description
    # and «العنوان – التوفيق بريدة» in the overview. No form is guessed: each is the source's own
    # statement, tried in that order, and a city to_catalog cannot place skips the listing.
    city_ar = _label(text, "المدينة")
    district_raw = _label(text, "الحي")
    if not city_ar:
        m = re.search(r"المنطقة\s*:?\s*([^\s–-]{2,20})\s*[–-]\s*([^\s.،]{2,20})", text)
        if m:
            city_ar = m.group(2).strip()
    if not city_ar:
        # Variant B: «العنوان بريدة» (city only) or «العنوان – حي الريان بريدة» (district + city).
        # The CITY is the TRAILING token — the only part to_catalog can place — and whatever
        # precedes it is offered as the district. Both are the source's own string; a trailing
        # token the catalog cannot place leaves the listing cityless and it is SKIPPED, never
        # guessed. (An earlier form of this required the address to be followed by «الوصف|نظرة»,
        # which real pages do not do — they run on into «نوع الايجار» — so it matched nothing.)
        addr = _label(text, "العنوان")
        if addr:
            parts = [x for x in re.split(r"\s+", addr.strip(" –-")) if x]
            if parts and to_catalog(parts[-1])[0]:
                city_ar = parts[-1]
                if len(parts) > 1 and not district_raw:
                    district_raw = " ".join(parts[:-1]).strip(" –-") or None
    if not city_ar:
        return None, category, "no_city"
    city = normalize.map_city(city_ar)
    city_id, region_id = to_catalog(city_ar)
    if not city_id:
        return None, category, "city_not_in_catalog"
    if not district_raw:
        m = re.search(r"العنوان\s*[–-]?\s*(.{2,40}?)\s*" + re.escape(city_ar), text)
        if m:
            district_raw = m.group(1).strip(" –-") or None
    district_ar = find_district_in_text(district_raw, city_id) if (district_raw and city_id) else None
    license_number = None
    lm = re.search(r"ترخيص\s*:?\s*([\d٠-٩]{6,12})", text)
    if lm:
        license_number = lm.group(1).translate(_AR_DIGITS)

    price = parse_price(text)
    slug = url.rstrip("/").rsplit("/", 1)[-1]

    row: dict[str, Any] = {
        "ad_number": f"{prefix}{int(__import__('hashlib').sha1(slug.encode()).hexdigest()[:10], 16) % 10**9}",
        "listing_url": url,
        "source": source,
        "active": True,
        "title": title,
        "property_type": property_type,
        # Total expression, not the bare `deal`: a transaction_type that is not provably Buy/Rent
        # can reach the index as NULL, and a null deal is quarantined out of search entirely.
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": city,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": district_raw,
        "area_m2": _int_of(_AREA_RE, text),
        "bedrooms": _int_of(_BED_RE, text),
        "bathrooms": _int_of(_BATH_RE, text),
        "photo_urls": photos(page_html),
        # license_number was already parsed but filed only in additional_info, where the Advanced
        # Filter cannot see it. It is a first-class column on every platform table — write it there.
        "license_number": license_number,
    }

    # «مؤثثة: نعم/لا» — tri-state, and only when the source states one of the two.
    fm = _FURN_RE.search(text)
    if fm:
        row["furnished"] = fm.group(1) == "نعم"

    # Age: the source's own «العمر : 16 سنه» first, then «عام الاكتمال: 2021» restated as an age.
    am = _AGE_RE.search(text)
    age = normalize.parse_property_age(am.group(1).translate(_AR_DIGITS)) if am else None
    if age is None:
        ym = _YEAR_RE.search(text)
        if ym:
            age = normalize.age_from_completion_year(
                ym.group(1).translate(_AR_DIGITS), this_year=datetime.now(timezone.utc).year)
    if age is not None:
        row["property_age"] = age

    # «المرافق: مصعد، مواقف» — one packed cell the parser already read and then discarded. Only the
    # amenities the source NAMES are written; the rest stay NULL (silence is not a "no").
    for col, val in normalize.amenities_from_text(_label(text, "المرافق")).items():
        row[col] = val
    # Variant B (safera) has no «المرافق» cell and no spec rows — it writes the whole property out
    # in the «الوصف» prose instead («قسم الرجال: مجلس – مطبخ – صالة – 3 دورات مياه»). 8 of its 9
    # listings were blind to every filter question until this. The description is read only up to
    # the next section heading so a «عروض مشابهه» block can never leak another listing's features
    # in, and an amenity already stated by «المرافق» is not overwritten by the prose.
    dm = re.search(r"الوصف\s*(.{20,2500}?)(?=المميزات|عروض مشابهه|احجز|اتصل بنا|$)", text, re.S)
    if dm:
        for col, val in normalize.amenities_from_text(dm.group(1)).items():
            row.setdefault(col, val)

    if deal == "Rent":
        rent_period, price_annual = normalize.rent_period_and_annual(price, text)
        row["price_annual"] = price_annual
        if rent_period:
            row["rent_period"] = rent_period
    else:
        row["price_total"] = price
    row["additional_info"] = {k: v for k, v in {
        "type_ar": type_ar, "slug": slug, "amenities_text": _label(text, "المرافق"),
        "license_number": license_number,
        "type_ar_label": (lambda lab: lab if lab and lab != type_ar else None)(type_from_label(text)),
    }.items() if v is not None}
    return row, category, ""


def fetch_catalogue(s: cc.Session, base: str, limit: int = 0) -> list[str]:
    """Discover every listing URL from the tenant's own sitemap.

    RETRIED, because an empty catalogue is fatal: `run_platform` raises on it (correctly — a
    silent zero would look like "the site has no listings" and is exactly how a blocked crawl
    would present). gudai failed twice on 2026-09-20 with «sitemap returned no /property/ urls»
    while safera and alhumaidan — the same code, the same host — succeeded in the same minute, so
    the fetch is intermittently flaky rather than the site being down. One attempt turned that
    flake into a failed run and a day of stale data.

    Three passes with growing backoff over BOTH sitemap spellings. Only a genuinely empty result
    after all of them raises, so the fail-loud guard keeps its meaning."""
    for attempt in range(3):
        seen: set[str] = set()
        for sm in (f"{base}/property-sitemap.xml", f"{base}/wp-sitemap-posts-property-1.xml"):
            try:
                r = s.get(sm, timeout=40)
            except Exception:
                continue
            if r.status_code == 200 and "<loc" in r.text:
                seen |= {u for u in re.findall(r"<loc>([^<]+)</loc>", r.text) if "/property/" in u}
            if seen:
                break
        if seen:
            out = sorted(seen)
            return out[:limit] if limit else out
        if attempt < 2:
            print(f"  sitemap empty (attempt {attempt + 1}/3) — retrying", flush=True)
            time.sleep(3 * (attempt + 1))
    return []


def skip_note(skipped: dict[str, int]) -> Optional[str]:
    """Render the per-reason skip tally for scrape_runs.notes; None when nothing was skipped.

    Named (not inlined) so a barrier can execute the REAL function rather than a retyped copy.
    Ordered by descending count so the dominant reason leads, and capped at the 300 chars the
    rest of this fleet uses for notes.
    """
    if not skipped:
        return None
    body = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda kv: (-kv[1], kv[0])))
    return ("skipped: " + body)[:300]


def run_platform(*, slug: str, base: str, source: str, prefix: str) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run(slug)
    res: list[dict] = []
    com: list[dict] = []
    try:
        urls = fetch_catalogue(s, base, limit=args.limit)
        if not urls:
            raise RuntimeError("sitemap returned no /property/ urls")
        print(f"{source}: {len(urls)} listings discovered", flush=True)
        skipped: dict[str, int] = {}
        for u in urls:
            try:
                r = s.get(u, timeout=40)
            except Exception:
                skipped["unreachable"] = skipped.get("unreachable", 0) + 1
                continue
            if r.status_code != 200:
                skipped[f"http_{r.status_code}"] = skipped.get(f"http_{r.status_code}", 0) + 1
                continue
            row, cat, why = map_listing(u, r.text, source=source, prefix=prefix)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        if skipped:
            print("  skipped (not guessed): "
                  + ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1])))
        if dry:
            print(f"✓ {source} VALIDATION: {len(res)} residential + {len(com)} commercial (nothing written)")
            for r0 in (res + com)[:12]:
                print(f"   {r0['ad_number']:>12} {r0['transaction_type']:4} {str(r0['property_type']):14} "
                      f"{str(r0['city_ar']):10} area={str(r0['area_m2']):>6} "
                      f"px={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')} photos={len(r0.get('photo_urls') or [])}")
            return 0
        if res:
            getattr(db, f"upsert_{slug}_residential_batch")(res)
        if com:
            getattr(db, f"upsert_{slug}_commercial_batch")(com)
        superseded = db.retire_superseded_siblings(
            res_table=f"{slug}_residential_listings",
            com_table=f"{slug}_commercial_listings",
            res_ads={r["ad_number"] for r in res},
            com_ads={r["ad_number"] for r in com},
            source=source)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        n = len(res) + len(com)
        # PERSIST THE SKIP BREAKDOWN — it is the only thing separating an honest empty run from a
        # parser that quietly dropped everything, and printing it to stdout threw it away.
        # Measured 2026-09-20: alhumaidan reported ok=true, rows_seen=3, rows_upserted=0 across four
        # daily runs with notes NULL. That is CORRECT — all three of the office's ads are «تم الإيجار»
        # / «تم البيع» (transacted, still displayed), which this module skips by design. But from the
        # database, which is what every dashboard and every later investigation actually reads, it was
        # indistinguishable from a broken parser, and it cost a full investigation to tell apart.
        # `ok` deliberately stays True: a site whose whole catalogue is sold out is healthy, not failing.
        note = skip_note(skipped)
        healthy = db.end_run(run_id, ok=True, rows_seen=len(urls), rows_upserted=n,
                             notes=note,
                             check_tables=[f"{slug}_residential_listings",
                                           f"{slug}_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {source}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=str(e)[:300])
        print(f"✗ {source}: {e}", flush=True)
        return 1
