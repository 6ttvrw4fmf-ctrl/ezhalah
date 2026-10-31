"""A rotating «featured ads» strip is the website's template, not the ad (🔬 2026-10-31).

tuba prints a few of a rotating set of OTHER ads' titles on every page. The old all-pages intersection never saw
any single title as shared, so af_score asked «furnished» of sale ads that never say it (dry run 41188548521:
11 of 11 tuba misses, every «why furnished» one of three featured titles).
"""
from scrapers.common import af_score as a

FEATURED = [a.norm("شقة مفروشة في جدة حي الفيصلية ايجار شهري سنوي"),
            a.norm("شقة مؤثثة للايجار (الشهري والسنوي ) جدة حي السلامة"),
            a.norm("شقة مفروشة للايجار الشهري في جدة حي النزهة، شارع")]


def _sample(n: int = 8) -> list[list[str]]:
    pages = []
    for i in range(n):
        own = [a.norm(f"شقة للبيع في الرياض حي {i}"), a.norm(f"حمامات: {i + 1}")]
        shown = [FEATURED[(i + k) % 3] for k in range(2)]          # two of three, rotating
        pages.append(own + shown)
    return pages


def test_rotating_titles_are_template():
    chrome = a.template_lines(_sample())
    assert set(FEATURED) <= chrome


def test_the_ads_own_lines_stay_the_ad():
    chrome = a.template_lines(_sample())
    assert not any("الرياض" in x or "حمامات" in x for x in chrome)


def test_a_line_on_a_minority_of_pages_stays_the_ad():
    pages = _sample(8)
    rare = a.norm("قريب من الخدمات ، موقف سيارات ،")
    pages[0].append(rare)
    pages[1].append(rare)
    pages[2].append(rare)                                       # 3 of 8 < half
    assert rare not in a.template_lines(pages)


def test_the_score_no_longer_asks_furnished_from_the_strip():
    pages = _sample()
    chrome = a.template_lines(pages)
    ad = [x for x in pages[0] if x not in chrome]
    assert not a.page_says_yes(ad, "furnished")


def test_mutation_the_old_intersection_kept_the_strip():
    readable = [set(p) for p in _sample()]
    old = set.intersection(*readable)
    ad = [x for x in _sample()[0] if x not in old]
    assert a.page_says_yes(ad, "furnished")      # the 10-31 false ask, reproduced on the old rule


def test_small_samples_unchanged():
    assert a.template_lines(_sample(2)) == set()
    three = _sample(3)
    assert a.template_lines(three) == set.intersection(*[set(p) for p in three])
