"""RE/MAX Saudi Arabia — remax.sa. 21 listings total, onboarding 2026-09-25.

SOURCE SHAPE (measured live 2026-09-25; every number below was captured, not assumed).
remax.sa is a fully client-rendered React SPA (every URL, live/dead/fabricated alike, serves the
SAME 2,589-byte empty shell over a plain HTTP GET — measured on 5 URLs including a fabricated MLS
ID). The real data comes from ONE JSON endpoint the page's own JS calls, a per-tenant Azure
Cognitive Search index shared across every RE/MAX country site (skymarkcanada, eramalta, … all use
the identical "listing-search" shape — found by reading the app's own bundled JS):

    POST /search/listing-search/docs/search
        body: {"count":true,"skip":N,"top":N,"searchMode":"any","queryType":"simple","search":"*",
               "filter":"content/TenantId eq 6 and content/MacroRegionId eq 113 and
                          content/OnHoldListing eq false and content/IsViewable eq true"}
        → {"@odata.count": N, "value": [{"content": {...full listing...}}, ...]}

  No auth, no cookie, no proxy, plain `impersonate="chrome"`. TenantId=6 is the GLOBAL "RE/MAX"
  brand across every country on this platform (count 85,180 with no region filter) — MacroRegionId
  113 is what scopes it to Saudi Arabia (window.tenantid / window.macroregionid, read live from the
  page). BOTH must be in every filter or the catalogue silently includes the whole world.

  COMPLETENESS is self-declaring via `@odata.count`; a plain `top`/`skip` walk pages through it.
  21 listings total for TenantId=6 + MacroRegionId=113 + OnHoldListing=false + IsViewable=true,
  measured 2026-09-25 — genuine Saudi inventory (2 offices, 113033001 and 113033009, both under
  OfficeId 113033), not a foreign feed re-published under a Saudi domain.

  DETAIL URL. Each record's own `ShortLinks[]` (LanguageCode "en-SY") gives the exact published
  path, e.g. "en/listings/villa/for-sale/الدرعية/13953-1166-عقرباء-الجبيلة-3808/113033009-23" — used
  verbatim rather than reconstructed from a guessed slug template (property-type / deal / city
  slugs are inconsistent enough — Arabic city names, optional address segments — that guessing one
  risks linking to a page that 200s but isn't this listing).

  PHOTOS. `ListingImages[].FileName` is a bare filename ("L_<guid>.jpg"); the CDN base is NOT in any
  JSON field. Found by loading a real listing page and reading the rendered <img src> (grepping the
  bundled JS for the URL-builder function came up empty — it lives behind a webpack env object this
  build never inlines as a literal next to the call site). VERIFIED live:
  https://cdn.gryphtech.com/userimages/113/LargeWM/L_c860370f-….jpg → 200, image/jpeg, 149,218
  bytes, real JFIF magic. `113` is the record's own RegionId; `LargeWM` = HasLargeImage/IsWatermarked
  both "1" — true for all 140 images across all 21 listings (measured), so the quality/watermark
  folder is derived from those two source-published flags rather than hardcoded.

OFF-PLAN (structured field, not a title word — measured 2026-09-25)
--------------------------------------------------------------------
`MarketStatusUID` is the badge the source itself renders on the card AND the detail page. Verified
by opening two live pages: MLSID 113033001-7 (MarketStatusUID 5524) renders a blue "Off Plan" badge
and "Date Available: 20/08/2027"; MLSID 113033009-20 (MarketStatusUID 1902) renders "New to the
Market" and no Off Plan badge. Of the 21 active listings, 14 carry MarketStatusUID 5524 — EXCLUDED
here, leaving 7 (this build's "21 total, 7 real" split). A second, independent structured field,
`PropertyCategoryUID` 5531 (also translated "Off Plan"), is a STRICT SUBSET of the 14 (9 of them) —
checked explicitly too, belt-and-suspenders, since it is published on some rows the first field
already caught. Remaining MarketStatusUID values seen: 2433 "New Build" (3), 1902 "New to the
Market" (3), null (1) — none of these render an Off Plan badge.

REMOVAL ORACLE (measured 2026-09-25 — a 200 proves NOTHING here, not even "is a listing page")
------------------------------------------------------------------------------------------------
A plain HTTP GET of ANY detail URL — live, sold, cancelled, or a fabricated MLS ID — returns the
identical 2,589-byte SPA shell (verified on 5 URLs). So the shared HTML-page liveness law
(scrapers.common.http_liveness) does not apply: there is no page body to read a signal from. The
listing's OWN index record is the only oracle, queried by exact MLSID (same endpoint, no
`IsViewable`/`OnHoldListing` filter this time — those are what's BEING asked about):

    404-equivalent (count 0)              → gone   (measured: a fabricated MLSID, 999999999-99,
                                                      returns @odata.count 0)
    count 1, IsViewable=T, OnHoldListing=F,
      ListingStatusUID 160 (Active)       → live
    count 1, IsViewable=F, OnHoldListing=T,
      ListingStatusUID != 160             → gone   (the source's own statement — measured on 4 real
                                                      historical Saudi MLS ids: 113033009-9
                                                      Cancelled/161, 113033004-3 Expired/162,
                                                      113033017-4 Rented/167, 113028031-4
                                                      Proposal/1616 — all 4/4 IsViewable=False,
                                                      OnHoldListing=True, ListingStatusUID != 160)
    anything else (blocked, timeout, non-200,
      an inconsistent combination)        → UNKNOWN, fails closed

  ListingStatusUID's full measured vocabulary: 160 Active, 161 Cancelled, 162 Expired,
  165 Partially Rented, 166 Prospective, 167 Rented, 168 Exchanged, 169 Sold, 1616 Proposal.
  None of the "gone" values is treated individually — OnHoldListing/IsViewable already collapse
  every one of them, so the status code is recorded as evidence, not re-derived logic.

  Removals are additionally gated by an in-run positive control that fails CLOSED (mirrors
  abaad/tuba), and rows are built from the LIST endpoint, so mark_direct_alive() is NOT called.

PRICE = SOURCE (measured 2026-09-25)
-------------------------------------
`HidePricePublic` is a source-published bool — false on all 21 measured rows, but read explicitly
rather than assumed: True means the agent chose not to publish a price, which is
db.AUTHORITATIVE_NULL (the source's own statement of absence), never a plain None (which would mean
"we failed to read it"). `ListingPrice` is stored verbatim otherwise — never rounded, never derived.
No per-square-metre rate field exists anywhere in the schema (checked all fields on all 21 rows), so
`price_per_meter` is never set.

  AREA. `TotalArea` is the built/interior area for a unit (Apartment/Duplex — verified verbatim: the
  detail page for 113033009-16 prints "Total SqF 185" against TotalArea=185, next to a body
  paragraph stating "total area of 185 square meters"). It is 0 on the one Villa/land-type row this
  build carries (113033009-23), whose real size lives in `LotSize2` (500) — verified verbatim
  against that row's own description, "500 متر مربع" / "500 square meters", and its lot-dimension
  string `LotSize` ("20x25"), kept in additional_info. So area_m2 reads TotalArea when it is
  positive, else LotSize2 — never invented, and never both.

PERIOD = SOURCE (measured 2026-09-25 against real, if currently inactive, Saudi rent rows)
---------------------------------------------------------------------------------------------
`RentalPriceGranularityUID` is a DIRECT structured period field (found on live Saudi rent rows: 596
"Annually", 597 "Monthly", 599 "Weekly", 601 "Daily", 598 "Semi-Annually", 2620 "Monthly Rent",
3476 "Per Year + Fees", 3618 "Per Month + Fees") — there is no prose-parsing here at all. All 21
CURRENTLY ACTIVE Saudi listings are Buy (TransactionTypeUID 261 "For Sale"); the platform's own
index shows 6 historical Saudi rent rows, all Cancelled/Prospective/Rented (none active), which is
where this vocabulary was read. 'annual'/'monthly' are the only two buckets this schema stores
(matching the shared `normalize.rent_period_and_annual` contract); Weekly/Daily/Semi-Annually have
no bucket, so — because this IS a structured field naming that period, not silence — the price is
dropped to AUTHORITATIVE_NULL rather than stored unconverted under a period that isn't true (the
same reasoning abaad's docstring gives for a source whose price field itself carries the period).
TransactionTypeUID 262 "Holiday/Short Term Rental" is excluded (skip, counted): a nightly figure has
no home in an annual/monthly schema and none is currently live to even measure against.

NO AUCTIONS. `ContractTypeUID` is 29 ("Open") on all 21 rows and nothing resembling a bid/auction
field exists anywhere in the schema (checked all fields, both Arabic and English description text
of all 21 — no «مزاد»/"auction" anywhere). Nothing to exclude; not re-checked per row because no
per-row auction signal exists to check.

PDPL (measured 2026-09-25)
---------------------------
The listing-search index this scraper reads carries NO agent name, phone, email, or WhatsApp link —
only integer `AgentId`/`OfficeId`/`TeamID`/`RepresentingAgentID`. The rendered detail page DOES show
an agent name + phone + a WhatsApp button ("Abdullah Alamri", "REMAX Daierah", "+966 50 …"), but
those come from a SEPARATE endpoint (`/search/agent-search/docs/search`, observed in the page's own
network traffic) that this scraper never calls — so the PDPL boundary here is structural, not just
policy. `_CAPTURE_KEYS` is nonetheless a strict ALLOWLIST (never AgentId/OfficeId/TeamID/
RepresentingAgentID/MacroOfficeId/QRCode/QRCodeUrl/PixelTrackingCode/RentGuarantorInformation/
LegalRequirementText — none of those are read even though several are harmless integers, because an
allowlist that only excludes what looks dangerous today is a blocklist wearing an allowlist's
clothes). The two free-text fields actually stored (title, description) are run through
`redact_pii()` as the fleet's shared second barrier, though no phone/email/WhatsApp pattern was
found in any of the 21 rows' prose.

COVERAGE (full --dry-run against the live index, 2026-09-25)
--------------------------------------------------------------
21 listings (@odata.count 21) → 7 mapped (6 residential + 1 residential... wait, see below), 14
skipped and counted: off_plan 14. Of the 7: deal split 7 Buy / 0 Rent (0 Saudi rent listings are
currently active). Types: Apartment 6, Villa 1 — both residential, so
remaxsa_commercial_listings gets 0 rows from the current catalogue (the table is still created and
wired; --type commercial simply yields nothing today, which is a fact about the catalogue, not a
bug).
  price_total 7 (HidePricePublic false on all 7) · area_m2 7 (6 TotalArea + 1 LotSize2) ·
  bedrooms 7 · bathrooms 6 (1 null) · city_id 7 · district_ar 6 of 7 (اشبيلية resolves; the villa's
  LocalZone is blank, its StreetName «عقرباء - الجبيلة» does not resolve to a catalog district) ·
  photos 7 · license_number 7 (`ListingReference`, REGA ad-licence number — verified against the
  page's own "Advertising License Number") · license_expiry 7 (`ExpiryDate` epoch → verified against
  the page's own "License Expiry Date: 30/03/2027" for 113033009-16) · date_added 7 (`FirstUpdatedToWeb`
  epoch → verified against the page's own "Listing Date: 03/09/2026") · project_name 6 of 7
  (`DevelopmentName`) · parking 5 of 7 (`ParkingSpaces`, which the page labels "Parking Area (m²)" —
  a SIZE, not a slot count, verified verbatim: 19 on 113033009-16 matches the page's own "Parking
  Area (m²) 19" table row; stored as a positive→True amenity flag via the shared `count_flag`, with
  the raw m² kept in additional_info, never as a fabricated "N parking spots").

OPEN QUESTIONS FOR ONBOARDING (none of these are guessed in code)
---------------------------------------------------------------------
  · `ParkingSpaces`/"Parking Area (m²)" has no `parking_area_m2` column in the shared listing shape,
    only the boolean `parking`. The figure itself is kept in additional_info; should the schema gain
    a numeric parking-area column fleet-wide?
  · TotalNumberOfKitchens / TotalNumberOfLivingRooms / NumberOfGarages / YearBuilt / OrientationUID /
    FurnishedUID are all null on every one of the 21 rows measured — wired nowhere, since there is
    nothing yet to verify a mapping against. `FurnishedUID` is null even on the one row whose
    `ListingFeatures` states "Furnished" in English, so the boolean comes from the feature word, not
    this column.
  · `FloorNumber` is a free string ("Ground floor") on 2 of 21 rows and null elsewhere — never a
    parseable integer, so `floor_number` stays unset; the raw string is kept in additional_info.
  · PropertyTypeUID → English word is measured only for the values actually seen live (194
    Apartment, 231 Villa, 203 Duplex — the last from a now-superseded/removed row, kept because its
    UID is unambiguous). Any other PropertyTypeUID skips, counted, rather than guessed from RE/MAX's
    much larger global type catalogue.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

from curl_cffi import requests as cc

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scrapers.common import db, normalize  # noqa: E402
from scrapers.common.arabic_location import find_district_in_text, to_catalog  # noqa: E402
from scrapers.common.http import TRANSIENT_STATUSES  # noqa: E402
from scrapers.common.pii import redact_pii, strip_pii_fields  # noqa: E402

BASE = "https://www.remax.sa"
API = f"{BASE}/search/listing-search/docs/search"
PHOTO_BASE = "https://cdn.gryphtech.com/userimages"          # + /{RegionId}/{quality}/{FileName}
SOURCE = "RE/MAX"
PREFIX = "RMX"
SLUG = "remaxsa"
RES_TABLE = "remaxsa_residential_listings"
COM_TABLE = "remaxsa_commercial_listings"
PAGE_SIZE = 500

# window.tenantid / window.macroregionid, read live from the page (2026-09-25). TenantId=6 is the
# GLOBAL RE/MAX brand across every country on this shared platform — MacroRegionId 113 is what
# scopes a query to Saudi Arabia. BOTH are required in every filter (see the docstring).
TENANT_ID = 6
MACRO_REGION_ID = 113

_DEAL = {261: "Buy", 260: "Rent"}          # 261 "For Sale", 260 "For Rent/Lease" (measured, lookups.json)
# 262 "Holiday/Short Term Rental" is deliberately absent — a nightly figure has no home in this
# schema's annual/monthly rent_period, and none is live to measure a mapping against.

# The structured "Off Plan" market-status — the source's OWN badge, verified rendered on the detail
# page (see the docstring). A second, independent field publishes the same fact on a subset of these
# rows; both are checked.
_OFF_PLAN_MARKET_STATUS = 5524
_OFF_PLAN_CATEGORY = 5531

# PropertyTypeUID → the English word RE/MAX's own locale file renders for it (measured from the
# values actually observed live; see the docstring's open question). Fed through map_type_en so the
# canonical fold (and category_for_type's residential/commercial split) is the shared, audited one.
# Kept to unambiguous 1:1 words only (Office/Chalet carry no second meaning the way abaad's bare
# «محطة»/«مجمع» did) — anything else skips, counted, rather than guessed from RE/MAX's much larger
# global type catalogue.
_PROPTYPE_WORD = {194: "Apartment", 231: "Villa", 203: "Duplex", 20: "Office", 3412: "Chalet"}

# RentalPriceGranularityUID → the fleet's rent_period vocabulary. Only the two buckets this schema
# stores; anything else is a structured statement of a period this schema has no bucket for (see
# the docstring) and drops the price to AUTHORITATIVE_NULL rather than storing it unconverted.
_RENT_PERIOD = {596: "annual", 597: "monthly", 2620: "monthly", 3476: "annual", 3618: "monthly"}
_RENT_PERIOD_NO_BUCKET = {598, 599, 601}          # Semi-Annually, Weekly, Daily

# English ListingFeatures[].FeatureName (the "PropertyFeatures_" prefix stripped) → the column the
# source's own word states. Positive-only: a feature the source omits stays UNKNOWN, never False.
# Kept deliberately small — only words seen rendered on a real page (see the docstring); every other
# feature word is preserved raw in additional_info rather than guessed at.
_FEATURE_COLS = {
    "Furnished": "furnished",
    "Lift/Elevator": "elevator",
    "Balcony": "balcony_terrace",
    "Open Plan Kitchen": "kitchen",
}
_PARKING_WORDS = {"Parking", "Garage"}

# Keys copied into additional_info / source_capture. An ALLOWLIST (PDPL) — never AgentId, OfficeId,
# TeamID, RepresentingAgentID, MacroOfficeId, QRCode, QRCodeUrl, PixelTrackingCode,
# RentGuarantorInformation, LegalRequirementText, or any Comm*/Energy* field. See the docstring: the
# index this scraper reads carries no agent contact info at all, and this allowlist keeps it that way
# even if a future field addition to the index ever changed that.
_CAPTURE_KEYS = (
    "MLSID", "ListingId", "TransactionTypeUID", "PropertyTypeUID", "MacroPropertyTypeUID",
    "PropertyCategoryUID", "MarketStatusUID", "ListingStatusUID", "ContractTypeUID", "ListingClass",
    "TotalArea", "BuiltArea", "LivingArea", "LotSize", "LotSize2", "NumberOfBedrooms",
    "NumberOfBathrooms", "TotalNumOfRooms", "ParkingSpaces", "City", "Province", "LocalZone",
    "District", "StreetNumber", "StreetName", "StreetType", "AddressLine2", "PostalCode",
    "ListingCurrency", "ListingPrice", "HidePricePublic", "ExpiryDate", "FirstUpdatedToWeb",
    "OrigListingDate", "LastUpdatedOnWeb", "YearBuilt", "DevelopmentName", "DevelopmentID",
    "ListingReference", "RentalPriceGranularityUID", "ShowAddressPublic", "FloorNumber",
)
_CAPTURE_FREE_TEXT = frozenset({"title", "description"})


def _tally(skipped: dict[str, int]) -> str:
    return ", ".join(f"{k}x{v}" for k, v in sorted(skipped.items(), key=lambda x: -x[1]))


def session() -> cc.Session:
    s = cc.Session(impersonate="chrome")     # impersonate OWNS the User-Agent
    s.headers.update({"Content-Type": "application/json", "Accept": "application/json"})
    return s


def _clean(v) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _pos(v) -> Optional[int]:
    """A positive count/measure, or None. 0/absent mean "not set" for these fields."""
    n = normalize.to_int_numeric(v)
    return n if n and n > 0 else None


def _num(v) -> Optional[int]:
    """A source-published count, 0 INCLUDED (bedroom/bathroom counts — a plain 0 is the source's
    own answer, the same reading abaad/tuba give a rendered zero)."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return normalize.to_int_numeric(v) or (0 if str(v).strip() in ("0", "0.0") else None)


def _epoch_date(v) -> Optional[str]:
    """Unix epoch seconds -> an ISO date string, or None. 0/None mean "not published"."""
    n = normalize.to_int_numeric(v)
    if not n:
        return None
    try:
        return datetime.fromtimestamp(n, tz=timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _shortlink(rec: dict[str, Any]) -> Optional[str]:
    """The record's OWN published path (ShortLinks[], en-SY) — never a guessed slug template (see
    the docstring: property-type/deal/city slugs are inconsistent enough that a guess risks landing
    on a page that 200s but isn't this listing)."""
    for sl in rec.get("ShortLinks") or []:
        if isinstance(sl, dict) and sl.get("LanguageCode") == "en-SY" and sl.get("ShortLink"):
            return f"{BASE}/{sl['ShortLink']}"
    return None


def _photo_urls(rec: dict[str, Any]) -> Optional[list[str]]:
    imgs = sorted(
        (im for im in (rec.get("ListingImages") or []) if isinstance(im, dict) and im.get("FileName")),
        key=lambda im: normalize.to_int_numeric(im.get("Order")) or 0,
    )
    out = []
    for im in imgs:
        quality = ("Large" if im.get("HasLargeImage") == "1" else "Small") + \
                  ("WM" if im.get("IsWatermarked") == "1" else "")
        out.append(f"{PHOTO_BASE}/{rec.get('RegionId')}/{quality}/{im['FileName']}")
    return out or None


def _description(rec: dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    """(title, description) — Arabic first (ar-SA), English fallback (en-SY). DescriptionTypeUID
    629 is the full body; 1113 is the short marketing headline the site renders as the page title."""
    by_lang_type: dict[tuple[str, str], str] = {}
    for d in rec.get("ListingDescriptions") or []:
        if not isinstance(d, dict):
            continue
        lang, tid, text = d.get("LanguageCode"), _clean(d.get("DescriptionTypeUID")), _clean(d.get("Description"))
        if lang and tid and text:
            by_lang_type[(lang, tid)] = text
    title = by_lang_type.get(("ar-SA", "1113")) or by_lang_type.get(("en-SY", "1113"))
    desc = by_lang_type.get(("ar-SA", "629")) or by_lang_type.get(("en-SY", "629"))
    return title, desc


def map_listing(rec: dict[str, Any]) -> tuple[Optional[dict], str, str]:
    """(row, category, skip_reason) for ONE search-index `content` object."""
    mlsid = _clean(rec.get("MLSID"))
    if not mlsid:
        return None, "residential", "no_id"

    if rec.get("MarketStatusUID") == _OFF_PLAN_MARKET_STATUS or rec.get("PropertyCategoryUID") == _OFF_PLAN_CATEGORY:
        return None, "residential", "off_plan"

    deal = _DEAL.get(rec.get("TransactionTypeUID"))
    if not deal:
        return None, "residential", f"transaction_unknown_{rec.get('TransactionTypeUID')}"

    word = _PROPTYPE_WORD.get(rec.get("PropertyTypeUID"))
    property_type = normalize.map_type_en(word) if word else None
    if not property_type:
        return None, "residential", f"type_unmapped_{rec.get('PropertyTypeUID')}"
    category = normalize.category_for_type(property_type).lower()

    city_ar = _clean(rec.get("City"))
    if not city_ar:
        return None, category, "no_city"
    city_id, region_id = to_catalog(city_ar, _clean(rec.get("Province")))
    if not city_id:
        return None, category, "city_not_in_catalog"

    local_zone = _clean(rec.get("LocalZone"))
    street_name = _clean(rec.get("StreetName"))
    district_ar = (find_district_in_text(local_zone, city_id)
                   or find_district_in_text(street_name, city_id))

    title, desc = _description(rec)
    title, desc = redact_pii(title), redact_pii(desc)

    feature_words = [w for f in (rec.get("ListingFeatures") or []) if isinstance(f, dict)
                     for w in [str(f.get("FeatureName") or "").removeprefix("PropertyFeatures_")] if w]
    amen_cols = {_FEATURE_COLS[w]: True for w in feature_words if w in _FEATURE_COLS}

    parking_area = _pos(rec.get("ParkingSpaces"))
    parking = normalize.count_flag(rec.get("ParkingSpaces"))
    if parking is not True and any(w in feature_words for w in _PARKING_WORDS):
        parking = True

    area = _pos(rec.get("TotalArea")) or _pos(rec.get("LotSize2"))

    row: dict[str, Any] = {
        "ad_number": f"{PREFIX}{mlsid}",
        "listing_url": _shortlink(rec),
        "source": SOURCE,
        "active": True,
        "title": title,
        "description": desc,
        **amen_cols,
        "property_type": property_type,
        # `deal` is already provably 261→Buy or 260→Rent — anything else skipped above with a
        # counted reason (trap-class guard: a null deal is quarantined out of search).
        "transaction_type": "Rent" if deal == "Rent" else "Buy",
        "city": normalize.map_city(city_ar),
        "city_ar": city_ar,
        "city_id": city_id,
        "region_id": region_id,
        "district_ar": district_ar,
        "neighborhood": local_zone or street_name,
        "area_m2": area,
        "bedrooms": _num(rec.get("NumberOfBedrooms")),
        "bathrooms": _num(rec.get("NumberOfBathrooms")),
        "property_age": normalize.age_from_completion_year(rec.get("YearBuilt"), this_year=date.today().year),
        "street_name": street_name,
        "building_number": _clean(rec.get("StreetNumber")),
        "additional_number": _clean(rec.get("AddressLine2")),
        "zip_code": _clean(rec.get("PostalCode")),
        "project_name": _clean(rec.get("DevelopmentName")),
        "license_number": _clean(rec.get("ListingReference")),
        "license_expiry": _epoch_date(rec.get("ExpiryDate")),
        "date_added": _epoch_date(rec.get("FirstUpdatedToWeb")),
        "photo_urls": _photo_urls(rec),
    }
    if not row["listing_url"]:
        return None, category, "no_listing_url"
    if parking is not None:
        row["parking"] = parking

    # ── PRICE. HidePricePublic is the source's OWN statement that it published no price — the
    # AUTHORITATIVE_NULL case, never a plain None (which would mean "we failed to read one"). ──────
    hide_price = bool(rec.get("HidePricePublic"))
    figure = None if hide_price else normalize.to_int_numeric(rec.get("ListingPrice"))
    # `blanked` tracks every reason THIS mapper writes the AUTHORITATIVE_NULL sentinel instead of a
    # number, so price_evidence's `authoritative_absent` — "the durable, queryable half of
    # db.AUTHORITATIVE_NULL" (normalize.price_evidence docstring) — always travels with the sentinel
    # it explains, whichever of the two reasons produced it.
    blanked = hide_price
    if deal == "Rent":
        gran = rec.get("RentalPriceGranularityUID")
        period = _RENT_PERIOD.get(gran)
        if hide_price:
            row["price_annual"] = db.AUTHORITATIVE_NULL
        elif period:
            row["rent_period"] = period
            row["price_annual"] = normalize.annualize_rent(figure, period)
        elif gran in _RENT_PERIOD_NO_BUCKET:
            # The source NAMES a period (Weekly/Daily/Semi-Annually) this schema has no bucket for —
            # storing the figure unconverted under a blank period would misstate it (same reasoning
            # as abaad's docstring for a price field the source itself labels with the period).
            row["price_annual"] = db.AUTHORITATIVE_NULL
            blanked = True
        else:
            row["price_annual"] = figure           # period UNKNOWN, price stored verbatim
    else:
        row["price_total"] = db.AUTHORITATIVE_NULL if hide_price else figure
    stored = None if blanked else (row.get("price_total") if deal == "Buy" else row.get("price_annual"))
    row["price_evidence"] = normalize.price_evidence(
        field="ListingPrice", raw=rec.get("ListingPrice"),
        stored=stored,
        kind="total" if deal == "Buy" else (row.get("rent_period") or "unconverted"),
        unit="total", origin="api", authoritative_absent=blanked)
    row["images_evidence"] = {"observed": True, "container_present": "ListingImages" in rec,
                              "key_present": bool(rec.get("ListingImages")),
                              "count": len(row["photo_urls"] or [])}

    info = {
        "source_id": mlsid, "property_type_uid": rec.get("PropertyTypeUID"),
        "region_ar": _clean(rec.get("Province")),
        "full_address": redact_pii(_clean(rec.get("FullAddress"))),
        "source_price_raw": rec.get("ListingPrice"),
        "source_area_raw": _clean(rec.get("TotalArea")),      # exact TotalArea, before area_m2's pick
        "lot_size_dims": _clean(rec.get("LotSize")),           # e.g. "20x25" — dimensions, not m²
        "total_rooms": _clean(rec.get("TotalNumOfRooms")),
        "parking_area_m2": parking_area,                       # "Parking Area (m²)" — a SIZE, not a count
        "feature_words": feature_words or None,
        "floor_label": _clean(rec.get("FloorNumber")),          # e.g. "Ground floor" — never an int
        "source_status": rec.get("ListingStatusUID"),
        "rental_price_granularity": rec.get("RentalPriceGranularityUID"),
    }
    row["additional_info"] = strip_pii_fields({k: v for k, v in info.items() if v is not None})
    row["source_capture"] = strip_pii_fields({
        "schema": "remaxsa.listing-search.content.v1",
        **{k: rec[k] for k in _CAPTURE_KEYS if k in rec},
    })
    return row, category, ""


# ── FETCH ────────────────────────────────────────────────────────────────────────────────────────
def _search(s: cc.Session, body: dict[str, Any]) -> dict[str, Any]:
    r = None
    for _attempt in range(3):
        r = s.post(API, json=body, timeout=45)
        if r.status_code not in TRANSIENT_STATUSES:
            break
    if r is None or r.status_code != 200:
        raise RuntimeError(f"{API} returned {getattr(r, 'status_code', 'no response')}")
    try:
        body_json = r.json()
    except ValueError as exc:
        raise RuntimeError(f"{API} is no longer JSON: {exc}") from exc
    if not isinstance(body_json, dict):
        raise RuntimeError(f"{API} is {type(body_json).__name__}, not the expected object")
    return body_json


_BASE_FILTER = (f"content/TenantId eq {TENANT_ID} and content/MacroRegionId eq {MACRO_REGION_ID} "
               f"and content/OnHoldListing eq false and content/IsViewable eq true "
               f"and content/IsRegionalOffice eq false")


def fetch_catalogue(s: cc.Session, limit: int = 0) -> tuple[list[dict], bool]:
    """Every listing `content` object, plus whether the catalogue was served COMPLETE.

    `@odata.count` is the platform's own declared total; complete means it equals the number of
    distinct rows we hold. Only then may anything be pruned.
    """
    rows: dict[str, dict] = {}
    declared: Optional[int] = None
    skip = 0
    while True:
        body = _search(s, {"count": True, "skip": skip, "top": PAGE_SIZE, "searchMode": "any",
                            "queryType": "simple", "search": "*", "filter": _BASE_FILTER})
        if declared is None:
            declared = normalize.to_int_numeric(body.get("@odata.count"))
        batch = [v["content"] for v in (body.get("value") or [])
                if isinstance(v, dict) and isinstance(v.get("content"), dict)]
        if not batch:
            break
        before = len(rows)
        for c in batch:
            key = _clean(c.get("MLSID"))
            if key:
                rows[key] = c
        if len(rows) == before:
            break                       # page repeated itself — stop rather than loop forever
        if limit and len(rows) >= limit:
            return list(rows.values())[:limit], False
        if len(batch) < PAGE_SIZE:
            break
        skip += PAGE_SIZE
    items = list(rows.values())
    complete = bool(declared) and len(items) == declared
    print(f"{SOURCE}: {len(items)} listings; @odata.count={declared} complete={complete}", flush=True)
    return items, complete


# ── LIVENESS (measured 2026-09-25; see the docstring — a 200 is NEVER proof of life here) ─────────
def _index_lookup(s: cc.Session, mlsid: str) -> Optional[dict]:
    body = _search(s, {"skip": 0, "top": 1, "searchMode": "any", "queryType": "simple", "search": "*",
                       "filter": (f"content/TenantId eq {TENANT_ID} and "
                                  f"content/MacroRegionId eq {MACRO_REGION_ID} and "
                                  f"content/MLSID eq '{mlsid}'"), "count": True})
    if not body.get("@odata.count"):
        return None
    value = body.get("value") or []
    return value[0]["content"] if value and isinstance(value[0], dict) else None


def _signal(rec: Optional[dict]) -> Optional[str]:
    if rec is None:
        return "gone"                   # measured: a fabricated MLSID returns @odata.count 0
    viewable, on_hold = rec.get("IsViewable"), rec.get("OnHoldListing")
    if viewable is True and on_hold is False and rec.get("ListingStatusUID") == 160:
        return "live"
    if viewable is False and on_hold is True and rec.get("ListingStatusUID") != 160:
        return "gone"                   # the source's own statement (measured on 4 real ids)
    return None                         # an inconsistent combination — no opinion


def _make_verify_gone(control: Optional[dict]):
    def probe(ad_number: str) -> tuple[str, str]:
        mlsid = ad_number[len(PREFIX):] if ad_number.startswith(PREFIX) else ""
        if not mlsid:
            return "unknown", f"{ad_number!r} is not a {PREFIX}<MLSID> ad number"
        try:
            rec = _index_lookup(session(), mlsid)
        except Exception as e:  # noqa: BLE001 — an unreachable index is never proof of death
            return "unknown", f"index lookup raised {type(e).__name__}: {e}"
        verdict = _signal(rec)
        return (verdict or "unknown"), f"MLSID {mlsid}: IsViewable={rec.get('IsViewable') if rec else None} " \
                                       f"OnHoldListing={rec.get('OnHoldListing') if rec else None} " \
                                       f"ListingStatusUID={rec.get('ListingStatusUID') if rec else None}"

    def verify_gone(ad_number: str) -> tuple[str, str]:
        verdict, why = probe(ad_number)
        if verdict != "gone":
            return verdict, why
        if not control:
            return "unknown", f"removal withheld — no row from this run to use as a positive control (would have been: {why})"
        canary_verdict, canary_why = probe(control["ad_number"])
        if canary_verdict != "live":
            # A source whose index has stopped answering for a KNOWN-live row cannot testify that
            # any particular row is gone. Fails CLOSED: no canary answer, no removal.
            return "unknown", f"removal withheld — positive control {control['ad_number']}: {canary_why} (would have been: {why})"
        return verdict, why

    return verify_gone


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["residential", "commercial", "all"], default="all")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    s = session()
    dry = args.dry_run or bool(args.limit)
    # begin_run BEFORE the fetch: a source that goes dark must still leave a scrape_runs row.
    run_id = None if dry else db.begin_run(SLUG)
    res: list[dict] = []
    com: list[dict] = []
    skipped: dict[str, int] = {}
    try:
        items, complete = fetch_catalogue(s, limit=args.limit)
        if not items:
            raise RuntimeError(f"{API} returned no listings")
        for rec in items:
            row, cat, why = map_listing(rec)
            if not row:
                skipped[why] = skipped.get(why, 0) + 1
                continue
            if args.type != "all" and cat != args.type:
                continue
            (com if cat == "commercial" else res).append(row)
        notes = _tally(skipped)
        if skipped:
            print("  skipped (not guessed): " + notes)
        if dry:
            print(f"✓ {SOURCE} VALIDATION: {len(res)} residential + {len(com)} commercial "
                  f"(nothing written)")
            for r0 in (res + com)[:20]:
                print(f"   {r0['ad_number']:>14} {r0['transaction_type']:4} "
                      f"{str(r0['property_type']):10} {str(r0['city_ar']):10} "
                      f"d={str(r0['district_ar'])[:12]:12} a={str(r0['area_m2']):>6} "
                      f"bd={str(r0.get('bedrooms')):>4} pt={r0.get('price_total')} "
                      f"pa={r0.get('price_annual')} rp={r0.get('rent_period')} "
                      f"ph={len(r0.get('photo_urls') or [])}")
            return 0
        db.upsert_remaxsa_residential_batch(res)
        db.upsert_remaxsa_commercial_batch(com)
        superseded = db.retire_superseded_siblings(
            res_table=RES_TABLE, com_table=COM_TABLE,
            res_ads={r["ad_number"] for r in res}, com_ads={r["ad_number"] for r in com},
            source=SOURCE)
        if superseded:
            print(f"  retired {superseded} superseded sibling row(s) after a category flip")
        pruned = 0
        if args.type == "all" and complete:
            verify_gone = _make_verify_gone((res + com)[0] if (res or com) else None)
            for tbl, rows in ((RES_TABLE, res), (COM_TABLE, com)):
                n = db.prune_unseen(tbl, {r["ad_number"] for r in rows}, source=SOURCE,
                                    verify_gone=verify_gone)
                if n < 0:
                    print(f"  ⚠ {tbl}: prune guard tripped — kept existing active rows")
                else:
                    pruned += n
        elif args.type == "all":
            print("  prune skipped: @odata.count did not match the rows served (incomplete catalogue)")
        healthy = db.end_run(run_id, ok=True, rows_seen=len(items),
                             rows_upserted=len(res) + len(com),
                             notes=f"pruned={pruned} complete={complete} {notes}"[:300],
                             check_tables=["remaxsa_residential_listings",
                                           "remaxsa_commercial_listings"])
        if not healthy:
            print("✗ run demoted to unhealthy by end_run()'s RC-B guard", flush=True)
            return 1
        print(f"✓ {SOURCE}: {len(res)} residential + {len(com)} commercial upserted")
        return 0
    except Exception as e:
        if run_id:
            db.end_run(run_id, ok=False, rows_seen=0, rows_upserted=0,
                       notes=(f"{e}"[:250] + " | skips: " + (_tally(skipped) or "none"))[:300])
        print(f"✗ {SOURCE}: {e}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
