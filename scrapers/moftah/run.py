"""مفتاح العقار — moftah-aleaqar.com. 13 listings, onboarding 2026-09-20.

SOURCE SHAPE (probed live over all 13 listings before a line of this was written; every claim below
was measured, and three of them CONTRADICT the handoff note this scraper was commissioned from):

  · WordPress 7.1.1 + **WooCommerce**. The listings are Woo PRODUCTS served at /property/<slug>/.
    There is no property-sitemap; /sitemap_index.xml → product-sitemap.xml holds the 13 (+ the
    /properities/ archive page, which is not a listing). The 10 /portfolio/ URLs are lorem-ipsum
    theme demo content ("suspendisse-quam-at-vestibulum") and are not listings either.
  · The WHOLE record is available structured from the Woo **Store API**:
        /wp-json/wc/store/v1/products?per_page=100&page=N
    returning name, permalink, prices{}, images[] and — the valuable part — an `attributes` list
    that is the site's own spec table («المساحة», «سعر المتر», «الغرض», «عمر العقار», «مكيف»,
    «غرفة خادمة», «التأثيث», «المدخل», «رقم الترخيص» …). Nothing is parsed out of the page HTML.

  · TRANSPORT: the site sits behind a CDN that serves an identical 6,192-byte 403 interstitial
    ("Checking your browser before accessing") to EVERY chrome* TLS fingerprint from this network,
    while `safari184` and `firefox135` are served 200 on the same IP in the same second (measured:
    chrome/chrome124/chrome131/chrome136 → 403; safari184/firefox135 → 200). That is a fingerprint
    challenge, not a dead site, so the profile is negotiated at session time rather than hardcoded —
    a machine where the verdict is reversed must not read as an outage. impersonate still OWNS the
    User-Agent: no UA header is ever set.

  · **PRICE — the handoff note had this backwards, and following it would have overwritten
    source-published prices with wrong derived ones.** The note said moftah publishes «سعر المتر»
    and no total, and that the total should be reconstructed as ppm × area. Measured: `prices.price`
    carries a real TOTAL on 13/13, and it is the figure the page renders in its own
    `woocommerce-Price-amount` element (verified on three pages). On the 4 listings that ALSO
    publish «سعر المتر», the source total and ppm × area DISAGREE on two of them:
          id 30082  ppm 1200 × 256 m² = 307,200   → source/page says   307,356
          id 30079  ppm 4600 × 774 m² = 3,560,400 → source/page says 3,560,400  (agrees)
          id 30072  ppm 5900 × 403 m² = 2,377,700 → source/page says 2,377,700  (agrees)
          id 30066  ppm 5500 × 425 m² = 2,337,500 → source/page says 2,550,000
    So this scraper NEVER multiplies. It stores `prices.price` verbatim and files the source's
    per-metre rate in additional_info. Per-metre × area is a SEARCH/DISPLAY-layer derivation whose
    first precondition is that the source published NO price at all
    ([[feedback_ppm-times-area-becomes-a-shown-searchable-total]]); in `scrapers/` PRICE = SOURCE,
    and a derived number may never overrule a published one.
  · `prices.currency_minor_unit` is 0 on 13/13, i.e. the integer is whole riyals. It is ASSERTED
    rather than assumed: a minor_unit of 2 would mean the same string is halalas and storing it
    would be a 100× error, so a non-zero unit stores no price instead of a converted guess.

  · **RENT — one listing, and its figure is small next to its area.** id 30073,
    «مكتب تجاري للإيجار … مدينة الرياض», spec «المساحة 5,000م²», price 1,500. The page publishes
    1,500 in the same price element as every total, states NO period (no «سنوي»/«شهري» anywhere on
    it) and — unlike the four land ads — publishes NO «سعر المتر», so its basis is simply not
    stated. Both available inventions were refused: 1,500 × 5,000 would fabricate a 7.5M annual
    rent, and dropping the number would be the plausibility gate that
    [[feedback_no-hiding-source-published-prices-rule]] retired ("whatever is in the websites they
    put … we scrape match display"). It is therefore stored exactly as published, in `price_annual`
    with `rent_period` NULL, and additional_info carries price_basis_stated=false so the shape is
    auditable from the row. FLAGGED for the owner in the onboarding report.

  · TYPE. Only 4 of 13 carry a «نوع العقار» attribute and it is the WEAKER signal: on id 30264 it
    says «عمارة سكنية» for a 106 m² unit the title and the category both call a شقة (and
    «عمارة سكنية» has no canonical mapping anyway, so it could only ever produce a skip). The title
    is the reliable field — «‹type› للبيع/للإيجار …» on 13/13 — so the type is read from the title
    and the attribute is kept as a recorded second opinion.
    **The attribute value «فیلا» is spelt with a PERSIAN YEH (ی U+06CC), not Arabic ي**, on 3 of the
    4 that have it; `normalize._norm_ar` does not fold it, so `map_type_exact('فیلا')` returns None.
    Anything read off this source is yeh/kaf-folded first.
    «أرض» + the source's own «الغرض = تجاري» maps to «أرض تجارية» (Commercial Land) rather than
    letting a commercial plot default into residential search. All 4 current lands say سكني, so
    this composes two stated facts and fires on none of them today.
  · AREA. «المساحة» is «5,000م²» / «139م²», and the title suffix is «_مساحة 250 م2». `to_int` on
    that whole phrase returns 2502 — the «2» of «م2» is a digit and gets concatenated — so the
    numeric run is regexed out first and only that is parsed. Never `to_int(phrase)`.
  · AMENITIES. The four outcomes are the shared helper's — named → True, «غير مفروش» → False,
    «مصعد مؤسس» → NULL, «قريب من حديقة الملك سلمان» (id 30066, verbatim) → NULL — and silence is
    simply absent from the dict, so a column the source never mentioned is never written. Two things
    had to be got right around it:
      - the spec pairs are emitted VALUE-FIRST («متوفر مصعد»), because the helper only looks for a
        negator BEFORE the token: measured, "مصعد غير متوفر" → True (a fixture the ad denies) while
        "غير متوفر مصعد" → False. A pair whose value carries no negator is ALSO emitted label-first,
        because «المدخل: خاص» (id 30198) only forms «مدخل خاص» in that order.
      - the helper's negator test is a bare substring check with no word boundary, and `_norm_ar`
        folds ة→ه, so «صغيرة»→«صغيره» CONTAINS «غير». Both Sedra villas say «بركة صغيرة … موقف خاص
        لسيارتين» and came back parking=False — a fabricated denial. amenities() re-checks every
        False for a standalone negator word and drops the ones that fail, back to NULL. It can only
        delete, never invent. The shared helper wants the word-boundary fix centrally (it hits every
        platform: «صغير», «تغيير», «الغير»); this becomes a no-op once that lands.
  · BEDROOMS / BATHROOMS live in NEITHER the Store API nor wp/v2 (its `meta` is []): the theme
    renders them from product meta into a `<div class="property-features">` block on the product's
    OWN page, one item per count — «3 غرف نوم», «3 دورة مياه» — the icons a user sees under the
    price. Measured 2026-09-21 over all 13 pages: 8 carry the block (7 with both counts, id 30264
    with bedrooms only), the 5 land/office pages carry none. The same block is repeated on the
    related-product cards further down each page, so only the block inside the page's own
    `id="product-<pid>"` section — before the first related card's `data-id` — is read. Each item
    is «<count> <fixed noun>»: the count must be ONE number (Western or Arabic-Indic digits, or a
    word numeral); «3+1», «2-3», «2 في كل دور» are ambiguous and stay NULL, never summed or guessed.
    Dwelling types only. The block OUTRANKS prose: id 30198's block says «4 غرف نوم» where its
    description lists «3 غرف نوم + غرفة خادمة» — the card shows the source's own count, 4. Where
    no block exists, the old prose path still applies: only the shared «N غرف … وصالة» idiom
    (id 30135), and «الصالات» is a HALL count, never bedrooms. A page that fails to load writes no
    count at all, so a stored one is never erased by a failed fetch.
  · The `description` / `short_description` HTML is pasted from other tools (one carries ChatGPT
    transcript markup, class names and all). It is tag-stripped and entity-unescaped to visible
    text before anything reads it, and it is only ever read for amenities/rooms — never for a price
    ([[feedback_price-equals-source-invariant]]; `price_evidence(origin="description")` raises).
  · LOCATION. Titles are Aqar-shaped — «أرض للبيع في حي الضباط, مدينة الرياض, منطقة الرياض_مساحة
    425م²» — but their segments are separated by «_» and «,» and `resolve_slug` tokenizes on
    WHITESPACE only, so the city arrives glued as «الرياض_مساحه»/«الخبر,»: measured, resolve_slug
    returned confidence='unresolved' on 11 of the 13, an 85% city loss that reads as a catalog gap.
    So the title is split on its OWN separators and each segment is offered to `to_catalog`, which
    stays the only arbiter of what is a city — the source's own "city" label is never trusted, and
    on id 30072 that label is «مدينة امارة منطقة الرياض – الدرعيه», a region phrase whose real city
    «الدرعيه» is the NEXT segment (resolve_slug picked الرياض there, from the trailing «منطقة
    الرياض»). See read_location() for the full segment priority. A title whose city the catalog
    cannot place is SKIPPED, never guessed. district_ar is the catalog match from
    find_district_in_text; `neighborhood` keeps the source's own «حي …» text for the card.
  · PHOTOS: 1–48 per listing (13/13 have at least one), capped at 20 per the row contract. Not 9;
    the handoff note's "9 photos each" is the gallery widget's page size, not the image count.
  · No auction and no sold/rented ad is present in the current 13. Both are still detected and
    counted, because they are what this source will publish next and a skip must never be a silent
    zero.
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.http_liveness import LivenessProbe  # noqa: E402
from scrapers.common.arabic_location import (  # noqa: E402
    city_ar_for, find_district_in_text, to_catalog)

BASE = "https://moftah-aleaqar.com"
SOURCE = "Moftah"
PREFIX = "MFT"
RES_TABLE = "moftah_residential_listings"
COM_TABLE = "moftah_commercial_listings"

# The CDN challenges chrome* fingerprints from some networks and not others (see docstring). Tried
# in order; the first profile the site answers 200 to wins the whole run.
IMPERSONATE_ORDER = ("safari184", "firefox135", "chrome")

# Persian yeh/kaf → Arabic. The spec table's «فیلا» uses ی (U+06CC) and normalize._norm_ar does not
# fold it, so every string read off this source passes through here before any mapping.
_FOLD = str.maketrans({"ی": "ي", "ک": "ك", "ھ": "ه"})

# The source's own offer words. Also the boundary the type noun sits in front of.
_DEAL_RE = re.compile(r"(للبيع|للإيجار|للايجار|للتقبيل)")

# Ads we must not publish as offers. «مزاد» is an auction, not a price; the rest are closed deals.
_AUCTION_RE = re.compile(r"مزاد")
_CLOSED_RE = re.compile(r"تم\s*البيع|تم\s*الإيجار|تم\s*الايجار|تم\s*التأجير|مباع|تم\s*الحجز")

# «_مساحة 250 م2» / «المساحة 5,000م²» — capture the NUMERIC RUN only. to_int on the whole phrase
# swallows the «2» of «م2» (measured: "250 م2" → 2502).
_NUM_RUN_RE = re.compile(r"([\d٠-٩][\d٠-٩.,٬]*)")

# The title's real segment separators. `resolve_slug` splits on whitespace and «-» only, so without
# this the city arrives glued as «الرياض_مساحه» (measured: 11 of 13 unresolved). «–» U+2013 is the
# en-dash the source's `&#8211;` unescapes to.
_SEP_RE = re.compile(r"[,،_|–—]+|\s-\s")
_CITY_SEG_RE = re.compile(r"^(?:امار[ةه]\s+)?مدين[ةه]\s+(.+)$")
_REGION_SEG_RE = re.compile(r"^(?:ال)?منطق[ةه]\b|^منطق[ةه]\s")
# «حي X» is sometimes its OWN segment («…, حي ملهم, مدينة ملهم, …») and sometimes embedded in the
# leading one («أرض للبيع في حي الضباط, مدينة الرياض, …»), so it is SEARCHED, not anchored. The
# lookbehind keeps «صحي» (as in «صرف صحي») from reading as a district. Up to 3 words, the same
# window resolve_slug uses.
_DISTRICT_SEG_RE = re.compile(r"(?<!\w)(ح[يى]\s+[^\s]+(?:\s+[^\s]+){0,2})")

# The negator words a spec VALUE may carry («غير مفروش», «بدون شقق»). Only used to decide whether
# a pair is safe to also emit label-first; the four-outcome verdict itself is the shared helper's.
_NEGATORS_AR = ("غير", "بدون", "لا يوجد", "لايوجد")

# The spec labels that are not amenity prose and are filed as facts instead.
_SPEC_AREA = "المساحة"
_SPEC_PPM = "سعر المتر"
_SPEC_PURPOSE = "الغرض"
_SPEC_TYPE = "نوع العقار"
_SPEC_OFFER = "نوع العرض"
_SPEC_AGE = "عمر العقار"
_SPEC_HALLS = "الصالات"
_LICENCE_LABELS = ("رقم الترخيص", "رخصة الاعلان", "رقم الإعلان")
# A Bayut listing reference, NOT a REGA licence — kept as its own fact, never as «licence».
_SPEC_BAYUT_REF = "رقم بيوت المرجعي"
# Utility rows of the spec table («الكهرباء: متوفر», «الماء: توفر الماء», «صرف صحي: متوفر»). A row
# that says so is the source stating the service (True); «غير متوفر» is a stated no (False); a
# missing row stays NULL. «عداد كهرباء مستقل» names the separate meter only.
_UTILITY_SPECS = {"الكهرباء": "electricity", "مياه": "water_supply", "الماء": "water_supply",
                  "صرف صحي": "sanitation", "الصرف صحي": "sanitation"}
_TENANT_SPEC = "نوع السكن"

# A room count only means something on a dwelling. A land plot or office never gets one.
_DWELLING = {"Apartment", "Villa", "Duplex", "Floor", "Room", "Studio", "Chalet", "Rest House"}

# The theme's counts block (see docstring). Captured with every item complete: items hold only an
# <img> and a <br>, never a nested div.
_FEATURES_RE = re.compile(r'class="property-features"[^>]*>((?:\s*<div[^>]*>.*?</div>)*)', re.S)
_FEATURE_ITEM_RE = re.compile(r"<div[^>]*>(.*?)</div>", re.S)
# «<count> <fixed noun>» after _norm_ar (ة→ه). The count part is validated by _count() below.
_COUNT_NOUNS = (("bedrooms", re.compile(r"^(.+?)\s*غرف(?:ه)?\s*(?:ال)?نوم$")),
                ("bathrooms", re.compile(r"^(.+?)\s*دور(?:ه|ات)\s*(?:ال)?مياه$")))
_WORD_COUNT = {"واحد": 1, "واحده": 1, "اثنين": 2, "اثنان": 2, "اثنتين": 2, "ثلاث": 3, "ثلاثه": 3,
               "اربع": 4, "اربعه": 4, "خمس": 5, "خمسه": 5, "ست": 6, "سته": 6, "سبع": 7, "سبعه": 7,
               "ثمان": 8, "ثماني": 8, "ثمانيه": 8, "تسع": 9, "تسعه": 9, "عشر": 10, "عشره": 10}


def fold(s: Optional[str]) -> Optional[str]:
    """Entity-unescape + Persian-letter fold + whitespace collapse. Everything read off this source
    goes through here; `&#8211;` in a title and ی in «فیلا» both break downstream matching."""
    if s is None:
        return None
    return re.sub(r"\s+", " ", html.unescape(str(s)).translate(_FOLD)).strip() or None


def visible_text(raw: Optional[str]) -> Optional[str]:
    """Woo `description` is HTML pasted from other tools (one listing carries ChatGPT transcript
    markup). Strip tags to the text a human sees before any parser reads it."""
    if not raw:
        return None
    return fold(re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", str(raw))))


def session() -> cc.Session:
    """Negotiate a TLS fingerprint the CDN serves, then keep it for the run."""
    last = ""
    for prof in IMPERSONATE_ORDER:
        s = cc.Session(impersonate=prof)          # impersonate owns the UA — no UA header is set
        s.headers.update({"Accept": "application/json", "Accept-Language": "ar,en;q=0.7"})
        try:
            r = s.get(f"{BASE}/wp-json/wc/store/v1/products", params={"per_page": 1}, timeout=40)
        except Exception as e:                    # noqa: BLE001 - any transport error → next profile
            last = f"{prof}:{type(e).__name__}"
            continue
        if r.status_code == 200:
            s.__dict__["_moftah_profile"] = prof
            return s
        last = f"{prof}:{r.status_code}"
    raise RuntimeError(f"no TLS profile was served by {BASE} (tried {IMPERSONATE_ORDER}; last {last})")


def num(raw: Optional[str]) -> Optional[int]:
    """First numeric run in a spec value, parsed by the shared to_int (so Arabic-Indic digits,
    Arabic separators and comma grouping all behave). None when there is no number."""
    if not raw:
        return None
    m = _NUM_RUN_RE.search(str(raw).translate(normalize._TRANS))
    return normalize.to_int(m.group(1)) if m else None


def specs(p: dict) -> dict[str, str]:
    """The site's spec table as {label: value}. Multi-term attributes are joined with «، » so the
    amenity scan still sees each value."""
    out: dict[str, str] = {}
    for a in p.get("attributes") or []:
        label = fold(a.get("name"))
        vals = [v for v in (fold(t.get("name")) for t in (a.get("terms") or [])) if v]
        if label and vals:
            out[label] = "، ".join(vals)
    return out


def spec_amenity_blob(sp: dict[str, str]) -> str:
    """Render the spec pairs VALUE-FIRST for `amenities_from_text`.

    The helper reads a negator only in the 12 characters BEFORE the token, so the site's own
    label-then-value order inverts its verdict: measured, "مصعد غير متوفر" → elevator=True (a
    fixture the ad denies) while "غير متوفر مصعد" → elevator=False. Emitting value-first is what
    makes «غير مفروش», «مصعد مؤسس» and «قريب من …» all land on the right one of the four outcomes.
    """
    parts = []
    for label, val in sp.items():
        if label in (_SPEC_AREA, _SPEC_PPM, _SPEC_AGE, _SPEC_HALLS, _SPEC_BAYUT_REF) or label in _LICENCE_LABELS:
            continue                              # numbers and dates are not amenity prose
        parts.append(f"{val} {label}")
        # …and ALSO name-first when the value carries no negator, because some pairs only form the
        # canonical phrase in that order: «المدخل: خاص» (id 30198) is «مدخل خاص» read label-first and
        # nothing at all read value-first. Suppressed whenever the value negates, so the inversion
        # above can never come back in through this copy.
        if not any(n.strip() and n.strip() in val for n in _NEGATORS_AR):
            parts.append(f"{label} {val}")
    return "، ".join(parts)


def amenities(text: Optional[str]) -> dict[str, bool]:
    """`normalize.amenities_from_text`, with accidental negations narrowed back to NULL.

    THE BUG THIS GUARDS (measured on ids 30274 and 30247, 2026-09-20). The shared helper decides a
    negation by testing whether any of «غير»/«بدون»/«لا يوجد» appears ANYWHERE in the 12 characters
    before the token — a bare substring test, no word boundary. `_norm_ar` folds ة→ه, so «صغيرة»
    becomes «صغيره», whose letters 2-4 ARE «غير». Both villas say «بركة صغيرة … موقف خاص لسيارتين»
    (a private two-car space) and both came back parking=False: a fixture the ad states, recorded as
    denied. «تغيير», «صغير» and «الغير» trip it the same way, on every platform.

    This only ever DELETES a False whose negator is not a standalone word — it never invents a True
    and never touches a real «غير مفروش»/«بدون مصعد». A deleted key is absent, i.e. NULL, which is
    what the source actually said. The shared helper needs the word-boundary fix centrally; when it
    lands this becomes a no-op and the barrier test still passes.
    """
    out = normalize.amenities_from_text(text)
    if not out or not text:
        return out
    t = normalize._norm_ar(str(text)).lower()
    for col, val in list(out.items()):
        if val is not False:
            continue
        real = False
        for tok in normalize._AMENITY_TOKENS[col]:
            k = normalize._norm_ar(tok).lower()
            for m in re.finditer(re.escape(k), t):
                before = t[max(0, m.start() - 12):m.start()]
                if any(re.search(rf"(?<!\w){re.escape(n.strip())}(?!\w)", before)
                       for n in normalize._NEGATORS if n.strip()):
                    real = True
                    break
            if real:
                break
        if not real:
            del out[col]
    return out


def utilities(sp: dict[str, str]) -> dict[str, bool]:
    out: dict[str, bool] = {}
    for label, col in _UTILITY_SPECS.items():
        vals = [v.strip() for v in (sp.get(label) or "").split("،") if v.strip()]
        if any(n in v for v in vals for n in _NEGATORS_AR):
            out[col] = False
        elif any(v == "متوفر" or v.startswith("توفر") for v in vals):
            out.setdefault(col, True)
    if "عداد كهرباء مستقل" in (sp.get("الكهرباء") or ""):
        out["separate_electricity_meter"] = True
    return out


def read_type(title: str, sp: dict[str, str]) -> Optional[str]:
    """Canonical type from the title's leading noun («مكتب تجاري للإيجار …» → Office), falling back
    to the «نوع العقار» attribute. Longest window first, exact-match only — never a substring guess.
    «أرض» is refined by the source's own «الغرض = تجاري» into «أرض تجارية» (Commercial Land)."""
    head = _DEAL_RE.split(title)[0].strip(" _-،,")
    for cand in (head, sp.get(_SPEC_TYPE) or ""):
        words = [w for w in re.split(r"[\s_،,]+", fold(cand) or "") if w]
        for size in range(min(3, len(words)), 0, -1):
            for i in range(len(words) - size + 1):
                phrase = " ".join(words[i:i + size])
                if phrase in ("أرض", "ارض") and (sp.get(_SPEC_PURPOSE) or "").startswith("تجاري"):
                    return normalize.map_type_exact("أرض تجارية")
                t = normalize.map_type_exact(phrase)
                if t:
                    return t
    return None


def read_deal(title: str, sp: dict[str, str]) -> Optional[str]:
    """Buy/Rent from the source's own offer word, in the title or the «نوع العرض» attribute."""
    for text in (title, sp.get(_SPEC_OFFER) or ""):
        m = _DEAL_RE.search(text)
        if m:
            return "Buy" if m.group(1) == "للبيع" else "Rent"
    return None


def read_location(title: str) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """(city_id, region_id, neighborhood_text) from the title. `to_catalog` is the only arbiter of
    what is a city — the source's own "city" label is not trusted.

    WHY THIS IS NOT `resolve_slug`. The titles are Aqar-shaped but their segments are separated by
    «_» and «,», and `resolve_slug` tokenizes on WHITESPACE only (it replaces «-» and nothing else).
    Measured over all 13: the city token arrives glued as «الرياض_مساحه» or «الخبر,» and 11 of 13
    came back `confidence='unresolved'` — a silent 85% city loss that looked like a catalog gap.
    Splitting on the source's real separators first and asking `to_catalog` per segment resolves
    13/13.

    Segment priority, measured against the two shapes this source publishes:
      · «… , حي X , مدينة Y , منطقة Z , مساحة N» → the «مدينة Y» segment, and when its own text is
        a region label rather than a city, the segment straight after it. That is the one mangled
        ad: «مدينة امارة منطقة الرياض – الدرعيه» — the «مدينة» segment reads «امارة منطقة الرياض»
        (the Diriyah emirate, a REGION phrase) and the real city «الدرعيه» is the next segment.
        `resolve_slug` picked الرياض here, from the title's trailing «منطقة الرياض».
      · «فيلا للبيع _ شارع رقم 1241 _ حي سدرة _ الرياض _ مساحة 250 م2» → no «مدينة» segment at all,
        so segments are scanned RIGHT-TO-LEFT, for the same reason resolve_slug's own scan picks the
        rightmost hit: this source puts the city AFTER the district, and a district that happens to
        share a catalog city's name («عرقة», id 30264) sits earlier.
    A segment containing «منطقة» is a region label and is never offered as a city; a «حي …» segment
    is a district. Nothing is guessed: a title with no catalog hit returns (None, None, …) and the
    listing is skipped.
    """
    segs = [s for s in (x.strip(" -") for x in _SEP_RE.split(title)) if s]
    region_hint = next((s for s in segs if _REGION_SEG_RE.match(s)), None)

    ordered: list[str] = []
    for i, s in enumerate(segs):
        m = _CITY_SEG_RE.match(s)
        if m:
            ordered.append(m.group(1).strip())
            if i + 1 < len(segs):
                ordered.append(segs[i + 1])
    if not ordered:
        ordered = list(reversed(segs))

    city_id = region_id = None
    # No pre-filter on the candidates: `to_catalog` already refuses everything that is not a whole
    # catalog city name — measured, «منطقة الرياض», «امارة منطقة الرياض», «المنطقة الشرقية» and
    # «مساحة 425م²» all return (None, region_id). A hand-written exclusion list here would be a
    # guard that never re-checks itself (a mutant sweep on 2026-09-20 showed removing it changed
    # nothing), so the catalog stays the single arbiter.
    for cand in ordered:
        if not cand:
            continue
        city_id, region_id = to_catalog(cand, region_hint)
        if city_id:
            break
    # The card shows the source's own district text; district_ar carries the canonical match.
    hood = next((m.group(1).strip() for m in (_DISTRICT_SEG_RE.search(s) for s in segs) if m), None)
    return city_id, region_id, hood


def _count(raw: str) -> Optional[int]:
    """ONE number, or nothing: «3», «٣», «ثلاث». «3+1», «2-3», «2 في كل دور» → None."""
    raw = raw.strip()
    n = int(raw) if raw.isdecimal() else _WORD_COUNT.get(raw)   # int() reads «٣» as 3
    return n if n is not None and 1 <= n <= 20 else None


def page_rooms(page: Optional[str], pid: Any) -> dict[str, int]:
    """{bedrooms, bathrooms} from the product page's own counts block; {} when the page did not
    load, is not this product's, or carries no block. A count that is not one clear number is left
    out (NULL), never summed or guessed."""
    if not page:
        return {}
    start = page.find(f'id="product-{pid}"')
    if start < 0:
        return {}
    end = page.find('data-id="', start)         # the related-product cards (same block) start here
    m = _FEATURES_RE.search(page, start, end if end > 0 else len(page))
    if not m:
        return {}
    out: dict[str, int] = {}
    for item in _FEATURE_ITEM_RE.findall(m.group(1)):
        text = normalize._norm_ar(fold(re.sub(r"<[^>]+>", " ", item)) or "")
        for col, rx in _COUNT_NOUNS:
            hit = rx.match(text)
            n = _count(hit.group(1)) if hit else None
            if n is not None:
                out[col] = n
    return out


def fetch_page(s: cc.Session, url: Optional[str]) -> Optional[str]:
    """The product page HTML, or None on any failure (which writes no count, never a NULL)."""
    try:
        r = s.get(url, headers={"Accept": "text/html"}, timeout=60)
    except Exception:                              # noqa: BLE001 - a failed page is just unread
        return None
    return r.text if r.status_code == 200 else None


def read_area(title: str, sp: dict[str, str]) -> Optional[int]:
    """«المساحة» attribute first, else the title's «مساحة N م²» suffix. Numeric run only."""
    a = num(sp.get(_SPEC_AREA))
    if a is None:
        m = re.search(r"مساح[ةه]\s*([\d٠-٩][\d٠-٩.,٬]*)", title)
        a = normalize.to_int(m.group(1)) if m else None
    return a if a and a > 0 else None


def map_listing(p: dict, page: Optional[str] = None) -> tuple[Optional[dict], str, str]:
    """One Store-API product (+ its page HTML, for the counts block) → (row, category, skip_reason).
    Returns (None, cat, why) for anything this source has not actually said, never a guess."""
    pid = p.get("id")
    if not pid:
        return None, "residential", "no_product_id"
    title = fold(p.get("name")) or ""
    sp = specs(p)
    desc = visible_text(p.get("description"))
    short = visible_text(p.get("short_description"))
    haystack = " ".join(x for x in (title, desc, short, " ".join(sp.values())) if x)

    if _AUCTION_RE.search(haystack):
        return None, "residential", "auction"
    if _CLOSED_RE.search(haystack):
        return None, "residential", "sold_or_rented"

    property_type = read_type(title, sp)
    if not property_type:
        return None, "residential", "type_unmapped"
    category = normalize.category_for_type(property_type).lower()

    deal = read_deal(title, sp)
    if not deal:
        return None, category, "no_deal"

    city_id, region_id, hood = read_location(title)
    if not city_id:
        return None, category, "city_not_in_catalog"
    city_ar = city_ar_for(city_id)
    district_ar = find_district_in_text(hood or title, city_id)

    photos, seen = [], set()
    for im in p.get("images") or []:
        src = fold(im.get("src")) if isinstance(im, dict) else None
        if src and src not in seen:
            seen.add(src)
            photos.append(src)

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{pid}",
        "listing_url": fold(p.get("permalink")) or f"{BASE}/?p={pid}",
        "source": SOURCE,
        "active": True,
        "title": title or None,
        "description": desc,
        # Prose first, then the spec table OVERRIDES it: a structured «التأثيث: غير مفروش» outranks
        # a marketing sentence. Both go through the same four-outcome helper, so a column the source
        # never mentioned is simply absent here and stays NULL.
        **amenities(" ".join(x for x in (desc, short) if x)),
        **amenities(spec_amenity_blob(sp)),
        **utilities(sp),
        # Land is asked ONLY street_width + direction: «عرض الشارع: 15م» → 15; «الواجهة: جنوب» →
        # جنوب; the single term «شمال شرقي» (MFT30066) is the diagonal → «شمال شرق», while two Woo
        # terms («جنوب، شرقي» — two streets) and «3 شوارع» stay NULL.
        "street_width_m": normalize.one_street_width(sp.get("عرض الشارع")),
        "direction": normalize.one_direction(sp.get("الواجهة"), diagonal=True),
        "license_number": next((sp[k] for k in ("رقم الترخيص", "رخصة الاعلان") if sp.get(k)), None),
        # «نوع السكن: عوائل» — the column accepts exactly عوائل/عزاب (sync_search_listings_ar).
        "tenant_category": (sp.get(_TENANT_SPEC) if sp.get(_TENANT_SPEC) in ("عوائل", "عزاب") else None),
        "property_type": property_type,
        # Written as a total expression, not the bare `deal`: a transaction_type that is not provably
        # Buy/Rent reaches the index as NULL and a null deal is quarantined out of search entirely.
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar) if city_ar else None,
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": hood,
        "area_m2": read_area(title, sp),
        "photo_urls": photos[:20] or None,
    }
    # Counts: the page's own block first, then the shared «N غرف … وصالة» prose idiom. A key the
    # source never spoke to is left OUT, not None. «الصالات» is a HALL count, never bedrooms.
    if property_type in _DWELLING:
        row.update(page_rooms(page, pid))
    for k, v in normalize.rooms_from_phrase(" ".join(x for x in (desc, short) if x)).items():
        if k != "bedrooms" or property_type in _DWELLING:
            row.setdefault(k, v)
    halls = num(sp.get(_SPEC_HALLS))
    if halls is not None:
        row["halls"] = halls
    age = normalize.exact_age(sp.get(_SPEC_AGE))           # «أكثر من 10 سنوات» → NULL
    if age is not None:
        row["property_age"] = age

    # ── PRICE = SOURCE ───────────────────────────────────────────────────────
    # `prices.price` is the total the page itself renders. It is stored verbatim and NEVER computed;
    # on this source ppm × area disagrees with the published total on 2 of the 4 ads that publish
    # both, so multiplying would replace a published price with a wrong derived one.
    prices = p.get("prices") or {}
    raw_price = prices.get("price")
    minor = prices.get("currency_minor_unit")
    price = (normalize.to_int(raw_price) or None) if minor == 0 else None
    ppm = num(sp.get(_SPEC_PPM))
    # «0»/«» is WooCommerce's "no price set": the source SETTLED it, so a price it withdraws must
    # clear the stored one (None would be dropped by the writer and leave the old figure standing).
    absent = raw_price in ("", "0")
    period = None
    if deal == "Rent":
        # RENT PERIOD = SOURCE, read from the ad's own title + spec table: annual → verbatim,
        # monthly → ×12, silent → NULL period with the figure unconverted, daily/نصف سنوي → (None, None).
        period, row["price_annual"] = normalize.rent_period_and_annual(
            price, " ".join([title, *sp.values()]))
        if period:
            row["rent_period"] = period
        if absent:
            row["price_annual"] = db.AUTHORITATIVE_NULL
    else:
        row["price_total"] = db.AUTHORITATIVE_NULL if absent else price
    row["price_evidence"] = normalize.price_evidence(
        field="wc/store/v1 prices.price",
        raw=raw_price,
        stored=(row.get("price_annual") or None) if deal == "Rent" else price,
        kind="annual" if deal == "Rent" else "total",
        unit="total",
        origin="api",
        authoritative_absent=(raw_price in (None, "", "0")),
    )
    row["additional_info"] = {k: v for k, v in {
        "product_id": pid,
        "woo_categories": [fold(c.get("name")) for c in (p.get("categories") or [])] or None,
        "source_property_type": sp.get(_SPEC_TYPE),
        "purpose": sp.get(_SPEC_PURPOSE),
        # The source's OWN per-metre rate, kept as a fact. The searchable total is derived from a
        # rate only in the search/display layer, and only when the source published no price.
        "price_per_meter_source": ppm,
        # Two facts about the price's BASIS, recorded so a bare figure on a card can be audited
        # from the row without re-fetching. id 30073 is the shape that needs it: 1,500 against
        # 5,000 m², no period published and no per-metre rate published either.
        "per_metre_rate_published": bool(ppm),
        "rent_period_published": bool(period) if deal == "Rent" else None,
        "licence": next((sp[k] for k in _LICENCE_LABELS if sp.get(k)), None),
        "rega_ad_license_number": next((sp[k] for k in ("رقم الترخيص", "رخصة الاعلان") if sp.get(k)), None),
        "bayut_reference": sp.get(_SPEC_BAYUT_REF),
        "street_width": sp.get("عرض الشارع"),
        "facade": sp.get("الواجهة"),
        "specs": sp or None,
        "currency_minor_unit": minor,
    }.items() if v is not None}
    return row, category, ""


def fetch_products(s: cc.Session, limit: int = 0) -> list[dict]:
    """Every Woo product, paginated. 13 today (one page); the pagination is the site's own header."""
    out: list[dict] = []
    page = 1
    while True:
        r = s.get(f"{BASE}/wp-json/wc/store/v1/products",
                  params={"per_page": 100, "page": page}, timeout=60)
        if r.status_code != 200:
            raise RuntimeError(f"store API page {page} → HTTP {r.status_code}")
        batch = r.json()
        if not isinstance(batch, list) or not batch:
            break
        out.extend(batch)
        if limit and len(out) >= limit:
            return out[:limit]
        if page >= int(r.headers.get("x-wp-totalpages") or 1):
            break
        page += 1
    return out


# ── LIVENESS ────────────────────────────────────────────────────────────────────────────────────
# Absence from the Store API listing only SELECTS candidates; prune_unseen asks this oracle before
# it may deactivate anything, through the shared law (scrapers/common/http_liveness.py), so a
# 403 (this CDN's fingerprint interstitial), a 429/5xx, a timeout or an empty body can never read
# as a death. The probe re-reads the product's OWN Store API record, on the TLS profile session()
# negotiates. MEASURED 2026-09-21: a live product answers 200 with its own id; an id the store does
# not publish answers HTTP 404 with code `woocommerce_rest_product_invalid_id` (193 bytes). So:
#   · 404 carrying woocommerce_rest_product_invalid_id                      → GONE
#   · 200 for THIS id whose own words carry the crawl's _AUCTION_RE/_CLOSED_RE (the same haystack
#     map_listing builds: name, description, short description, spec values) → GONE
#   · 200 for this id otherwise                                            → LIVE
#   · anything else                                                        → no opinion
def _signal_for(pid: int):
    def _signal(status, body, _moved):
        try:
            p = json.loads(body)
        except (ValueError, TypeError):
            return None
        if not isinstance(p, dict):
            return None
        if status == 404 and p.get("code") == "woocommerce_rest_product_invalid_id":
            return "gone"
        if status != 200 or p.get("id") != pid:
            return None
        haystack = " ".join(x for x in (fold(p.get("name")), visible_text(p.get("description")),
                                        visible_text(p.get("short_description")),
                                        " ".join(specs(p).values())) if x)
        return "gone" if (_AUCTION_RE.search(haystack) or _CLOSED_RE.search(haystack)) else "live"
    return _signal


def _verify_gone(ad_number: str) -> tuple[str, str]:
    pid = ad_number[len(PREFIX):]
    if not pid.isdigit():
        return "unknown", f"{ad_number!r} is not a {PREFIX}<product id> ad number"
    return LivenessProbe(platform="moftah", signal=_signal_for(int(pid)), session=session,
                         url_for=lambda _ad: f"{BASE}/wp-json/wc/store/v1/products/{pid}"
                         ).verify_gone(ad_number)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    run_id = None if dry else db.begin_run("moftah")
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        products = fetch_products(s, limit=args.limit)
        if not products:
            raise RuntimeError("store API returned no products")
        print(f"{SOURCE}: {len(products)} products discovered "
              f"(tls={s.__dict__.get('_moftah_profile')})", flush=True)
        pages_read = 0
        for p in products:
            page = fetch_page(s, fold(p.get("permalink"))) if p.get("permalink") else None
            pages_read += page is not None
            row, cat, why = map_listing(p, page)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        print(f"  product pages read for room counts: {pages_read}/{len(products)}")
        notes = ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))
        if skipped:
            print(f"  skipped (not guessed): {notes}")
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:15]:
                print(f"   {r0['ad_number']:>9} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):16} {str(r0['city_ar']):8} "
                      f"d={str(r0['district_ar'])[:14]:14} a={str(r0['area_m2']):>5} "
                      f"bd={str(r0.get('bedrooms')):>4} ba={str(r0.get('bathrooms')):>4} "
                      f"pt={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        db.upsert_moftah_residential_batch(res)
        db.upsert_moftah_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        # PRUNE — only after a COMPLETE enumeration (a --type run holds the other table's seen-set
        # empty by construction; --limit never reaches here), and only with the direct confirm
        # above. prune_unseen's own breakers (0 seen, >30% vanished, <80% re-seen) sit on top.
        pruned = 0
        if args.type == "all":
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=_verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        # An empty or thin run must say WHY in the ledger, not just report a count.
        healthy = db.end_run(run_id, ok=True, rows_seen=len(products),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} skipped: {notes or 'none'}"[:300],
                             check_tables=["moftah_residential_listings",
                                           "moftah_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            notes = ", ".join(f"{k}x{v}" for k, v in skipped.items())
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=f"{str(e)[:240]}{' | skipped: ' + notes if notes else ''}")
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
