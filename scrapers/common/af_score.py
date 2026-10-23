"""Advanced Filter score — the 🔬 engineer's computed rating (docs/ops/ADVANCED_FILTER_ENGINEER.md, "Your score").

Same shape as new_listings_score.py and it IMPORTS its comparison (compare_listing, fold, af_precision,
af_recall) rather than copying it. The sample is production-ready listings first seen MORE than 24 hours
ago (the 🆕 engineer owns the newer ones): 10 per big website, 5 per small one.

  precision   of the yes/no answers we serve that the original ad can judge, the share the ad agrees with
  capture     of the fields the ad itself states, the share we store (not NULL)
  findability the customer's request: the listing's deal, city, district, type + up to two Advanced Filter
              answers its ad really states, sent through the PUBLIC anon RPC the app uses
              (location_search_candidates_ar). Found in the results = found.
  parity      on each one-amenity customer request: the number the Advanced Filter promises on that
              option (apartment_guided_counts_ar cnt_<amenity>) == the results after the tap
              (af_eligible_count with the amenity), both on the anon path the app uses

A page we could not read and a field the ad does not state are never wrong (silent means unknown). A
findability request whose result set was cut by the row cap is undecided, never a miss.

Writes one row per website per night into ops_af_score (until the table exists it prints and exits 0).
Evidence is "source_table:id" keys only (PDPL).

  python -m scrapers.common.af_score --sites aqar --per-site 3 --dry-run --json
"""
from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from scrapers.common.cleanup import _probe
from scrapers.common.db import sb
from scrapers.common.new_listings_score import (
    AF_FIELDS, FIELDS, MATCH, MISMATCH, NEG, PAGE_SILENT, STORED, UNREADABLE, WE_MISS, af_precision, af_recall,
    _cmp_number, compare_listing, unprepared,
    empty_row, fold, norm,
)
from scrapers.common.source_reread import page_evidence
from scrapers.common.normalize import amenities_from_text

TABLE = "ops_af_score"
PAGE = 1000
BIG_SITE = 200               # a website with 200+ older production-ready listings is big
N_BIG, N_SMALL = 10, 5
PACE_S = 1.0
RPC_LIMIT = 5000             # location_search_candidates_ar p_limit; a result this large is undecided
MAX_ANSWERS = 2              # Advanced Filter answers asked per findability request
MIN_AGE_H = 24

# Advanced Filter amenity answers: stored column -> the anon RPC's English slug (amenity params are slugs).
AMENITY_SLUG = {"elevator": "elevator", "parking": "parking", "kitchen": "kitchen", "air_conditioner": "ac",
                "maid_room": "maid_room", "driver_room": "driver_room", "private_entrance": "private_entrance"}
FURNISHED = "furnished"
BOOL_KW = {n: kw for n, k, _, kw in FIELDS if k == "bool"}
RENT = ("إيجار", "ايجار")      # search_listings_ar stores «إيجار»; the bare spelling never matched it
MONTHLY = "شهري"
# Site chrome, not the ad: a short category link such as «مواقف سيارات للإيجار» / «شقق للبيع» sits in every
# aqar page's navigation, so it says nothing about THIS listing (norm() has already folded hamza).
CHROME = re.compile(r"^(?:\S+\s){0,3}(?:للايجار|للبيع)$")
# Fields a website publishes STRUCTURALLY. The law (ADVANCED_FILTER_SOURCE_TRUTH §2): «a structured null
# outranks any prose hit», so for these the page's own structured data (JSON-LD additionalProperty /
# amenityFeature) is the only statement read, never the ad's prose. Measured 2026-10-07 (source-reread
# 37600467768): aqar's 5/10 and tuba's 5/6 findability «misses» were prose («موقف سيارات» in the ad body)
# against aqar's extended_details.special_parking / flat amenity keys and tuba's `garages` count, which
# those ads leave unfilled — our NULL is the source's answer, not a trapped value.
STRUCTURED_ONLY: dict[str, tuple[str, ...]] = {
    "aqar": ("elevator", "parking", "kitchen", "air_conditioner", "maid_room", "driver_room",
             "private_entrance", "furnished"),
    "tuba": ("parking",),
    # gathern's unit page heads its appliance list «مرافق المطبخ» («ثلاجه غلايه», «فريزر مايكرويف …»):
    # the header word is a label, and an appliance list is not the site saying «kitchen» (🔬 decision
    # 2026-10-07, backlog 132, law §6). All 4 gathern «misses» of 2026-10-07 were exactly this.
    # elevator / parking: gathern's «المرافق» list (serverData.data.extraDescription, the labels the scraper maps:
    # «مصعد», «موقف سيارة») is the structured statement. Its 10-14 «misses» (11837661: «بلكونة … مطلة على
    # المواقف», a balcony overlooking the car park) were prose on units whose list names neither (🔬, CI
    # source-reread 38543385427). Read by gathern_props().
    "gathern": ("kitchen", "elevator", "parking"),
    # sanadak's listing object (the RSC payload its page renders) carries kitchenStatusText, acTypeText,
    # numberElevators / numberMaidRooms / numberParkingAreas, isDriverRoomAvailable and isFurnished. Its
    # 2026-10-08 «misses» (5 of 8) were all prose («مطبخ راكب», «موقف خاص» in the description) on ads whose
    # own structured fields are blank: our NULL is the source's answer (law §2). Read by sanadak_page().
    "sanadak": ("elevator", "parking", "kitchen", "air_conditioner", "maid_room", "driver_room", "furnished"),
    # sodasyat's spec grid («بها مصعد», «موقف», «مطبخ», «مكيف», «غرفة سائق» …, scrapers/sodasyat/run.py SPEC_COLS)
    # is its structured statement; an unticked item is silence. Its 2026-10-12 «misses» (3 of 5) were prose
    # («مطبخ أمريكي» in the description) on ads whose grid lists the lift and parking but no kitchen (🔬).
    "sodasyat": ("elevator", "parking", "kitchen", "air_conditioner", "maid_room", "driver_room", "furnished",
                 "private_entrance"),
    # eaqartabuk's candles-map «features» checklist is structured since 2026-10-12 (feature_answers); prose is
    # never read for the four fields it can express.
    "eaqartabuk": ("elevator", "kitchen", "private_entrance", "parking"),
    # squares' «مميزات العقار» chip list is its structured statement for these six (scrapers/squares/run.py
    # _FEATURE_COLS). Its 10-13 misses (13602723, 13602726, CI re-read 38384423613) were description prose
    # («يوجد مصعد في العمارة», «غرفة خادمة مع دورة مياة») on ads whose chip list names neither (🔬, backlog 515).
    "squares": ("elevator", "parking", "kitchen", "air_conditioner", "maid_room", "driver_room"),
    # eastabha (WordPress «WP Residence») prints its WHOLE feature taxonomy as a checklist: a ticked item is
    # `<div class="listing_detail col-md-4 …"><i class="fas fa-check"></i>مطبخ مجهز</div>`, an unticked one the
    # same with `not_present` and an ✗ (CI source-reread 39020724177, 595393 and 595406). The scraper reads
    # the ticked set from the REST `property_features` taxonomy (scrapers/eastabha/run.py FEATURE_COL). Its
    # 2026-10-17 «misses» (kitchen, elevator, AC 5 of 5, 0 of 4 findable) were the ✗ items and description prose
    # («🍳 مطبخ عملي») on ads whose ticked list names none of them: our NULL is the source's answer (🔬, law §2).
    # Read by wpresidence_props().
    "eastabha": ("elevator", "kitchen", "parking", "air_conditioner", "private_entrance"),
    # amaall publishes these through its WordPress `property_feature` taxonomy (scrapers/amaall/run.py FEATURE_MAP).
    # 19 of its 28 live ads leave the taxonomy empty and type «⚫مصعد ⚫مطبخ» into the free description instead; its
    # 10-18 «misses» (0 of 4, CI re-read 39115342028, 10729207 and 10729184) were exactly that prose. A structured
    # null outranks any prose hit (law §2), so our NULL is the source's answer and the score must not ask from it.
    "amaall": ("elevator", "parking", "kitchen", "air_conditioner", "maid_room", "private_entrance"),
    # muktamel publishes features through its own taxonomy (scrapers/muktamel/run.py FEATURE_COLS: «مطبخ مجهز»,
    # «مواقف خاصة», «مدخل مستقل», «مصعد», «تكييف», …), rendered as the page's `<ul class="features-list">` (CI re-read
    # 39231636290). Its 10-19 «misses» (4 of 6) were description prose («مطبخ راكب», «موقف سيارة», «مدخل خاص بالشقة»)
    # on ads whose own list ticks none of them (re-read 39228500483): a structured null outranks prose (law §2).
    # Read by muktamel_props().
    "muktamel": ("elevator", "parking", "kitchen", "air_conditioner", "maid_room", "driver_room",
                 "private_entrance", "furnished"),
    # aldarim (the Nuzul SaaS) publishes these as COUNTS in its listing payload (kitchens, elevators, parking_spots,
    # maid_rooms, driver_rooms; is_ac_installed from the API), and its scraper stores N ≥ 1 as yes and 0 as silence
    # (scrapers/aldarim/run.py). Its 10-14 and 10-20 «misses» asked kitchen from prose («مطبخ داخلي ألماني», 49170)
    # on ads whose own count is 0 (CI re-read; backlog 555): a structured null outranks prose (law §2). Read by
    # nuzul_props(). abwbna / alobid / bahadhabab run the same SaaS but were not reachable to verify (10-20): not added.
    # furnished: the API's is_furnished (filed in additional_info, 0 on all 132 active ads on 10-20): 576300's ask
    # on the 10-20 branch dry run was prose. Structured silence, never a miss.
    "aldarim": ("elevator", "parking", "kitchen", "air_conditioner", "maid_room", "driver_room", "furnished"),
    # superoffice prints each office's own services as `<ul class="service_ul">` («أثاث», «إنترنت عالي السرعه» …),
    # the list its scraper reads (scrapers/superoffice/run.py). Its 10-20 «misses» (parking 5 of 5, 0 of 4 findable)
    # were the description's marketing line «نحن نقدم: … مواقف السيارات», on offices whose list names no parking.
    # Read by superoffice_props().
    "superoffice": ("elevator", "parking", "kitchen", "air_conditioner", "furnished"),
    # erapulse's page embeds the listing's own `features` list and `elevator` flag (the API object its scraper
    # maps); the re-read ads carry «features":[]» and print «لا توجد مميزات متاحة». Its 10-20 «misses» (0 of 4)
    # asked kitchen / elevator from the free «تفاصيل العقار» prose (backlog 551). Read by erapulse_props().
    "erapulse": ("elevator", "parking", "kitchen", "air_conditioner", "maid_room", "driver_room", "furnished"),
    # maqrat's «خدمات العقار» chip row (`ap-ro-field-label`, scrapers/maqrat/run.py _SERVICES) expresses utilities and
    # «مصعد»: elevator is the one Advanced Filter field it publishes. Its 10-23 asks (13605174, 19039930) took
    # elevator from description prose («ومصعدين» in the building) on ads whose chips name none. The other fields
    # have no structured home there, so their prose stays a statement (backlog 790). Read by maqrat_props().
    "maqrat": ("elevator",),
}
# A rakez listing's page is its PROJECT's page: one shared feature list and every unit's price · rooms · area. A UNIT
# trait the project list names («غرفة خادمة», «غرفة سائق», «مواقف خاصة», «مطبخ») describes some of the project's units,
# not this one, so it is never stored per unit (scrapers/rakez/run.py project_answers, backlog 467). The page therefore
# cannot state it for this unit either: silent, never a miss. 10-19: the rakez maid_room asks (3 of 5 misses) were
# exactly this list. Building traits (lift, AC) stay scored: the scraper reads them from the same list.
PROJECT_PAGE_UNIT_TRAITS: dict[str, tuple[str, ...]] = {
    "rakez": ("maid_room", "driver_room", "parking", "kitchen", "private_entrance", "furnished"),
}
# A website whose listing_url is its SHARED list page, not the unit: safa has no standalone unit page (the unit is a
# popup sheet, scrapers/safa/run.py fetch_unit), and «/units/rental?page=1&property_id=N» serves the same first page
# of cards for every N (CI re-read 39228340160: 14146 and 13181 print the identical cards). Its «مفروشة بالكامل» chip
# belongs to another unit's card; all 4 safa misses on 10-19 asked furnished from it. Such a page is not this ad:
# unreadable, never counted as wrong.
SHARED_LIST_PAGE_SITES = {"safa"}
# WordPress «WP Residence» sites: the ticked checklist is the structured statement (wpresidence_props).
WP_RESIDENCE_SITES = {"eastabha"}
COL = {n: c for n, _, c, _ in FIELDS}
_YES = {"true", "1", "نعم", "يوجد", "متوفر"}
_NO = {"false", "0", "لا", "لا يوجد", "لايوجد", "غير متوفر"}


def structured_says(page: dict, field: str) -> bool | None:
    """What the page's OWN structured data states for one field: True / False / None (silent)."""
    kw = BOOL_KW[field]
    said: list[bool] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("additionalProperty", "amenityFeature") and isinstance(v, list):
                    for x in v:
                        if isinstance(x, dict) and x.get("name") is not None and re.search(kw, norm(str(x["name"]))):
                            val = norm(str(x.get("value"))).strip().lower()
                            if val in _YES:
                                said.append(True)
                            elif val in _NO:
                                said.append(False)
                elif isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(node, list):
            for x in node:
                walk(x)

    walk(page.get("jsonld") or [])
    return said[0] if said else None


def structured_result(stored, says: bool | None) -> str:
    if says is None:
        return PAGE_SILENT
    if stored is None:
        return WE_MISS
    return MATCH if bool(stored) == says else MISMATCH


# Number fields a website publishes under ONE structured label: only that label's line is the statement.
# dealapp's spec table prints «عدد الحمامات»; its «we miss» 5/10 on 2026-10-07 were all ad prose
# («3 دورات مياه») on ads whose table has no bathroom row (source-reread 37604551104).
STRUCTURED_LABEL: dict[tuple[str, str], str] = {("dealapp", "bathrooms"): r"عدد الحمامات"}


def labelled_number(stored, lines: list[str], label: str) -> str:
    """The label's own row states a figure (on its line, or as the bare next line); prose never does."""
    if stored is not None:
        return _cmp_number(stored, lines, "", label)
    hits = [i for i, x in enumerate(lines) if re.search(label, x)]
    states = any(re.search(r"\d", lines[i]) or (i + 1 < len(lines) and re.match(r"^\s*\d+\s*$", lines[i + 1]))
                 for i in hits)
    return WE_MISS if states else PAGE_SILENT


def structured_only(platform: str, results: dict[str, str], stored: dict, page: dict) -> dict[str, str]:
    out = dict(results)
    for (site, f), label in STRUCTURED_LABEL.items():
        if site == platform and f in out and out[f] != UNREADABLE:
            out[f] = labelled_number(stored.get(COL[f]), page_lines(page), label)
    for f in STRUCTURED_ONLY.get(platform, ()):
        if f in out and out[f] != UNREADABLE:
            out[f] = structured_result(stored.get(COL[f]), structured_says(page, f))
    for f in PROJECT_PAGE_UNIT_TRAITS.get(platform, ()):
        if f in out and out[f] != UNREADABLE:
            out[f] = PAGE_SILENT
    return out


# An EMPTY label («موقف السيارة :», «التكييف :») is printed on every tuba / ksaaqar page whatever the
# answer — the value sits elsewhere, or nowhere. A label is not a statement.
BARE_LABEL = re.compile(r"^[^:]{1,30}:$")


def page_lines(page: dict) -> list[str]:
    ls = [norm(x) for x in ([page.get("title") or ""] + list((page.get("meta") or {}).values())
                            + (page.get("evidence_lines") or []) + (page.get("text_head") or "").split(" | "))]
    return [x for x in ls if x and not CHROME.match(x) and not BARE_LABEL.match(x)]


# A line printed on EVERY sampled page of one website is that website's template, not any one ad: its
# menu («أجهزة مطبخ», «مكيفات هواء» on opensooq), a services strip («موقف سيارة» on superoffice), or
# feature art shared by all projects («موقف خاص» on hasaad, beside a district none of them is in).
# Measured 2026-10-06 (source-reread 37445697709): each produced a 5/5 «we miss» that no parser could
# fix. Applied only with TEMPLATE_MIN_PAGES readable pages, so two ads that happen to agree stay ads.
TEMPLATE_MIN_PAGES = 3


def template_lines(pages: list[list[str]]) -> set[str]:
    readable = [set(p) for p in pages if p]
    if len(readable) < TEMPLATE_MIN_PAGES:
        return set()
    return set.intersection(*readable)


# A deed's boundary text («… وتمام الحد المصعد وتمام الحد المنور …», «يحده شمالاً …») names what the unit's border
# touches, not what the ad offers: fursaghyr 3237533 was asked elevator from its licence boundary block on 10-20,
# 10-22 and 10-23 while its description names no lift (page read 2026-10-23).
DEED_BOUNDARY = re.compile(r"تمام\s*الحد|يحده|الحد\s*(?:الشمالي|الجنوبي|الشرقي|الغربي)")


def page_says_yes(lines: list[str], field: str) -> bool:
    """The ad itself names the amenity and does not negate it («مصعد» yes, «لا يوجد مصعد» no)."""
    kw = BOOL_KW[field]
    lines = [y for y in lines if not DEED_BOUNDARY.search(y)]
    hit = [x for x in (unprepared(y, kw) for y in lines) if re.search(kw, x)]
    return bool(hit) and not all(re.search(NEG + "(?:" + kw + ")", x) for x in hit)


def says_yes(lines: list[str], field: str, platform: str = "", page: dict | None = None) -> bool:
    """The ad states YES. For a field the website publishes structurally, only its structured data can
    say so (law §2) — the same reading structured_only() scored it by, so a request is never built
    from prose the score itself refused to believe."""
    if field in STRUCTURED_ONLY.get(platform, ()):
        return structured_says(page or {}, field) is True
    return page_says_yes(lines, field)


def customer_answers(lines: list[str], results: dict[str, str], platform: str = "",
                     page: dict | None = None) -> list[str]:
    """Advanced Filter answers the ad really states as YES: the ones a customer would ask for. Both a stored
    true (does the filter find it) and a stored NULL (the trapping failure) qualify; a stored false never
    does, the customer asking for it would be excluding the ad correctly or the ad disagrees (precision)."""
    cols = [c for c in (*AMENITY_SLUG, FURNISHED)
            if results.get(c) in (MATCH, WE_MISS) and says_yes(lines, c, platform, page)]
    return cols[:MAX_ANSWERS]


def offered(answers: list[str], stored: dict) -> list[str]:
    """Only answers a customer can actually give in this listing's scope. The Advanced Filter never asks
    «furnished» on a Monthly search (src/lib/afCohorts.ts: no RentMonthly cohort lists it), so a request
    carrying it is not a customer's request and its miss is not a customer's miss."""
    if stored.get("rent_period_ar") == MONTHLY:
        return [a for a in answers if a != FURNISHED]
    return answers


def rpc_params(stored: dict, answers: list[str]) -> dict | None:
    if not (stored.get("deal_ar") and stored.get("city_ar") and stored.get("type_ar")):
        return None
    p: dict = {"p_deal": stored["deal_ar"], "p_cities": [stored["city_ar"]], "p_types": [stored["type_ar"]],
               "p_limit": RPC_LIMIT, "p_offset": 0}
    if stored.get("district_ar"):
        p["p_districts"] = [stored["district_ar"]]
    if stored.get("deal_ar") in RENT and stored.get("rent_period_ar"):
        p["p_rent_period"] = stored["rent_period_ar"]
    slugs = [AMENITY_SLUG[a] for a in answers if a in AMENITY_SLUG]
    if slugs:
        p["p_amenities"] = slugs
    if FURNISHED in answers:
        p["p_furnished"] = True
    return p


def findable(rows: list[dict] | None, source_table: str, listing_id: int) -> bool | None:
    """True found / False not found / None undecided (no answer, or the row cap cut the list)."""
    if rows is None:
        return None
    if any(r.get("source_table") == source_table and int(r.get("listing_id")) == int(listing_id) for r in rows):
        return True
    return None if len(rows) >= RPC_LIMIT else False


# Keys under propertyDetailsV3 that can hold a person or a contact: never read (PDPL).
# «classification» = wasalt's PHOTO classifier («classificationName»: «kitchen», «bathroom» per image): a model's guess
# about a picture, not the advertiser's statement, so it never counts as the page saying the ad has one (🆕 2026-10-16).
_WASALT_SKIP = re.compile(r"agent|broker|owner|advertiser|user|phone|mobile|whats|email|contact|licen|classification|\bid$|_id$|uuid",
                          re.I)
# The REGA deed's border rows (regaVerifiedInfo … {"key": "borders.southLimitDescription", "value": «ممرات ودرج
# ومصعد ثم ارتداد 2 ثم قطعة رقم 29»}) say what the unit's boundary TOUCHES: a corridor, a neighbour's plot, the
# building's lift shaft. That is a legal boundary, not the ad stating what the unit has; all 4 wasalt misses on
# 2026-10-18 asked «elevator» from it while the seller's own description never names one (re-read 39114420405).
_WASALT_BORDER = re.compile(r"^borders\.", re.I)


# wasalt's structured attribute keys → the Arabic label the comparison's keywords read («م²», «غرف», «دورات المياه»).
WASALT_FIELD_LABELS = {
    "builtUpArea": "مساحة البناء م²", "propertyArea": "مساحة العقار م²", "plotArea": "مساحة الأرض م²",
    "noOfBedrooms": "عدد غرف النوم", "noOfBathrooms": "عدد دورات المياه",
}


def wasalt_page(url: str, fetch=None) -> dict | None:
    """A wasalt listing read like any other ad, through the browser path wasalt requires.

    cleanup._probe() answers a live wasalt page with (200, "") by design: liveness needs only the status,
    so the body is dropped — which made every wasalt page «unreadable» here (ops_af_score 2026-10-04 and
    10-05: 5/5 and 10/10). The page's own __NEXT_DATA__ (propertyDetailsV3) is the ad: its text values
    become the evidence lines our comparison reads. Contact/agent keys are skipped. None = unreadable."""
    if fetch is None:
        from scrapers.common.cleanup import _wasalt_browser, _wasalt_browser_enabled
        if not _wasalt_browser_enabled():
            return None
        fetch = _wasalt_browser().page_data
    try:
        data, status, _n = fetch(url)
    except Exception:  # noqa: BLE001 — a failed read is unknown, never wrong
        return None
    pd = (((data or {}).get("props") or {}).get("pageProps") or {}).get("propertyDetailsV3")
    if status != 200 or not isinstance(pd, dict):
        return None
    texts: list[str] = []

    def walk(node, key: str = "") -> None:
        if key and _WASALT_SKIP.search(key):
            return
        if isinstance(node, dict):
            if _WASALT_BORDER.search(str(node.get("key") or "")):
                return
            label = WASALT_FIELD_LABELS.get(str(node.get("key")))
            if label and isinstance(node.get("value"), (str, int, float)) and str(node["value"]).strip():
                # wasalt's own {key, value} row as ONE labelled line: split into loose leaves, «96» never sat next
                # to a size word while the REGA deed text («… من الأرض 51.52 متر») did, and 17926766's structured
                # builtUpArea 96 (= ours) scored a mismatch (🆕 2026-10-16, re-read run 38925580390).
                texts.append(f"{label} {node['value']}")
            for k, v in node.items():
                walk(v, str(k))
        elif isinstance(node, list):
            for x in node:
                walk(x, key)
        elif isinstance(node, str) and node.strip():
            texts.extend(x.strip() for x in node.splitlines() if x.strip())

    walk(pd)
    return {"title": next((t for t in texts if re.search(r"[ء-ي]", t)), None), "meta": {}, "jsonld": [],
            "evidence_lines": texts[:200], "text_head": " | ".join(texts)[:1500]}


def is_wasalt(url: str) -> bool:
    return "wasalt.sa" in url or "wasalt.com" in url


# sanadak's own structured statement per field, read from the listing object its page renders (the scraper's
# object EXTRACTOR is reused; its mapping is not). A value the object leaves blank says nothing.
#   kitchenStatusText «نعم - راكب» yes · «لا» no · «نعم - تأسيس فقط» (a prepared point) silent
#   acTypeText «… راكب» (split/central/window/duct installed) yes · «لا يوجد» no · «تأسيس سبليت» silent
#   numberElevators / numberMaidRooms / numberParkingAreas: a stated count, ≥1 yes, 0 no
#   isDriverRoomAvailable: true yes; false is an unticked box on every ad, so silent
#   isFurnished: present only when the advertiser answered — true yes, false no
SANADAK_NAMES = {"elevator": "مصعد", "parking": "موقف", "kitchen": "مطبخ", "air_conditioner": "مكيف",
                 "maid_room": "غرفة خادمة", "driver_room": "غرفة سائق", "furnished": "مفروش"}


def _count_says(v) -> bool | None:
    if isinstance(v, bool) or v in (None, ""):
        return None
    try:
        return int(float(v)) > 0
    except (TypeError, ValueError):
        return None


def sanadak_says(o: dict) -> dict[str, bool]:
    k = str(o.get("kitchenStatusText") or "").strip()
    ac = str(o.get("acTypeText") or "").strip()
    said = {
        "kitchen": True if k.startswith("نعم") and "تأسيس" not in k else (False if k == "لا" else None),
        "air_conditioner": True if "راكب" in ac else (False if ac == "لا يوجد" else None),
        "elevator": _count_says(o.get("numberElevators")),
        "maid_room": _count_says(o.get("numberMaidRooms")),
        "parking": _count_says(o.get("numberParkingAreas")),
        "driver_room": True if o.get("isDriverRoomAvailable") is True else None,
        "furnished": o.get("isFurnished") if isinstance(o.get("isFurnished"), bool) else None,
    }
    return {f: v for f, v in said.items() if v is not None}


def sanadak_page(url: str, fetch=None) -> dict | None:
    """A sanadak ad read from its own listing object: the structured fields as JSON-LD-shaped
    additionalProperty rows (what structured_says() reads), the ad's text as evidence lines. None =
    unreadable (a failed fetch is never wrong)."""
    if fetch is None:
        from scrapers.sanadak.run import fetch_one as fetch
    try:
        got = fetch(url)
    except Exception:  # noqa: BLE001
        return None
    if not got:
        return None
    o = got[0] or {}
    props = [{"name": SANADAK_NAMES[f], "value": "نعم" if v else "لا"} for f, v in sanadak_says(o).items()]
    texts = [str(o.get(x)).strip() for x in ("title", "city", "district", "description", "propertyTypeText",
                                               "listingTypeText") if o.get(x)]
    lines = [y.strip() for t in texts for y in t.splitlines() if y.strip()]
    # The listing object's own structured counts, labelled the way its page prints them («مساحة العقار 105.6 م²»).
    # Without them only the description was read, and 17944027's «المساحة : 120م تقريبا» scored our structured
    # 105 (lotSize 105.6) wrong (🆕 2026-10-16, re-read run 38927458882).
    for label, key in (("مساحة العقار م²", "lotSize"), ("عدد غرف النوم", "numberBedrooms"),
                       ("عدد دورات المياه", "numberBathrooms")):
        v = o.get(key)
        if isinstance(v, (int, float, str)) and not isinstance(v, bool) and str(v).strip():
            lines.insert(0, f"{label} {v}")
    return {"title": o.get("title"), "meta": {}, "jsonld": [{"additionalProperty": props}],
            "evidence_lines": lines[:200], "text_head": " | ".join(lines)[:1500]}


# A website whose every page carries a category MENU of internal links («أجهزة مطبخ», «مكيفات هواء» on opensooq):
# the menu is not the ad, and the reader's line cut-off truncates it differently per page, so template_lines()
# cannot see it as shared (CI source-reread 38543714404: every «مطبخ» on 13605230 / 13605245 was a menu link;
# opensooq scored 0 of 5 with kitchen and AC «missed» 5 of 5 — backlog 76 / 129). On these sites the text of an
# internal link is dropped before the page is read.
NAV_LINK_SITES = {"opensooq"}
_NAV_LINK = re.compile(r'<a\b[^>]*href="/[^"]*"[^>]*>([^<]{1,60})</a>')


def strip_nav(page: dict, body: str) -> dict:
    nav = {norm(t) for t in _NAV_LINK.findall(body or "") if t.strip()}
    if not nav:
        return page
    keep = [x for x in (page.get("evidence_lines") or []) if norm(x) not in nav]
    head = " | ".join(x for x in (page.get("text_head") or "").split(" | ") if norm(x) not in nav)
    return {**page, "evidence_lines": keep, "text_head": head}


# gathern's own amenity list, from the page's __NEXT_DATA__ (serverData.data.extraDescription[*].content): a listed
# label is a yes, an unlisted one is silence (scrapers/gathern/run.py _amenity_flags, never «no»).
GATHERN_LABELS = {"elevator": "مصعد", "parking": "موقف سيارة"}


def gathern_props(body: str) -> list[dict]:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body or "", re.S)
    try:
        data = json.loads(m.group(1))["props"]["pageProps"]["serverData"]["data"] if m else {}
    except (ValueError, KeyError, TypeError):
        return []
    labels = {str(c).strip() for blk in (data.get("extraDescription") or []) if isinstance(blk, dict)
              for c in (blk.get("content") or [])}
    return [{"name": SANADAK_NAMES[f], "value": "نعم"} for f, lab in GATHERN_LABELS.items() if lab in labels]


# A WP Residence checklist item, ticked or not (`not_present`). Only a ticked one is a statement; an unticked
# item is the theme printing its whole taxonomy, which is silence, never «no» (law §1).
_WPR_ITEM = re.compile(r'<div class="listing_detail( not_present)? col-md-\d[^"]*">\s*(?:<i[^>]*>\s*</i>)?\s*([^<]{1,60}?)\s*</div>')


def wpresidence_props(body: str) -> list[dict]:
    return [{"name": html.unescape(label), "value": "نعم"}
            for absent, label in _WPR_ITEM.findall(body or "") if not absent]


# rakez prints the developer's WARRANTY block on a project page: «10 سنوات · الهيكل الإنشائي», «20 سنوات · المصاعد»,
# «5 سنوات · التكييف» (CI re-read 39228336072, projects 15002 and 65739). A guarantee period is not the ad stating
# that the unit has a lift or fitted air conditioning, and it is ambiguous on its face (law §6: ambiguous → NULL).
# All 5 rakez misses on 10-19 asked air_conditioner from this heading. The headings are dropped from the evidence.
WARRANTY_SITES = {"rakez"}
_WARRANTY_HEADING = re.compile(r'<span[^>]*>\s*\d+\s*</span>\s*<span[^>]*>\s*(?:سنوات|سنة|سنه)\s*</span>\s*</div>\s*'
                               r'<h3[^>]*>\s*([^<]{1,40}?)\s*</h3>')


# A spec term about the building's COMMON areas is not the unit: «ممرات مكيفة» (air-conditioned corridors) is not
# fitted AC in the flat. The scraper never stores it (scrapers/rakez/run.py _COMMON_AREA, 54 rows reverted on
# 10-18); the 10-19 branch dry run's last rakez miss (11750314) asked air_conditioner from exactly that term. The
# same rule is imported, so the score and the scraper cannot disagree about what a common area is.
def _rakez_common_area():
    from scrapers.rakez.run import _COMMON_AREA
    return _COMMON_AREA


def strip_warranty(page: dict, body: str) -> dict:
    heads = {norm(html.unescape(t)) for t in _WARRANTY_HEADING.findall(body or "") if t.strip()}
    common = _rakez_common_area()

    def is_heading(x: str) -> bool:
        # the evidence builder glues a short value onto the line before it («مكينة مصعد 10»), so a heading followed
        # by nothing but a number is still the heading (11748121 / 11748137, branch dry run 39233528007)
        nx = norm(x)
        return any(nx == h or (nx.startswith(h + " ") and re.fullmatch(r"[\d\s]+", nx[len(h):])) for h in heads)

    def keep_line(x: str) -> bool:
        return not is_heading(x) and not common.search(x)

    keep = [x for x in (page.get("evidence_lines") or []) if keep_line(x)]
    head = " | ".join(x for x in (page.get("text_head") or "").split(" | ") if keep_line(x))
    return {**page, "evidence_lines": keep, "text_head": head}


# muktamel's taxonomy label → our field, exactly as its scraper maps the feature ids. A label is read only on an
# exact match (a rooms entry «غرفة سائق مع حمام» or «مدخل سيارة» is a different item, never a guess).
MUKTAMEL_LABELS = {"مصعد": "elevator", "مواقف خاصة": "parking", "مطبخ مجهز": "kitchen", "تكييف": "air_conditioner",
                   "غرفة خادمة": "maid_room", "غرفة سائق": "driver_room", "مدخل مستقل": "private_entrance",
                   "مفروشة": "furnished"}
# The name structured_says() reads for each field (BOOL_KW), so a ticked item scores as the page's YES.
_PROP_NAME = {**SANADAK_NAMES, "private_entrance": "مدخل خاص"}
_MUK_FEATURES = re.compile(r'<ul class="features-list[^"]*"[^>]*>(.*?)</ul>', re.S)
_MUK_ITEM = re.compile(r"<li[^>]*>([^<]{1,60})</li>")


def muktamel_props(body: str) -> list[dict]:
    """The ticked items of muktamel's own feature list: a listed item is a yes, an unlisted one is silence."""
    ticked = {html.unescape(x).strip() for block in _MUK_FEATURES.findall(body or "") for x in _MUK_ITEM.findall(block)}
    return [{"name": _PROP_NAME[f], "value": "نعم"} for lab, f in MUKTAMEL_LABELS.items() if lab in ticked]


# The Nuzul SaaS prints the ad's counts as escaped JSON in its RSC payload: «\\"kitchens\\":1». The same key also
# appears once in the label dictionary with a STRING value («\\"kitchens\\":\\"Kitchen\\"»), which is never read.
# A count ≥ 1 is a yes, 0 is silence (the scraper's own rule); two different counts for one key cannot be
# attributed to this ad and say nothing.
NUZUL_COUNTS = {"kitchens": "kitchen", "elevators": "elevator", "parking_spots": "parking", "maid_rooms": "maid_room",
                "driver_rooms": "driver_room", "is_ac_installed": "air_conditioner", "is_furnished": "furnished"}


def nuzul_props(body: str) -> list[dict]:
    out = []
    for key, f in NUZUL_COUNTS.items():
        vals = set(re.findall(r'\\"' + key + r'\\":(\d+)', body or ""))
        if len(vals) == 1 and int(vals.pop()) >= 1:
            out.append({"name": _PROP_NAME[f], "value": "نعم"})
    return out


def is_nuzul(url: str) -> bool:
    return "aldarim.sa" in url


_SO_SERVICES = re.compile(r'<ul class="service_ul">(.*?)</ul>', re.S)
_SO_ITEM = re.compile(r"<li>(.*?)</li>", re.S)


def superoffice_props(body: str) -> list[dict]:
    """The office's own service list, read item by item exactly as its scraper does («أثاث» is furnished)."""
    items = [re.sub(r"<[^>]+>|\s+", " ", html.unescape(x)).strip()
             for block in _SO_SERVICES.findall(body or "") for x in _SO_ITEM.findall(block)]
    said = {c for x in items for c, v in amenities_from_text(x).items() if v is True}
    if "أثاث" in items:
        said.add("furnished")
    return [{"name": _PROP_NAME[f], "value": "نعم"} for f in _PROP_NAME if f in said]


def erapulse_props(body: str) -> list[dict]:
    """erapulse's embedded listing object: its `features` names and its `elevator` flag. A value that is not
    exactly one per page cannot be attributed to this ad and says nothing."""
    said: set[str] = set()
    feats = set(re.findall(r'"features":(\[[^\]]*\])', body or ""))
    if len(feats) == 1:
        try:
            names = [x if isinstance(x, str) else (x.get("nameAr") or x.get("name") or "")
                     for x in json.loads(feats.pop()) if isinstance(x, (str, dict))]
        except ValueError:
            names = []
        said |= {c for x in names for c, v in amenities_from_text(x).items() if v is True}
    lift = set(re.findall(r'"elevator":(true|false)', body or ""))
    if lift == {"true"}:
        said.add("elevator")
    return [{"name": _PROP_NAME[f], "value": "نعم"} for f in _PROP_NAME if f in said]


_MQ_CHIPS = re.compile(r'class="ap-ro-field-label">خدمات العقار</span>\s*<div class="pd-chip-row">(.*?)</div>', re.S)


def maqrat_props(body: str) -> list[dict]:
    """maqrat's own «خدمات العقار» chips, read as its scraper reads them: «مصعد» listed is a yes, else silence."""
    chips = {re.sub(r"\s+", " ", html.unescape(x)).strip()
             for block in _MQ_CHIPS.findall(body or "") for x in re.findall(r'class="pd-chip">(.*?)</span>', block)}
    return [{"name": _PROP_NAME["elevator"], "value": "نعم"}] if "مصعد" in chips else []


SITE_PROPS = {"superoffice": superoffice_props, "erapulse": erapulse_props, "maqrat": maqrat_props}


def is_muktamel(url: str) -> bool:
    return "muktamel.com" in url


def is_gathern(url: str) -> bool:
    return "gathern.co" in url


def is_sanadak(url: str) -> bool:
    return "sanadak.sa" in url


def anon_client():
    """The customer's path: the public anon key, never the service key (trap 10)."""
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") or ""
    if not key:
        return None
    # Secret handshake (docs/ops/SCRAPE_GUARD.md): still the customer's anon path, plus x-ezhalah-gate so this check keeps
    # working once the database refuses the bare public key. Sent only to our own database.
    gate = os.environ.get("EZ_GATE_SECRET") or ""
    if gate:
        try:
            from supabase.lib.client_options import SyncClientOptions as _Options
        except ImportError:  # older supabase-py
            from supabase.lib.client_options import ClientOptions as _Options
        return create_client(url, key, options=_Options(headers={"x-ezhalah-gate": gate}))
    return create_client(url, key)


def ask(anon, params: dict) -> list[dict] | None:
    try:
        return anon.rpc("location_search_candidates_ar", params).execute().data or []
    except Exception:  # noqa: BLE001 — a failed request says nothing about the listing
        return None


# The option count the screen prints for each amenity chip (apartment_guided_counts_ar), by anon slug.
COUNT_COL = {"elevator": "cnt_elevator", "parking": "cnt_parking", "kitchen": "cnt_kitchen", "ac": "cnt_ac",
             "maid_room": "cnt_maid_room", "driver_room": "cnt_driver_room",
             "private_entrance": "cnt_private_entrance"}


def parity(anon, params: dict) -> bool | None:
    """Rulebook number 4: the count promised on an option == the results after the tap. None = not decided
    (not a one-amenity request, or either read failed — a failed fetch is never a pass or a fail)."""
    slugs = params.get("p_amenities") or []
    if len(slugs) != 1 or params.get("p_furnished") is not None or slugs[0] not in COUNT_COL:
        return None
    base = {k: v for k, v in params.items() if k not in ("p_amenities", "p_limit", "p_offset")}
    try:
        rows = anon.rpc("apartment_guided_counts_ar", base).execute().data
        after = anon.rpc("af_eligible_count", {**base, "p_amenities": slugs}).execute().data
    except Exception:  # noqa: BLE001
        return None
    promised = (rows[0] if isinstance(rows, list) and rows else {}).get(COUNT_COL[slugs[0]])
    if promised is None or isinstance(after, (list, dict)) or after is None:
        return None
    return int(promised) == int(after)


def new_row(night: str, platform: str, **kw) -> dict:
    row = empty_row(night, platform, find_tried=0, find_found=0, find_missed_ids=[], parity_tried=0,
                    parity_ok=0, **kw)
    return row


def _all(q) -> list[dict]:
    out: list[dict] = []
    lo = 0
    while True:
        rows = q.range(lo, lo + PAGE - 1).execute().data or []
        out += rows
        if len(rows) < PAGE:
            return out
        lo += PAGE


def older_listings(client, hours: int = MIN_AGE_H) -> dict[str, list[tuple[str, int]]]:
    before = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    out: dict[str, list[tuple[str, int]]] = defaultdict(list)
    # one platform at a time keeps each answer small
    for p in sorted({r["platform"] for r in _all(client.table("ops_platform_liveness_coverage").select("platform"))}):
        q = (client.table("search_listings_ar").select("source_table,listing_id", count="exact")
             .eq("platform", p).eq("production_ready", True).lt("first_seen_at", before))
        n = q.limit(1).execute().count or 0
        # PostgREST returns at most PAGE rows: read one page from a random offset so the sample is not
        # biased toward the lowest ids on a big website.
        lo = random.randrange(max(1, n - PAGE + 1)) if n > PAGE else 0
        rows = q.order("listing_id").range(lo, lo + PAGE - 1).execute().data or []
        out[p] = [(r["source_table"], int(r["listing_id"])) for r in rows]
    return {p: v for p, v in out.items() if v}


def sample_size(n: int, per_site: int | None) -> int:
    if per_site:
        return min(per_site, n)
    return N_BIG if n >= BIG_SITE else min(N_SMALL, n)


def score_site(client, anon, platform: str, picks: list[tuple[str, int]], *, night: str,
               pace: float = PACE_S, probe=None, wasalt=wasalt_page, sanadak=sanadak_page) -> dict:
    probe = probe or _probe
    row = new_row(night, platform)
    last = 0.0
    read: list[tuple[str, int, dict, dict]] = []
    for table, rid in picks:
        stored = (client.table("search_listings_ar").select(STORED).eq("source_table", table)
                  .eq("listing_id", rid).limit(1).execute().data or [{}])[0]
        url = (client.table(table).select("listing_url").eq("id", rid).limit(1).execute().data or [{}])[0].get("listing_url")
        if not url:
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        if platform in SHARED_LIST_PAGE_SITES:
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        time.sleep(max(0.0, last + pace - time.monotonic()))
        last = time.monotonic()
        if is_wasalt(url) and wasalt is not None:
            page = wasalt(url)
        elif is_sanadak(url) and sanadak is not None:
            page = sanadak(url)
        else:
            try:
                status, body = probe(url)
            except Exception:  # noqa: BLE001
                status, body = None, ""
            page = page_evidence(body) if status == 200 and body else None
            if page is not None and platform in NAV_LINK_SITES:
                page = strip_nav(page, body)
            if page is not None and platform in WARRANTY_SITES:
                page = strip_warranty(page, body)
            if page is not None and platform in WP_RESIDENCE_SITES:
                page = {**page, "jsonld": list(page.get("jsonld") or []) + [{"additionalProperty": wpresidence_props(body)}]}
            if page is not None and is_muktamel(url):
                page = {**page, "jsonld": list(page.get("jsonld") or []) + [{"additionalProperty": muktamel_props(body)}]}
            if page is not None and platform in SITE_PROPS:
                page = {**page, "jsonld": list(page.get("jsonld") or []) + [{"additionalProperty": SITE_PROPS[platform](body)}]}
            if page is not None and is_nuzul(url):
                page = {**page, "jsonld": list(page.get("jsonld") or []) + [{"additionalProperty": nuzul_props(body)}]}
            if page is not None and is_gathern(url):
                page = {**page, "jsonld": list(page.get("jsonld") or []) + [{"additionalProperty": gathern_props(body)}]}
        if page is None:
            row["sampled"] += 1
            row["unreadable_pages"] += 1
            continue
        read.append((table, rid, stored, page))
    # Second pass: the website's template is known only once every page of the sample has been read.
    chrome = template_lines([page_lines(pg) for _, _, _, pg in read])
    for table, rid, stored, page in read:
        key = f"{table}:{rid}"
        results = compare_listing(stored, page, skip_price=False)
        af_only = structured_only(platform, {k: v for k, v in results.items() if k in AF_FIELDS}, stored, page)
        fold(row, key, af_only, stored)
        ad_lines = [x for x in page_lines(page) if x not in chrome]
        answers = offered(customer_answers(ad_lines, af_only, platform, page), stored)
        params = rpc_params(stored, answers) if anon is not None and answers else None
        if params:
            verdict = findable(ask(anon, params), table, rid)
            if verdict is not None:
                row["find_tried"] += 1
                if verdict:
                    row["find_found"] += 1
                else:
                    row["find_missed_ids"].append(key)
                    # What the customer asked for, so a miss names its field in the run log (keys only, no PII).
                    print(f"  miss {key} asked {answers}", flush=True)
            same = parity(anon, params)
            if same is not None:
                row["parity_tried"] += 1
                row["parity_ok"] += int(same)
    if row["unreadable_pages"]:
        row["note"] = f"{row['unreadable_pages']} page(s) unreadable (never counted as wrong)"
    return row


def findability(row: dict) -> float | None:
    return row["find_found"] / row["find_tried"] if row["find_tried"] else None


def _pct(v: float | None) -> str:
    return "n/a" if v is None else f"{100 * v:.1f}%"


def _line(r: dict) -> str:
    return (f"{r['platform']}: sampled={r['sampled']} findability={_pct(findability(r))} "
            f"({r['find_found']}/{r['find_tried']}) precision={_pct(af_precision(r))} "
            f"capture={_pct(af_recall(r))} parity={r.get('parity_ok', 0)}/{r.get('parity_tried', 0)} "
            f"misses={len(r['find_missed_ids'])}"
            + (f" | {r['note']}" if r["note"] else ""))


def write_rows(client, rows: list[dict]) -> str:
    payload = [{
        "night": r["night"], "platform": r["platform"], "sampled": r["sampled"], "fields": r["fields"],
        "find_tried": r["find_tried"], "find_found": r["find_found"],
        "af_claimed": r["af_claimed"], "af_agree": r["af_agree"],
        "af_page_states": r["af_page_states"], "af_captured": r["af_captured"],
        "mismatch_ids": r["mismatch_ids"], "find_missed_ids": r["find_missed_ids"], "note": r["note"],
        "parity_tried": r.get("parity_tried") or None, "parity_ok": r.get("parity_ok") if r.get("parity_tried") else None,
    } for r in rows]
    try:
        client.table(TABLE).upsert(payload, on_conflict="night,platform").execute()
    except Exception as e:  # noqa: BLE001
        text = str(e)
        if TABLE in text and ("PGRST205" in text or "42P01" in text or "not find" in text):
            return f"{TABLE} does not exist yet: rows printed only"
        raise
    return f"wrote {len(rows)} rows to {TABLE}"


def fleet_totals(rows: list[dict]) -> dict:
    t = lambda k: sum(r[k] for r in rows)  # noqa: E731
    r_ = lambda a, b: (a / b) if b else None  # noqa: E731
    return {"findability": r_(t("find_found"), t("find_tried")), "precision": r_(t("af_agree"), t("af_claimed")),
            "capture": r_(t("af_captured"), t("af_page_states")), "find_tried": t("find_tried"),
            "find_found": t("find_found"), "sampled": t("sampled"),
            "parity_tried": sum(r.get("parity_tried") or 0 for r in rows),
            "parity_ok": sum(r.get("parity_ok") or 0 for r in rows)}


def main() -> int:
    ap = argparse.ArgumentParser(description="Advanced Filter score: the nightly measurement")
    ap.add_argument("--sites", nargs="*")
    ap.add_argument("--per-site", type=int, default=None)
    ap.add_argument("--pace", type=float, default=PACE_S)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    client, anon = sb(), anon_client()
    if anon is None:
        print("WARNING: no SUPABASE_ANON_KEY — findability NOT measured tonight (precision/capture still are)")
    rng = random.Random(a.seed)
    night = datetime.now(timezone.utc).date().isoformat()
    older = older_listings(client)
    rows: list[dict] = []
    for p in a.sites or sorted(older):
        picks = older.get(p) or []
        if not picks:
            rows.append(new_row(night, p, note="no older production-ready listings"))
            continue
        try:
            row = score_site(client, anon, p, rng.sample(picks, sample_size(len(picks), a.per_site)),
                             night=night, pace=a.pace)
        except Exception as e:  # noqa: BLE001 — one website failing never stops the fleet
            row = new_row(night, p, note=f"error: {type(e).__name__}: {e}"[:300])
        rows.append(row)
        print(_line(row), flush=True)
        # WRITE AS YOU GO (🔬 2026-10-11): the 08:00 run of 2026-10-11 hit the job's 60-minute timeout after
        # ~140 websites and was cancelled before the single write at the end, so the night had NO score rows.
        # Each website's row is upserted the moment it is scored (night+platform, idempotent); the final write
        # below re-sends them all. A failed incremental write is retried by that final write, never fatal here.
        if not a.dry_run:
            try:
                write_rows(client, [row])
            except Exception as e:  # noqa: BLE001
                print(f"  ! incremental write failed for {p}: {type(e).__name__}: {e}"[:300], flush=True)
    try:
        from scrapers.common.cleanup import _close_wasalt_browser
        _close_wasalt_browser()
    except Exception:  # noqa: BLE001 — closing a browser that never opened is not an error
        pass
    out = {"night": night, "fleet": fleet_totals(rows), "sites": rows,
           "written": "dry run: nothing written" if a.dry_run else write_rows(client, rows)}
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
    else:
        f = out["fleet"]
        print(f"fleet: findability={_pct(f['findability'])} ({f['find_found']}/{f['find_tried']}) "
              f"precision={_pct(f['precision'])} capture={_pct(f['capture'])} "
              f"parity={f['parity_ok']}/{f['parity_tried']}")
        print(out["written"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
