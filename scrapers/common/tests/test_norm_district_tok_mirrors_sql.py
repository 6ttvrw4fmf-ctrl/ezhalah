"""The Python district key must equal the SQL key it looks up against.

THE OUTAGE THIS CLOSES (found 2026-09-14). `find_district_in_text()` matched candidates with
`norm_ar()`, but the set it matched against — `loc_catalog_district.district_norm` — is built with
`public.norm_district_tok()`. norm_ar() mirrors `normalize_ar()`, which is only the FIRST of
norm_district_tok()'s eight steps. The two agreed just often enough to look alive: «ولي العهد»
resolved (no «ال», no hamza) while «الرصيفة», «الخالدية», «الشوقية», «العوالي» and «الكعكية» — the
five cases the function's own docstring cited as measured-working — ALL returned None.

It broke on 2026-09-12, one day after the function was written: migration
20260912172542_district_identity_fold_one_place_one_token.sql recomputed every district_norm through
norm_district_tok(), moving the catalog's keys out from under a lookup nobody re-checked. Live
symptom: remal 41/84 and azdad 10/22 districts resolved.

WHY IT WAS INVISIBLE FOR TWO DAYS. The two tests covering this seeded their stub catalogs with
`norm_ar()` too — the same wrong key as the code — so test and code agreed with each other and
disagreed with the database. A barrier that supplies its own input proves nothing; feed it what
PRODUCTION stores. (Both stubs are fixed to norm_district_tok() in the same change.)

So this file pins the MIRROR itself against values taken from the SQL function, and pins the
end-to-end resolve through the real matching logic. Expected values below were produced by
`select public.norm_district_tok(t)` on production, 2026-09-14 — they are an oracle, not a guess.

Run: python -m pytest scrapers/common/tests/test_norm_district_tok_mirrors_sql.py -v
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.modules.setdefault("scrapers.common.db", types.ModuleType("scrapers.common.db"))

import scrapers.common.arabic_location as al  # noqa: E402

# input → public.norm_district_tok(input), read off production 2026-09-14.
SQL_ORACLE = {
    "حي الروضة": "روضه",
    "حي الرصيفة": "رصيفه",
    "الخالدية": "خالديه",
    "حي بطحاء قريش": "بطحا قريش",          # ء dropped
    "الشرايع": "شرايع",
    "حي الشرائع": "شرايع",                  # ئ→ي, so both spellings land on ONE token
    "حي النواريه": "نواريه",
    "المحمدية 1": "محمديه 1",
    "المحمدية ١": "محمديه 1",               # Arabic-Indic digit folds to ASCII
    "الرحاب2": "رحاب 2",                    # letter|digit gets a space — the twin keeps its identity
    "حي حي المصيف": "مصيف",                 # repeated «حي » prefix
    "ولي العهد": "ولي العهد",               # no «ال», no hamza — the one shape the old key got right
    "حي  السبهاني": "سبهاني",
    "حي العمرة الجديدة": "عمره الجديده",
    "الحمراء وام الجود": "حمرا وام الجود",
    "حي جرهم": "جرهم",
    "مُحَمَّدية": "محمديه",                    # tashkeel stripped
}


@pytest.mark.parametrize("raw,expected", sorted(SQL_ORACLE.items()))
def test_python_mirror_equals_the_sql_function(raw, expected):
    assert al.norm_district_tok(raw) == expected, (
        f"norm_district_tok({raw!r}) drifted from SQL public.norm_district_tok(). The catalog's "
        f"district_norm is built with the SQL one, so any drift silently stops districts resolving.")


def test_norm_ar_is_NOT_a_substitute_and_this_is_the_whole_bug():
    # The anchor. If these ever become equal, the mirror above is no longer proving anything and
    # this file must be re-thought rather than deleted.
    differ = [k for k in SQL_ORACLE if al.norm_ar(k) != al.norm_district_tok(k)]
    assert len(differ) >= 10, (
        "norm_ar() and norm_district_tok() should disagree on most real district names — that "
        f"disagreement IS the outage this file guards. Only {len(differ)} differed.")
    # and specifically on the shape that broke: a leading «ال»
    assert al.norm_ar("الخالدية") != al.norm_district_tok("الخالدية")


# ── end-to-end: the real matcher, against a catalog keyed the way PRODUCTION keys it ─────────────
MECCA = 6
_REAL_MECCA = ["حي الرصيفة", "حي الخالدية", "حي الشوقية", "حي العوالي", "حي الكعكية",
               "حي بطحاء قريش", "حي ولي العهد", "حي الشرائع", "حي النوارية"]


@pytest.fixture(autouse=True)
def _seed_catalog():
    al._CITY["_stub_"] = [(1, 1)]
    al._DISTRICT_BY_CITY[MECCA] = {al.norm_district_tok(d) for d in _REAL_MECCA}
    for d in _REAL_MECCA:
        al._DISTRICT_AR_BY_NORM[al.norm_district_tok(d)] = d
    yield
    al._DISTRICT_BY_CITY.pop(MECCA, None)


@pytest.mark.parametrize("text,expected", [
    ("فيلا في الرصيفة", "حي الرصيفة"),          # the five the docstring claimed, all None before
    ("شقة بالخالدية", "حي الخالدية"),           # ...and «ب» prefix attached to the word
    ("أرض في الشوقية", "حي الشوقية"),
    ("فيلا العوالي", "حي العوالي"),
    ("شقة الكعكية", "حي الكعكية"),
    ("مشروع رقم 725 شقق تمليك الموقع حي بطحاء قريش", "حي بطحاء قريش"),
    ("مكة الشرايع", "حي الشرائع"),              # source spells it ي, catalog spells it ئ
    ("مكة حي النواريه شمال مكه", "حي النوارية"),  # source ه, catalog ة
    ("مخطط ولي العهد 2 داخل الحد", "حي ولي العهد"),  # «مخطط» window skipped, the 2-word one matches
])
def test_a_real_district_stated_in_free_text_resolves(text, expected):
    assert al.find_district_in_text(text, MECCA) == expected


@pytest.mark.parametrize("text", [
    "مخطط الربوة",            # a subdivision PLAN is never a district
    "مخطط تلال مكة",
    "حي الشافعي",             # a real-sounding name that is NOT in Mecca's catalog
    "حي النخيل",
    "بدون موقع",
])
def test_anything_not_in_the_catalog_is_still_refused(text):
    assert al.find_district_in_text(text, MECCA) is None, (
        "the fix must widen what MATCHES, never what is INVENTED — exact-location-only still binds")


def test_the_canonical_catalog_spelling_is_returned_not_the_source_substring():
    # A matched district must render identically to every other listing for that place.
    assert al.find_district_in_text("مكة الشرايع", MECCA) == "حي الشرائع"
    assert al.find_district_in_text("النواريه", MECCA) == "حي النوارية"
