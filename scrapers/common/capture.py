"""Every site keeps its COMPLETE source record (owner 2026-10-13: «store every extra info possible for new listings»).

A scraper maps the few fields we have columns for. Everything else the source published (a discount label,
a views count, a guest capacity, a «negotiable» flag, a facade, a deed note …) used to be dropped at that
step, and once dropped it cannot be recovered. This module closes that for every site with ONE line:

    from scrapers.common.capture import capture_source_items
    capture_source_items(globals())          # at the bottom of run.py, before the `if __name__` guard

It rebinds the site's mapping function (map_listing / map_units / …) so that the dict the scraper was handed
is kept, PDPL-clean, under `source_capture["source_item"]` of every row that function returns.

What it will NOT do:
  • change a single mapped column or the shape of what the mapper returns (rows, tuples and lists pass through);
  • keep contact data: keys naming an advertiser / broker / owner / agent / phone / whatsapp / email are dropped
    (pii.strip_pii_fields) and every free-text value is scrubbed (pii.redact_capture) — the same barrier
    db._ensure_capture applies a second time on the way into the database;
  • grow without bound: strings are cut at MAX_STR, the whole snapshot at MAX_BYTES (largest keys go first and are
    named in `_cut`), so a bad page cannot bloat a row;
  • guess: a value the source did not publish is simply absent; nothing is derived or filled in.

`source_capture` is PRIVATE (anon has no SELECT on it, 20260809 PDPL migration) and watched by mon_pii_in_private_capture.
"""
from __future__ import annotations

import functools
import inspect
import json
import math
import re
from datetime import date, datetime
from typing import Any, Callable

from scrapers.common.pii import redact_capture, redact_pii, strip_pii_fields

ITEM_SCHEMA = "item.v1"
MAX_STR = 2000        # one field; the listing's own text already lives in `description` and `source_text`
MAX_LIST = 200        # elements kept per list (photo lists are already stored in photo_urls)
MAX_DEPTH = 6
MAX_BYTES = 16000     # whole snapshot, serialised
MAP_FN_NAMES = ("map_listing", "map_listings", "map_units", "map_unit", "map_item", "map_marker", "map_compound")
_ROW_MARKERS = ("listing_url", "ad_number", "property_type")
# A dict argument that is a LOOKUP TABLE handed to the mapper (taxonomy ids, category sets, tenant config), not
# a source record. Only the FIRST dict argument is always a record; later ones count only when they are not these.
_NOT_A_RECORD = {"tax", "taxonomy", "terms", "media", "cats", "catalog", "tenant", "regions", "cities", "city_map",
                 "lookup", "cfg", "config", "ctx", "context", "maps", "mapping", "names", "labels"}


def _norm(key: Any) -> str:
    return "".join(ch for ch in str(key).lower() if ch.isalnum())


# ── WHICH KEYS ARE KEPT ──────────────────────────────────────────────────────────────────────────────────────
# A raw source record carries property FACTS and, beside them, people: advertiser/broker/owner names, national and
# commercial-register numbers, signed URLs, contact links («governmentData» hides wa.me inside a key/value pair).
# Dumping the record whole would break the PDPL rule «we never store broker/owner identity or any contact number»
# (the per-site PDPL tests failed on 19 sites the first time that was tried). So a field is kept only when its NAME
# says it is a property fact (_FACT_WORDS) or the site's reviewed `keep=` list names it, and never when it names a
# person or a credential (_NEVER_WORDS, checked first). Everything else is NOT stored, but its NAME is recorded under
# `unkept_keys`, so the gap between «what the source publishes» and «what we keep» is visible per site, field by field,
# and a reviewed key can be added to that site's `keep=`.
_NEVER_WORDS = (   # SUBSTRING match on the normalised key (over-blocking is the safe direction)
    "user", "creator", "createdby", "updatedby", "author", "company", "office", "agency", "agent", "broker", "advertis",
    "owner", "seller", "publisher", "member", "profile", "account", "employee", "contact", "responsible", "lead",
    "reservation", "national", "iqama", "identity", "passport", "commercialreg", "crnumber", "avatar", "logo",
    "signature", "signed", "token", "session", "cookie", "password", "secret", "whatsapp", "phone", "mobile", "email",
    "telegram", "badge", "name", "title", "description", "comment", "remark", "message", "html", "body", "url", "link",
    "href", "image", "photo", "picture", "thumb", "gallery", "video", "media", "slug", "device", "referr", "utm",
    "tracking", "government", "marketer", "person", "guarant", "sponsor", "landlord", "lessor", "lessee", "buyer", "client",
    "customer", "visitor", "applicant", "requester", "tenantname", "bidder", "heir",
    # the same classes as Arabic spec-table LABELS (a key may be «اسم المسوق»)
    "اسم", "مسوق", "معلن", "مالك", "مالكه", "وسيط", "شخص", "جوال", "هاتف", "واتس", "بريد", "موظف", "مسؤول", "مسئول",
    "تواصل", "اتصال", "صاحب", "وكيل", "سمسار", "هوية", "اقامة", "إقامة", "سجل", "ضامن", "كفيل", "بواسطة", "ناشر", "منشئ",
)
# TOKEN match (camelCase / snake / spaces split): a key is a property FACT when a token IS one of these words, or
# STARTS with one of the stems. Whole-token matching on purpose: substrings made «propertyId» look like a price.
_FACT_EXACT = frozenset((
    "age", "bed", "bath", "ac", "m2", "kind", "basis", "tag", "tags", "active", "archived", "draft", "sold", "building",
    "apartment", "villa", "ejari", "rize", "wafi", "floors", "advantages", "sqm", "lat", "lng", "lon", "zip", "tax", "vat", "pct", "plan",
    "per", "off", "min", "max", "use", "deal", "type", "area", "size", "view", "views", "rent", "sale", "year", "date",
    "time", "city", "land", "plot", "unit", "gas", "pool", "lift", "gym", "tank", "meter", "road", "side",
    "wall", "roof", "door", "deed", "block", "total", "count", "floor", "level", "fees", "fee", "cost", "paid", "due",
))
_FACT_STEMS = (
    "price", "amount", "discount", "offer", "deposit", "install", "currency", "negotiab", "visit", "space", "width",
    "length", "depth", "room", "bedroom", "bathroom", "kitchen", "hall", "majlis", "living", "stor", "built",
    "construct", "facade", "front", "direction", "orient", "street", "corner", "furnish", "parking", "garage",
    "elevator", "garden", "balcon", "terrace", "cooling", "heating", "water", "electric", "sewage", "sanitation",
    "fiber", "internet", "maid", "driver", "entrance", "status", "availab", "condition", "finish", "categor",
    "purpose", "usage", "zoning", "class", "coord", "postal", "parcel", "district", "neighbo", "region", "province",
    "creat", "update", "modif", "publish", "floor", "posted", "expir", "valid", "duration", "period",
    "night", "guest", "capacity", "check", "rule", "suitab", "amenit", "feature", "service", "facilit", "spec",
    "detail", "attribute", "rating", "review", "score", "booking", "project", "compound", "percent", "ratio", "utilit", "overview", "advantage",
    "commission", "mortgage", "financ", "payment", "ready", "phase", "delivery", "handover", "warrant", "complian",
    "security", "guard", "camera", "smart", "solar", "frontage", "latitude", "longitude", "square", "meter",
    "سعر", "مساحة", "مساحه", "غرف", "غرفة", "حمام", "دورات", "عمر", "واجهة", "واجهه", "شارع", "حالة", "حاله", "نوع",
    "تاريخ", "موقف", "مواقف", "مصعد", "مفروش", "اتجاه", "دور", "قطعة", "مخطط", "صك", "عقار", "وجهة", "نموذج", "مرافق", "خدمات", "ميزة", "حي", "مدينة",
    "منطقة", "خصم", "تقسيط", "مطبخ", "مجلس", "صالة", "عرض", "طول", "عدد", "مدة", "ايجار", "إيجار", "بيع", "قيمة",
)
# containers whose children are facts again (specs: {area, bedrooms …}); any other nested dict is not walked
_CONTAINER_STEMS = ("spec", "detail", "attribute", "attr", "fact", "feature", "amenit", "info", "propert", "data",
                    "meta", "field", "extra", "additional", "characteristic", "stat", "pric", "location", "geo", "coord",
                    "unit", "building", "land", "rent", "sale", "booking", "stay", "rule", "regulat", "legal",
                    "مواصفات", "تفاصيل", "معلومات", "خصائص", "ميزات")
_TOKEN_SPLIT = re.compile(r"[^A-Za-z0-9\u0600-\u06FF]+|(?<=[a-z0-9])(?=[A-Z])")


def _tokens(key: Any) -> list[str]:
    toks = [t.lower() for t in _TOKEN_SPLIT.split(str(key)) if t]
    return [t[2:] if t.startswith("ال") and len(t) > 4 else t for t in toks]     # «المساحة» → «مساحة»


def _is_fact(key: Any) -> bool:
    return any(t in _FACT_EXACT or t.startswith(_FACT_STEMS) for t in _tokens(key))


# A fact whose value is an object or a list of objects, e.g. city: {id, name}, amenities: [{id, name}]. Here (and only
# here) the child «name / title / label / value» IS the fact (a place, a type, a feature), so just those strings are read.
_LABEL_CHILDREN = frozenset(("name", "title", "label", "value", "text", "ar", "en", "namear", "nameen", "labelar", "labelen",
                             "titlear", "titleen", "valuear", "valueen"))
_LABEL_PARENT_STEMS = ("city", "district", "neighbo", "region", "province", "categor", "type", "status", "purpose", "kind",
                       "finish", "furnish", "direction", "facade", "usage", "condition", "مدينة", "حي", "منطقة")
# FREE-TEXT LISTS (features, amenities, services, tags …) are NOT read generically. ibaax's «features» list carries the
# advertiser's full name, ID number and company beside «مصعد» (found by the per-site PDPL test, 2026-10-13): what a
# free-text list holds is decided per site. A site opts a list in with `capture_source_items(globals(), keep=("features",))`
# after a human has read its real payload.


def _is_label_parent(key: Any) -> bool:
    return any(t.startswith(_LABEL_PARENT_STEMS) or t in ("unit", "unittype") for t in _tokens(key))


def _labels_of(v: Any) -> list[str]:
    """Label strings of an object / a list of objects / a list of strings (never ids, never URLs)."""
    def one(o: Any) -> list[str]:
        if isinstance(o, str):
            return [o] if _scalar_ok(o) and len(o) <= 120 and not _ID_LIKE.search(o) else []
        if isinstance(o, dict):
            return [x for k, x in o.items() if _norm(k) in _LABEL_CHILDREN and isinstance(x, str) and _scalar_ok(x) and len(x) <= 120 and not _ID_LIKE.search(x)]
        return []
    items = v if isinstance(v, (list, tuple)) else [v]
    out: list[str] = []
    for o in list(items)[:MAX_LIST]:
        for x in one(o):
            if x not in out:
                out.append(x)
    return out


def _is_container(key: Any) -> bool:
    return any(t.startswith(_CONTAINER_STEMS) for t in _tokens(key))


MAX_KEY_LEN = 60
MAX_UNKEPT = 80
_BAD_VALUE = ("wa.me", "whatsapp", "t.me/", "x-amz-", "signature=", "token=", "access_token", "bearer ", "@")


def _has_never(nk: str) -> bool:
    return any(w in nk for w in _NEVER_WORDS)


_DIGIT_RUN = re.compile(r"[0-9٠-٩]{5,}")
_ID_LIKE = re.compile(r"[0-9٠-٩]{7,}")        # a bare 7+ digit run inside a LABEL is an identifier (ibaax «features» carried one)


def _note(unkept: set[str], name: str) -> None:
    """List a field NAME we did not keep, so the gap is auditable. Names that could themselves be data (an id used
    as a key, an address, a handle) are not listed."""
    if name and len(name) <= MAX_KEY_LEN and not _DIGIT_RUN.search(name) and not any(c in name for c in "@/\\:?=&#"):
        unkept.add(name)


def _scalar_ok(v: Any) -> bool:
    if isinstance(v, str):
        low = v.lower()
        return not v.startswith(("http://", "https://", "//")) and not any(b in low for b in _BAD_VALUE)
    return True


def _walk(obj: dict[str, Any], keep: frozenset[str], unkept: set[str], depth: int = 0) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in obj.items():
        nk = _norm(k)
        shown = str(k)[:MAX_KEY_LEN]
        explicit = nk in keep
        if not explicit and (not nk or _has_never(nk) or "by" in _tokens(k)):
            continue                                    # a person / credential / media / text field: never kept, not even listed
        if isinstance(v, dict):
            if not explicit and _is_fact(k) and _is_label_parent(k):          # city: {id, name} → just the label
                labels = _labels_of(v)
                if labels:
                    out[str(k)] = labels[0] if len(labels) == 1 else labels
                else:
                    _note(unkept, shown)
            elif depth < MAX_DEPTH - 3 and (explicit or _is_container(k)):    # specs: {area, bedrooms …} → facts again
                sub = _walk(v, keep, unkept, depth + 1)
                if sub:
                    out[str(k)] = sub
            else:
                _note(unkept, shown)
            continue
        if not (explicit or _is_fact(k)):
            _note(unkept, shown)
            continue
        if isinstance(v, (list, tuple)):
            if explicit:                                   # a human reviewed this site's list: strings and labels are fine
                items = [x for x in v if isinstance(x, (str, int, float, bool)) and _scalar_ok(x)
                         and not (isinstance(x, str) and _ID_LIKE.search(x))][:MAX_LIST]
                labels = [] if items else _labels_of(v)
                if items or labels or not v:
                    out[str(k)] = [_plain(x) for x in (items or labels)]
                else:
                    _note(unkept, shown)
            elif v and all(isinstance(x, (int, float)) and not isinstance(x, bool) or isinstance(x, bool) for x in v):
                out[str(k)] = [_plain(x) for x in list(v)[:MAX_LIST]]        # numbers / flags only
            elif not v:
                out[str(k)] = []
            else:
                _note(unkept, shown)
            continue
        if isinstance(v, (str, int, float, bool, datetime, date)) or v is None:
            if _scalar_ok(v):
                out[str(k)] = _plain(v)
            else:
                _note(unkept, shown)
        else:
            _note(unkept, shown)
    return out


def _plain(v: Any, depth: int = 0) -> Any:
    """JSON-safe copy of a scalar. Anything that is not a plain source FACT (a parsed-HTML node, an object) is None."""
    if depth > MAX_DEPTH:
        return None
    if v is None or isinstance(v, (bool, int)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, str):
        return v if len(v) <= MAX_STR else v[:MAX_STR] + "…"
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, dict):
        return {str(k): _plain(x, depth + 1) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_plain(x, depth + 1) for x in list(v)[:MAX_LIST]]
    return None


def _size(d: Any) -> int:
    return len(json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def snapshot(item: Any, keep: tuple[str, ...] = ()) -> dict[str, Any] | None:
    """The PDPL-clean, size-capped copy of one source record's FACTS, or None when there is nothing to keep.

    `keep` = field names a human reviewed for this site and found to be a property fact the vocabulary missed."""
    if not isinstance(item, dict) or not item:
        return None
    unkept: set[str] = set()
    snap = strip_pii_fields(_walk(item, frozenset(_norm(k) for k in keep), unkept))   # walk first so dropped names are listed
    snap = redact_capture(snap)
    if not isinstance(snap, dict):
        return None
    if _size(snap) > MAX_BYTES:
        cut: list[str] = []
        while snap and _size(snap) + 40 > MAX_BYTES:
            biggest = max(snap, key=lambda k: _size(snap[k]))
            cut.append(biggest)
            snap.pop(biggest)
        snap["_cut"] = cut
    if unkept:
        snap["unkept_keys"] = sorted(redact_capture(k) for k in unkept)[:MAX_UNKEPT]   # NAMES only, never values
    return snap or None


def _is_row(x: Any) -> bool:
    return isinstance(x, dict) and any(k in x for k in _ROW_MARKERS)


def _rows_in(result: Any) -> list[dict[str, Any]]:
    """The row dicts inside whatever a mapper returned: a row, (row, category, …), [rows], (rows, why, skips)."""
    if _is_row(result):
        return [result]
    out: list[dict[str, Any]] = []
    if isinstance(result, (tuple, list)):
        for x in result:
            if _is_row(x):
                out.append(x)
            elif isinstance(x, list):
                out.extend(y for y in x if _is_row(y))
    return out


def keep_item_on_rows(result: Any, items: list[Any], keep: tuple[str, ...] = ()) -> Any:
    """Attach the snapshot(s) of `items` to every row in `result`; returns `result` unchanged in shape."""
    snaps = [s for s in (snapshot(i, keep) for i in items) if s]
    if not snaps:
        return result
    for row in _rows_in(result):
        cap = row.get("source_capture")
        if cap is None or cap == {}:
            text = row.get("description") or row.get("title")
            cap = {   # exactly the fallback db._ensure_capture would have built, so nothing downstream changes
                "schema": "auto.v1-fallback",
                "source_text": redact_pii(text) if text else None,
                "url_path": row.get("listing_url"),
                "image_count": len(row.get("photo_urls") or []),
            }
            row["source_capture"] = cap
        if not isinstance(cap, dict) or "source_item" in cap:
            continue
        cap["item_schema"] = ITEM_SCHEMA
        cap["source_item"] = snaps[0]
        if len(snaps) > 1:
            cap["source_item_more"] = snaps[1:]
    return result


def _records_among(fn: Callable[..., Any], args: tuple, kwargs: dict) -> list[dict[str, Any]]:
    """The source record(s) the mapper was handed: the first dict, plus any later dict that is a record."""
    try:
        bound = inspect.signature(fn).bind_partial(*args, **kwargs).arguments
    except (TypeError, ValueError):
        bound = {f"arg{i}": a for i, a in enumerate(args)}
        bound.update(kwargs)
    out: list[dict[str, Any]] = []
    for name, val in bound.items():
        if not isinstance(val, dict) or not val:
            continue
        if not out:
            out.append(val)                                   # the first dict is always the record
        elif name.lower() not in _NOT_A_RECORD and _size(_plain(val)) <= MAX_BYTES:
            out.append(val)                                   # a detail / facts / unit dict beside it
    return out


def with_item_capture(fn: Callable[..., Any], keep: tuple[str, ...] = ()) -> Callable[..., Any]:
    if getattr(fn, "_keeps_source_item", False):
        return fn

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        result = fn(*args, **kwargs)
        try:
            return keep_item_on_rows(result, _records_among(fn, args, kwargs), keep)
        except Exception:     # capture is a bonus record: it must never cost the listing itself
            return result

    wrapper._keeps_source_item = True  # type: ignore[attr-defined]
    return wrapper


def capture_source_items(ns: dict[str, Any], keep: tuple[str, ...] = ()) -> None:
    """Rebind the site's mapping function(s) in its module namespace (`globals()`) to keep the source record."""
    for name in MAP_FN_NAMES:
        fn = ns.get(name)
        if callable(fn):
            ns[name] = with_item_capture(fn, keep)
