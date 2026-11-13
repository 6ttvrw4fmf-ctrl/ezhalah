"""CodeRabbit on #11820 (2026-11-11): a place phrase between «لا يوجد» and the next item, and a served plot that is
«مستقلة» (its own deed). Each pair holds both directions."""
from scrapers.facts import word_checker as W


def _f(t):
    return W.facts_of(W.clean_text(None, t))


def test_a_place_then_an_item_is_the_items_no_not_the_fitted_kitchens():
    got = _f("مطبخ راكب لا يوجد في المبنى مصعد")
    assert got.get("kitchen") is True and got.get("elevator") is False
    assert _f("لا يوجد بالعمارة مصعد").get("elevator") is False
    # nothing after the place: the no is the kitchen's
    assert _f("مطبخ راكب: لا يوجد في الشقة").get("kitchen") is False
    assert _f("يوجد في المبنى مصعد").get("elevator") is True


def test_a_served_plot_on_its_own_deed_keeps_its_services():
    assert _f("أرض مخدومة مستقلة بصك").get("all_services") is True
    assert "all_services" not in _f("كل خدمات الشقه مستقله")
