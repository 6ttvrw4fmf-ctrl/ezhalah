"""af_score: a fixture the ad says is NOT installed is not a yes (🔬 2026-11-03).

bahadhabab 10777803 («… ومطبخ المطبخ غير مركب …», stored description) was asked «kitchen» by the 2026-11-03 08:00
score and counted a findability miss, while the shared reader correctly serves that kitchen as unknown.
"""
from scrapers.common import af_score as a
from scrapers.common import new_listings_score as n


def _yes(text: str, field: str) -> bool:
    return a.page_says_yes([a.norm(text)], field)


def test_a_not_installed_kitchen_is_not_a_yes():
    assert not _yes("دور كامل للايجار ومطبخ المطبخ غير مركب وفيه جلسه خارجيه", "kitchen")
    assert not _yes("مصعد غير راكب", "elevator")


def test_an_installed_or_listed_fixture_stays_a_yes():
    assert _yes("مطبخ راكب", "kitchen")
    assert _yes("فيه مطبخ كبير", "kitchen")
    assert _yes("مطبخ، مكيفات غير راكبة", "kitchen")          # a comma ends the verdict: the kitchen is there


def test_the_capture_score_counts_it_page_silent():
    kw = a.BOOL_KW["kitchen"]
    assert n._cmp_bool(None, [a.norm("ومطبخ المطبخ غير مركب")], kw) == n.PAGE_SILENT


def test_a_zero_count_chip_is_not_a_yes():
    # abaad 13214734 (2026-11-03): the chip «<strong>0</strong> مطبخ» — zero kitchens — was asked «kitchen».
    assert not _yes("مطبخ 0", "kitchen") and not _yes("0 مطبخ", "kitchen") and not _yes("مطبخ: 0", "kitchen")
    assert _yes("1 مطبخ", "kitchen") and _yes("مطبخ 10", "kitchen") is True


def test_a_prepared_lift_is_not_a_yes():
    # haraj 18784258 «🔹 مصعد مؤسس 🔹», suwar 11747618 «•مؤسس مصعد •مدخلين» (2026-11-03): both correctly NULL.
    assert not _yes("سطح ملحوظات 🔹 مصعد مؤسس 🔹 واجهه شمالية", "elevator")
    assert not _yes("•مميزات •مؤسس مصعد •مدخلين", "elevator")
    assert _yes("مصعد حديث", "elevator")
