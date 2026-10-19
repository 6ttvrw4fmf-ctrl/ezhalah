"""KSA Aqar: when a page has no «النوع» field, the deal is read from the ad's OWN title — and a title
type word the map knows is actually mapped.

THE AUDIT THIS PINS (2026-09-28). 447 of 1,811 REST posts were skipped with the run notes NULL.
81 pages carried no «النوع» field at all, so every one was dropped as "no deal" although the title
said it outright — «جدة حي الفضيلة فيلا للبيع», «شقة للإيجار في حي الحمراء». Separately the title
type map had no «شقة» key (the commonest title word) and mapped «دبلكس» to itself, which the shared
map does not know, so those skipped silently too. Titles below are copied from live ads.

What must still stay out: a field that answers something else («مطلوب»), a contractor ad, an ad
placed abroad, and «بيع» found inside a district name («الربيع»).

Run: python -m pytest scrapers/common/tests/test_ksaaqar_reads_the_deal_from_the_ads_own_title.py -q
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Hermetic: db.py must import with no credentials and no network.
_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

import scrapers.ksaaqar.run as K  # noqa: E402


def post(title: str) -> dict:
    return {"id": 1, "slug": "x", "link": "https://ksaaqar.com/ad/x/",
            "title": {"rendered": title}, "content": {"rendered": ""}}


def page(field: str = "") -> str:
    """A detail page's flattened text. `field` is the «النوع» value; "" means the page has none."""
    return ("الدولة: عقارات الرياض الحالة: جديدة "
            + (f"النوع: {field} " if field else "")
            + "عدد الغرف : 3 الوصف: وصف الإعلان")


READ = [
    # (title, «النوع» field or "")                       → (type, deal)
    (("جدة حي الفضيلة فيلا للبيع", ""), ("Villa", "Buy")),
    (("شقة للإيجار في حي الحمراء", ""), ("Apartment", "Rent")),
    (("شقق تمليك", ""), ("Apartment", "Buy")),
    (("للبيــــــــع ارض حي القادسيه", ""), ("Residential Land", "Buy")),
    (("دبلكس للبيع بحي الكوثر", "للبيع"), ("Duplex", "Buy")),
    (("للايجار وحده علويه بحي سلطانه", "للإيجار"), ("Apartment", "Rent")),
    (("وحدة أرضية للبيع في بريدة", "للبيع"), ("Apartment", "Buy")),  # not «أرض» inside «أرضية»
    (("فندق للبيع في الرياض", "للبيع"), ("Hotel", "Buy")),
]

SKIPPED = [
    (("شقة فاخرة للإيجار في الرمال", "مطلوب"), "deal_field:مطلوب"),   # the field answered
    (("فيلا في حي الربيع", ""), "no_deal_stated"),                    # «بيع» inside «الربيع»
    (("شقة للبيع او للايجار", ""), "no_deal_stated"),                 # both deals = neither
    (("مقاول بناء فلل للبيع", ""), "no_deal_stated"),                 # a contractor, not a listing
    (("فندق للبيع بالشارقة الامارات", "للبيع"), "abroad"),
]


def test_the_deal_comes_from_the_ads_own_title_when_the_field_is_absent(monkeypatch):
    monkeypatch.setattr(K, "to_catalog", lambda city_ar, region_hint=None: (1, 1))
    monkeypatch.setattr(K, "find_district_in_text", lambda text, city_id: None)

    for (title, field), (ptype, deal) in READ:
        row, _cat, why = K.map_listing(post(title), page(field), "")
        assert row is not None, f"a real ad was skipped ({why}): {title}"
        assert (row["property_type"], row["transaction_type"]) == (ptype, deal), title

    for (title, field), reason in SKIPPED:
        row, _cat, why = K.map_listing(post(title), page(field), "")
        assert row is None, f"must stay out: {title}"
        assert why == reason, f"{title}: skip must name its own reason, got {why!r}"
