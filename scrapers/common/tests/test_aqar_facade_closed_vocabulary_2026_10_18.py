"""aqar: the facade («الواجهة») is a closed choice — the stored direction is one of its values or nothing (2026-10-18).

14 live rows held whatever followed the label: the next spec fields («جنوب شرقي غرف النوم 4 عرض الشارع 12 م …»), the
seller's prose, or the advertiser block with a person's name; a re-read of 6921061 wanted «على شارع بعرض 20 متر وحديقة
خلفية …» over its «شمال». Values verbatim from the live table that day.
"""
import pytest

from scrapers.aqar.enrich_residential import aqar_facade


@pytest.mark.parametrize("raw, want", [
    ("شمال", "شمال"), ("جنوب شرقي", "جنوب شرقي"), ("3 شوارع", "3 شوارع"), ("شرق غربي", "شرق غربي"),
    ("جنوب شرقي غرف النوم 4 عرض الشارع 12 م عم", "جنوب شرقي"),     # the next fields ran on
    ("3 شوارع عرض الشارع 10 م عدد الشقق 12 عمر", "3 شوارع"),
    ("على شارع بعرض 20 متر وحديقة خلفية • تتميز بوجود ممر", None),   # 6921061's prose
    ("البحرية وهدوء الحدائق. &gt; 💎 اغتنم الفر", None),
    ("شمالية على شارع عرض 10 متر 📜 الملكية: صك", None),
    ("شارعين (غربي / جنوبي).", None), ("4 التقييمات", None), (None, None), ("", None),
])
def test_only_the_closed_vocabulary_is_a_facade(raw, want):
    assert aqar_facade(raw) == want
