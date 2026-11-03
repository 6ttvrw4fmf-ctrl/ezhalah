"""The free word reader's selftest gates every scrapers PR (2026-11-03 precision audit).

Until this file existed, `python -m scrapers.facts.word_checker --selftest` ran only inside facts-words.yml, which
triggers on PUSH to main — so a PR could put «بنت» (a name: خديجة بنت خويلد) back as Wi-Fi, or «ونشتري» back as a
crane, and nothing would turn red until it had already re-read 400k ads. Each selftest line is a real ad sentence;
this test runs all of them on the PR, through the same pytest job that already runs on scrapers/**.
"""
from scrapers.facts import word_checker as W


def test_word_checker_selftest_passes():
    W.selftest()


def test_look_alike_words_are_not_chips():
    """The audit's worst classes, asserted directly so a weakened selftest cannot hide them."""
    def facts(text):
        return W.facts_of(W.clean_text(None, text))

    assert "wifi" not in facts("شقة للبيع في شارع خديجة بنت خويلد, حي طويق")
    assert "crane" not in facts("نبيع ونشتري في الخبر والدمام")
    assert "dunes_view" not in facts("شقه للايجار بالدور الثاني بالرمال")
    assert "producing_farm" not in facts("مطبخ + غرفة شغالة بدورات مياه خاصة")
    assert "raised_plot" not in facts("أسقف مرتفعة أبواب مرتفعة")
    assert "for_youth" not in facts("شتر للشبابيك")
    assert "reception" not in facts("يسعدنا استقبال عروضكم العقارية")
    assert "license" not in facts("صاحب الترخيص : مؤسسة تاريخ انتهاء الترخيص : 17/07/2027")
    assert facts("مع النت والكهرباء").get("wifi") is True
