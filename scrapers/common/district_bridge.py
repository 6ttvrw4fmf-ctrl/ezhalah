"""The source-attested English→Arabic district bridge (public.district_name_bridge: dealapp's bilingual pairs,
«Al Malaz Dist.» → «حي الملز») for the English-only sites (rightcompound, compoundin). Exact only: a key is
usable when ONE city's rows give it exactly ONE Arabic answer — «Al Malaz» → حي الملز AND حي الضباط in the same
city is two answers = no answer (never a guess). Each caller normalises with its own `norm` and still confirms
the Arabic against THIS city's catalogue (find_district_in_text)."""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Callable, Optional

from scrapers.common import db

_ARABIC = re.compile(r"[ء-ي]")


@lru_cache(maxsize=None)
def bridge_rows(city_en: str) -> tuple[tuple[str, str], ...]:
    """(district_en, district_ar) pairs of one city, English keys only. One read per city per run; a failed
    read logs and answers () — the caller's dictionary still works — never a crashed crawl."""
    try:
        rows = db._execute(db.sb().table("district_name_bridge").select("district_en,district_ar")
                           .eq("city_en", city_en).range(0, 1999), what="district_name_bridge.read").data or []
    except Exception as e:  # noqa: BLE001 — degrade to the dictionary alone
        print(f"⚠ district bridge unreadable for {city_en}: {str(e)[:140]} — dictionary only", flush=True)
        return ()
    return tuple((str(r.get("district_en") or ""), str(r.get("district_ar") or "")) for r in rows)


def norm_en(name: Optional[str]) -> Optional[str]:
    """«Al Munsiyah District» / «An Narjis» / «Al-Arid» → «munsiyah» / «narjis» / «arid» (rightcompound's key, shared
    so a new caller reads the bridge the same way)."""
    if not name:
        return None
    n = re.sub(r"\b(?:district|dist)\b\.?", " ", name.strip().lower())
    n = re.sub(r"[^a-z\s-]", " ", n)
    n = re.sub(r"^\s*(?:the\s+)?(?:al|an|ar|as|ad|ash|at)[\s-]+", "", n)
    n = re.sub(r"^\s*the\s+", "", n)
    n = re.sub(r"^\s*al(?=[a-z]{4})", "", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n or None


def bridge_unique(rows, norm: Callable[[Optional[str]], Optional[str]]) -> dict[str, str]:
    """{norm(en): district_ar} for the keys with exactly one Arabic answer; Arabic-keyed rows are ignored."""
    seen: dict[str, set[str]] = {}
    for r in rows:
        en, ar = (r.get("district_en"), r.get("district_ar")) if isinstance(r, dict) else r
        en, ar = str(en or ""), str(ar or "")
        if not en or not ar or _ARABIC.search(en):
            continue
        k = norm(en)
        if k:
            seen.setdefault(k, set()).add(ar)
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}
