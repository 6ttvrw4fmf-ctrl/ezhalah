"""Regression test: 1october rent ads that price only in the ad body must not be served priceless.

WHY (senior audit 2026-08-12). Seven of october's eight active Rent listings were in
`search_listings_ar`, `production_ready = true`, with `price_annual` NULL, `price_total` NULL and
`rent_period` NULL — while their own page stated both the rent and its period:

    id 665333  «💰 الإيجار السنوي: 85,000 ريال»
    id 665335  «💰 الإيجار الشهري: 2,500 ريال (شامل الكهرباء والماء)»
    id 665337  «💰 الإيجار السنوي: 55,000 ريال 🔒 تأمين مسترد: 2,000 ريال»

`_detail_specs` reads price only from JSON-LD `offers.price` or a numeric `"price":` in the RSC
payload. When 1october omits both, the figure survives only in the body, so the row reached users
with no price at all and could not be returned by any price filter or either period chip.

This is a 1october capture gap, not the general "price on request" population: across the whole
fleet only 24 of 2,632 priceless active rents carry a labelled price line, and october is 7 of its
own 7 (aqar, by contrast, is 1 of 2,032 — for aqar priceless genuinely means priceless).

WHY THIS IS A SOURCE READ, NOT THE 2026-08-11 PROSE TRAP. That lesson (a rent-period detector keyed
on `source_capture ~ شهري` matched RNPL lines, the similar-listings strip and seller prose, and was
killed for producing confident wrong numbers) is about TOKEN PRESENCE anywhere in a blob. This is
the accepted 2026-08-10 aqar shape instead — a labelled «السعر/الإيجار: N ريال» beats an unlabelled
pick — and requires label, amount and currency adjacent and in order. The deposit line that sits
directly after the rent line in 665337 is the sharpest negative control in this file.

Run: python -m pytest scrapers/common/tests/test_october_labelled_rent_price_from_body.py -v
"""
from __future__ import annotations

import pytest

from scrapers.october.run import _rent_from_prose


# Verbatim body text from the live rows (2026-08-12), trimmed to the region under test.
LIVE = {
    665333: ("• سوبر ماركت ⸻ 💰 الإيجار السنوي: 85,000 ريال 📍 الموقع: إعمار سكوير – الفيحاء – جدة",
             85_000, "annual"),
    665334: ("✈️ المطار – 20 دقيقة 💰 الإيجار: 65,000 ريال سنوياً 💳 الدفع: دفعتين",
             65_000, "annual"),
    665336: ("🏡 فيلا دوبلكس للإيجار السنوي – حي الياقوت 💰 الإيجار السنوي: 80,000 ريال",
             80_000, "annual"),
    665337: ("✈️ مطار الملك عبدالعزيز الدولي – 20 دقيقة 💰 الإيجار السنوي: 55,000 ريال "
             "🔒 تأمين مسترد: 2,000 ريال",
             55_000, "annual"),
    665338: ("تصميم عملي يصلح كمقر شركة 💰 الإيجار السنوي: 400,000 ريال 💳 طريقة الدفع: دفعتين",
             400_000, "annual"),
    665339: ("📍 الموقع: شقة أمامية بزاوية 💰 الإيجار السنوي: 40,000 ريال 🔁 طريقة الدفع: دفعتين",
             40_000, "annual"),
}


@pytest.mark.parametrize("listing_id", sorted(LIVE))
def test_annual_rows_recover_the_exact_source_figure(listing_id):
    body, expected_amount, expected_period = LIVE[listing_id]
    assert _rent_from_prose(body) == (expected_amount, expected_period)


def test_monthly_is_annualised_and_the_period_is_recorded_as_monthly():
    """id 665335. price_annual carries the annualised figure while rent_period keeps the source's
    own word — the storage convention verified against dealapp on 2026-08-12 (8,000/month is
    stored price_annual=96,000, rent_period='monthly')."""
    body = ("🔹 المواصفات: • غرفتين • حمام 💰 الإيجار الشهري: 2,500 ريال "
            "(شامل الكهرباء والماء) 📍 الموقع والمميزات:")
    assert _rent_from_prose(body) == (30_000, "monthly")


def test_the_deposit_on_the_same_line_is_never_taken_as_the_rent():
    """The 665337 shape is the whole reason the pattern is label-anchored: «تأمين مسترد: 2,000 ريال»
    is a different label, so the 55,000 rent must win and 2,000 must never appear."""
    amount, period = _rent_from_prose(LIVE[665337][0])
    assert (amount, period) == (55_000, "annual")
    assert amount != 2_000


def test_a_deposit_alone_yields_nothing():
    assert _rent_from_prose("🔒 تأمين مسترد: 2,000 ريال 💳 طريقة الدفع: دفعتين") == (None, None)


def test_an_amount_with_no_stated_period_is_refused():
    """Storing the figure would force a period the source never stated. Honest NULL beats a guess —
    the same rule that removed raghdan's manufactured «سنوي» on 2026-08-11."""
    assert _rent_from_prose("💰 الإيجار: 70,000 ريال 💳 طريقة الدفع: دفعتين") == (None, None)


def test_payment_split_prose_is_not_a_price():
    assert _rent_from_prose("💳 طريقة الدفع: دفعتين 🔁 سنوياً") == (None, None)


def test_empty_and_missing_bodies_are_safe():
    assert _rent_from_prose(None) == (None, None)
    assert _rent_from_prose("") == (None, None)


def test_sub_floor_amounts_are_refused():
    """Mirrors the floor the structured path already applies (`price < 100` -> None), so a stray
    small figure cannot become a rent."""
    assert _rent_from_prose("💰 الإيجار السنوي: 50 ريال") == (None, None)


def test_alternate_hamza_spelling_is_read():
    """1october's copywriters use both «الإيجار» and «الايجار»."""
    assert _rent_from_prose("💰 الايجار السنوي: 25,000 ريال") == (25_000, "annual")
