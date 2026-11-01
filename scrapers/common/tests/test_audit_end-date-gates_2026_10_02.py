"""Crawler audit 2026-10-02 — an ad past its OWN end date was still written as an active listing.

Fleet law (normalize.ad_expiry_state, owner 2026-09-28): 'expired' is never a listing; 'unknown' (the
source states no readable date) is not judged. Measured live 2026-10-02 before any code changed:
  albukaeri  1 of 31 pages prints a licence block; its «تاريخ النهاية» was 2026-08-15 and the row was active.
  vmksa      64 of 64 ads read print «تاريخ انتهاء ترخيص الاعلان», all in date — stored, never gated.
  shomou     the gate judged the article's FIRST <time>; an ad that fills «سنة بناء العقار» renders that as
             a <time> BEFORE its end date (nid 4884: build 2025-09-30, end 2022-01-01).
maqrat and nafithh read the same kind of date but are NOT changed here: open PR #5103 already gates them.
Every fixture is synthetic (no real ad, name, phone or licence). Dates are 2020 / 2099 so no clock is needed.
"""
import json
from pathlib import Path

import pytest

import scrapers.albukaeri.run as A
import scrapers.shomou.run as S
import scrapers.vmksa.run as V
from scrapers.common.tests.test_ad_end_date_is_a_gate import _calls_the_gate

EXPIRED = "ad_licence_expired"


@pytest.fixture(autouse=True)
def _no_db(monkeypatch):
    for mod in (A, S, V):
        monkeypatch.setattr(mod, "to_catalog", lambda c, region_hint=None: (1, 1) if c else (None, None))
        monkeypatch.setattr(mod, "find_district_in_text", lambda t, cid: None)
    monkeypatch.setattr(S, "resolve_district", lambda t: None)


def test_each_of_the_three_crawlers_calls_the_gate():
    # the shared ratchet's label regex does not see albukaeri («تاريخ النهاية») or vmksa («ترخيص الاعلان»)
    for site in ("albukaeri", "shomou", "vmksa"):
        src = (Path(A.__file__).resolve().parents[1] / site / "run.py").read_text(encoding="utf-8")
        assert _calls_the_gate(src), site


# ── albukaeri ────────────────────────────────────────────────────────────────────────────────────
def _bkr(end=None):
    licence = "" if end is None else (
        '<div class="license-row"><span class="lr-label">رخصة الإعلان</span><span class="lr-value">7200000001</span></div>'
        f'<div class="license-row"><span class="lr-label">تاريخ النهاية</span><span class="lr-value" data-fmt-date="{end}"></span></div>')
    page = ('<h1 class="prop-hero-title">شقة تجريبية</h1><div class="prop-hero-location">الدمام · حي الاختبار</div>'
            + licence)
    return A.parse_page("a" * 24, page)


def test_albukaeri_an_ad_past_its_licence_end_date_is_not_a_listing():
    assert A.map_page(_bkr("Wed Jan 15 2020 00:00:00 GMT+0000 (Coordinated Universal Time)"), "شقة سكنية") == (None, EXPIRED)


def test_albukaeri_in_date_and_no_licence_block_are_both_kept():
    (row, _), why = A.map_page(_bkr("Thu Dec 31 2099 00:00:00 GMT+0000 (Coordinated Universal Time)"), "شقة سكنية")
    assert why == "" and row["active"] is True and row["license_expiry"] == "2099-12-31"
    (row, _), why = A.map_page(_bkr(), "شقة سكنية")           # 30 of 31 live pages: no block, nothing to judge
    assert why == "" and "license_expiry" not in row


def test_albukaeri_a_printed_end_date_it_cannot_read_fails_closed():
    with pytest.raises(ValueError):                            # main() counts it unreadable: no upsert, no prune
        _bkr("15/01/2020")


# ── vmksa ────────────────────────────────────────────────────────────────────────────────────────
def _vmk(end):
    opts = {"نوع العقار": "شقة", "غرض الاعلان": "بيع", "مساحة العقار": "120"}
    if end:
        opts["تاريخ انتهاء ترخيص الاعلان"] = end
    rows = "".join(f"{n:x}:" + json.dumps({"option": k, "selected_value": v}, ensure_ascii=False) + "\n"
                   for n, (k, v) in enumerate(opts.items(), start=0x50))
    rows += "40:" + json.dumps([f"${n:x}" for n in range(0x50, 0x50 + len(opts))]) + "\n"
    raw = rows + json.dumps({"id": 7, "title": "شقة للبيع", "options": "$40", "price": "SAR 500,000.00",
                             "price_without_format": "500000", "property_type_enum": "sale"},
                            ensure_ascii=False, separators=(",", ":"))
    return V.map_ad(V.main_ad(raw, 7), V.rows_of(raw))


def test_vmksa_gates_on_the_licence_end_date():
    assert _vmk("15/01/2020") == (None, EXPIRED)
    for kept in ("31/12/2099", None):
        got, why = _vmk(kept)
        assert why == "" and got[0]["active"] is True, kept


# ── shomou ───────────────────────────────────────────────────────────────────────────────────────
def _shq(build, end):
    t = '<time datetime="{0}T12:00:00Z">{0}</time>'
    page = ('<article data-history-node-id="9" role="article">'
            '<div class="text-right h1">شقة</div> <div class="text-right h1">سكنية</div> <div class="text-right h1">للبيع</div> '
            '<div class="text-right h1">المحافظة: الأحساء</div> '
            + (f'<div class="text-right h1">سنة بناء العقار: {t.format(build)} </div> ' if build else "")
            + (f'<div class="text-right h1"> <div>تاريخ إنتهاء الإعلان</div> <div>{t.format(end)} </div> </div>' if end else "")
            + "</article>")
    return S.map_detail(S.parse_detail("9", page))


def test_shomou_judges_the_labelled_end_date_never_the_build_year():
    assert _shq("2099-01-01", "2020-01-15")[2] == "ad_end_date_expired"     # was 'live' on the build date
    row, _, why = _shq("2020-01-15", "2099-12-31")                          # was 'expired' on the build date
    assert why == "" and row["active"] is True and row["additional_info"]["ad_end_date"] == "2099-12-31"
    assert _shq("2099-01-01", None)[2] == "ad_end_date_unknown"             # a build year alone is no end date
    assert _shq(None, "2099-12-31")[2] == ""
