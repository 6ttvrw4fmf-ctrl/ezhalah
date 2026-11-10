"""أوال: the ad's own area words (⚡ 2026-11-09 blind-spot hunt). 645516 «قطعة ارض بحي غرناطة ج رقم القطعة 495
شارع 18 مساحتها 630» served with no area: AREA_RE knew «مساحة/مساحه» but not «مساحتها», nor «مساحة الصك 240 م»
(645564). Source words only — the street width and the lot number must never be read as the area."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.awal import run as R  # noqa: E402


def _area(text: str):
    m = R.AREA_RE.search(text)
    return R._to_float(m.group(1)) if m else None


def test_mesahatuha_is_the_area():
    assert _area("قطعة ارض بحي غرناطة ج رقم القطعة 495 شارع 18 مساحتها 630") == 630
    assert _area("قطعة ارض بحي قرطبة أ رقم القطعة 19 شارع 50 مساحتها 792 أطوالها 24 في 33") == 792


def test_the_deed_area_is_the_area():
    assert _area("للبيـع بالخالديه… مساحة الصك 240 م مسطح البناء 482 م بيت دورين") == 240


def test_the_old_shapes_still_read_and_nothing_else_does():
    assert _area("أرض سكنية للبيع حي غرناطه رقم 244 مساحة 630م شارع 18 + ممر") == 630
    assert _area("المساحة م² : 600") == 600
    assert _area("شقه للايجار علويه حي الناصريه غرفه نوم ومطبخ الايجار ٨٥٠") is None
