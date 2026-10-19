"""صادق التاجر: a real ad in a real single-type category is READ, and a mixed bucket is skipped
under its OWN name — never lumped, never guessed.

THE AUDIT THIS PINS (2026-09-28). The sitemap listed 1,789 ads; 1,498 were read. The closed header
map was missing categories the source really prints — «دبلكسات» (48), «تجاري ارض» (63), the rent
spelling «محلات و صالات تجارية» (33), «ادوار» (11), «ورش صناعية» (5) — and the header regex missed
every FEATURED ad, because the «مميز» badge sits between «-->» and the deal word (8). All of them
were counted as one «no_type_deal_or_city», so nothing said which categories were lost. The shapes
below are copied from live pages (ad codes 7117, 5880, 8817, 8134).

The mixed buckets («دورين», «دور و شقتين و ادوار», «مستودعات و ورش» …) hold several property types
under one name — ad 5965 is titled «فله», described «دور مع شاليه», and filed «دور و شقتين و ادوار».
They stay out (AMBIGUOUS-MAPPING ASK-FIRST), but each is counted by its own name.

Run: python -m pytest scrapers/common/tests/test_sadiqeltajer_reads_every_real_category.py -q
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

import scrapers.sadiqeltajer.run as S  # noqa: E402

TAIL = " اللوكيشن تفاصيل الإعلان الموقع حسب الصك القصيم - بريدة - الغدير اعلانات مشابهة 9 1 م² 5 ريال"


def page(header: str) -> str:
    return "<html><body>" + header + TAIL + "</body></html>"


READ = {
    # header copied from the live ad                                          → (type, deal)
    "--&gt; دبكلس حي الربوه --&gt; بيع دبلكسات كود الاعلان : 7117 على السوم دبكلس 286 م²":
        ("Duplex", "Buy"),
    "--&gt; ارض بحي الضاحي --&gt; بيع تجاري ارض كود الاعلان : 5880 (سوم) ارض 250,000 ريال 700 م²":
        ("Commercial Land", "Buy"),
    "--&gt; للايجار محل --&gt; إيجار محلات و صالات تجارية كود الاعلان : 8817 للايجار محل "
    "30,000 ريال ( للإيجار ) 73 م²":
        ("Shop", "Rent"),
    "--&gt; للبيع فله --&gt; مميز بيع فلل كود الاعلان : 8134 (حد) للبيع فله 875,000 ريال 325 م²":
        ("Villa", "Buy"),
    "--&gt; للايجار دور علوي --&gt; إيجار ادوار كود الاعلان : 8850 للايجار دور علوي 18,000 ريال 90 م²":
        ("Floor", "Rent"),
    "--&gt; للايجار فلة --&gt; إيجار فلل ودبلكسات (ايجار) كود الاعلان : 8321 للايجار فلة "
    "35,000 ريال ( للإيجار ) 400 م²":
        ("Villa", "Rent"),
}

SKIPPED = {
    "--&gt; دورين --&gt; بيع دورين كود الاعلان : 6576 (حد) دورين 570,000 ريال 290 م²":
        "unmapped:دورين",
    "--&gt; للبيع فله --&gt; بيع دور و شقتين و ادوار كود الاعلان : 5965 على السوم للبيع فله 690 م²":
        "unmapped:دور و شقتين و ادوار",
    "--&gt; مخطط --&gt; بيع مخططات كود الاعلان : 7709 على السوم مخطط 9000 م²":
        "subdivision_plan",
}


def test_every_real_category_is_read_and_every_skip_names_its_reason(monkeypatch):
    monkeypatch.setattr(S, "to_catalog", lambda city_ar, region_hint=None: (1, 1))
    monkeypatch.setattr(S, "find_district_in_text", lambda text, city_id: text)

    for header, (ptype, deal) in READ.items():
        row, _cat, why = S.map_listing("https://sadiq-eltajer.sa/ads/x", page(header))
        assert row is not None, f"a real ad was skipped ({why}): {header[:60]}"
        assert (row["property_type"], row["transaction_type"]) == (ptype, deal), header[:60]
        assert row["city_ar"] == "بريدة"

    for header, reason in SKIPPED.items():
        row, _cat, why = S.map_listing("https://sadiq-eltajer.sa/ads/x", page(header))
        assert row is None, f"a mixed bucket was filed under a guessed type: {header[:60]}"
        assert why == reason, f"skip must name its own reason, got {why!r}"
