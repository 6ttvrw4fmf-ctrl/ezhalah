"""What a Nuzul site shows under «الاستخدام» — and whether a LAND ad is residential or commercial by it.

Every Nuzul tenant (aldarim, abwbna, alobid, bahadhabab, goldendeal, jawher, m3tmd, october, senan, yameen) returns
two different things about use:

  category        residential|commercial — the office's filing pick, a search facet. The ad page NEVER shows it.
  is_for_* flags  what the ad page prints under «الاستخدام» (English page: «Usage»).

Read live on 2026-11-10 (9 ad pages, 4 tenants):
  aldarim 50820   category residential, commercial flag only     → «الاستخدام: تجاري»
  aldarim 41719   category commercial,  residential flag only    → «الاستخدام: سكني»
  aldarim 39815   residential + commercial                       → «سكني، تجاري»
  aldarim 49109   farming                                        → «زراعي»
  aldarim 38817   factory                                        → «صناعي»
  aldarim 37533   residential + commercial + education           → «سكني / تجاري / تعليمي»
  aldarim 27808   no flag                                        → no «الاستخدام» row at all
  goldendeal 48914  commercial + health + factory                → «تجاري / صحي / صناعي»
  m3tmd 37176, jawher 51496  category residential, commercial flag only → «الاستخدام: تجاري» (title «أرض تجارية…»)

Until that day the scrapers read `category` for both jobs: the card's usage row printed the office's hidden pick, and a
land ad the site calls commercial was stored as Residential Land (about 55 active ads on six tenants, and 4 the other
way round). Owner 2026-11-10, shown aldarim 50820: «Fix all bro these issues can't happen».

THE RULE (one place, every Nuzul scraper):
  * the usage row is the site's own words for the flags that are ON, in Arabic as the page prints them;
    no flag on → no row (silence stays silence — never filled from `category`);
  * a LAND ad is commercial when the commercial flag is on and the residential flag is off, residential the other
    way round; both on or both off → the page does not settle it, so the office's `category` decides (as before).
    Farming / factory / education / health do not answer the residential-or-commercial question.
Other types (apartment, villa, building…) are not touched by this module's land rule.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

# (API flag, machine name, the word the ad page prints)
USE_FLAGS: tuple[tuple[str, str, str], ...] = (
    ("is_for_residential", "residential", "سكني"),
    ("is_for_commercial", "commercial", "تجاري"),
    ("is_for_education", "education", "تعليمي"),
    ("is_for_health", "health", "صحي"),
    ("is_for_factory", "factory", "صناعي"),
    ("is_for_farming", "farming", "زراعي"),
)


def _on(v: Any) -> bool:
    """A flag is ON only when the API says so. None / False / 0 / "0" / "" / anything odd is not a yes."""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v == 1
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true")
    return False


def uses_on(item: Mapping[str, Any]) -> list[str]:
    """Machine names of the use flags that are on, in the page's order."""
    return [name for flag, name, _ in USE_FLAGS if _on(item.get(flag))]


def usage_shown_ar(item: Mapping[str, Any]) -> Optional[str]:
    """The «الاستخدام» value as the ad page prints it («سكني، تجاري»); None when the page shows no such row."""
    words = [ar for flag, _, ar in USE_FLAGS if _on(item.get(flag))]
    return "، ".join(words) if words else None


def land_category(item: Mapping[str, Any]) -> str:
    """'commercial' or 'residential' for a LAND ad: the page's own usage when it settles it, else the office's filing."""
    res, com = _on(item.get("is_for_residential")), _on(item.get("is_for_commercial"))
    if com and not res:
        return "commercial"
    if res and not com:
        return "residential"
    return "commercial" if str(item.get("category") or "").strip().lower() == "commercial" else "residential"
