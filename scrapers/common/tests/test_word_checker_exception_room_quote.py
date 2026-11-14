"""A room named after «باستثناء / ماعدا» (🔬 2026-11-13, CodeRabbit #12178).

The room EXISTS (it is the exception to something else), so the exception word is never its «no». When the room carries
its own trailing verdict («المطبخ غير راكب»), that verdict is the answer AND the evidence quote.
"""
from scrapers.facts import word_checker as W


def _fact(text: str, fact: str):
    return [(f["value_bool"], f["quote"]) for f in W.check(text) if f["fact"] == fact]


def test_excepted_room_with_its_own_verdict_quotes_the_verdict():
    assert _fact("جميع التجهيزات متوفرة باستثناء المطبخ غير راكب", "kitchen") == [(False, "المطبخ غير راكب")]


def test_excepted_room_without_a_verdict_is_silent():
    assert _fact("مكيفات مخفية (ماعدا غرفة السائق والعاملة المنزلية مكيفات سبيلت)", "driver_room") == []
    assert _fact("المكيفات مركبة في جميع الغرف، باستثناء غرفة العاملة.", "maid_room") == []


def test_an_excepted_appliance_stays_a_no():
    got = _fact("الأجهزة الكهربائية كاملة ما عدا الغسالة", "laundry_room")
    assert got and got[0][0] is False
