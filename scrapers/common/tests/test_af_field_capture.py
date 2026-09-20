"""Advanced-Filter field capture for the seven platforms onboarded 2026-09-19/20.

The owner's report: "they don't show in the advanced filter". Measured on production, every one of
the 303 live listings was dropped by any amenity question — furnished/elevator/kitchen/parking/
age/direction/license each had ZERO non-NULL values across all seven platforms, while bedrooms had
191 and bathrooms 181. It was never a filter bug: the filter reads real columns and the columns
were empty, because each parser was reading these facts and filing them in `additional_info`
(which nothing can search) or not reading them at all.

Four distinct defects, all locked below:
  1. gudai/safera print «عدد الغرف: 7» but `_BED_RE` only matched «غرف النوم», so bedrooms was NULL
     on every row while bathrooms parsed fine from «الحمامات» — the asymmetry that exposed it.
  2. «مؤثثة: لا», «عام الاكتمال: 2021» and «رقم الترخيص» were on the page and never written.
  3. compoundin stamped EVERY unit on a compound with unit #1's amenity chip (one un-anchored
     page-wide regex).
  4. fahadalshahri says «مصعد مؤسس» — an elevator shaft that has been PREPARED. Reading that as
     elevator=True publishes a fixture the property does not have.

Every fixture below is verbatim source text captured from the live sites on 2026-09-20, not text
this repo invented (a barrier that supplies its own input proves nothing).

Run: python -m pytest scrapers/common/tests/test_af_field_capture.py -v
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from scrapers.common import normalize  # noqa: E402


# ─────────────────────────────── SOURCE IS TRUTH: the three outcomes ───────────────────────────
def test_named_amenity_is_true() -> None:
    got = normalize.amenities_from_text("المرافق: مصعد، مواقف سيارات، مدخل خاص")
    assert got["elevator"] is True and got["parking"] is True and got["private_entrance"] is True


def test_silence_stays_null_never_false() -> None:
    """The single most important assertion here. A source that does not mention an elevator has
    NOT said there is no elevator. Turning that silence into False would publish a claim the
    source never made, and would wrongly drop the listing from a «بدون مصعد» search."""
    got = normalize.amenities_from_text("شقة واسعة بموقع مميز قريبة من الخدمات")
    assert got == {}, f"silence must yield no keys at all, got {got}"
    for col in ("elevator", "kitchen", "parking", "furnished"):
        assert col not in got


def test_explicit_negation_is_false() -> None:
    """«غير مؤثثة» IS the source speaking — that is False, not NULL. Verbatim from gudai."""
    assert normalize.amenities_from_text("غير مؤثثة")["furnished"] is False
    assert normalize.amenities_from_text("بدون مصعد")["elevator"] is False


def test_prepared_but_absent_stays_null() -> None:
    """fahadalshahri, verbatim: «مسبح ومصعد مؤسس و3 أدوار». A prepared shaft is not an elevator.
    Neither yes nor no was stated, so the column must stay NULL."""
    got = normalize.amenities_from_text("بتشطيب مودرن ومسبح ومصعد مؤسس و3 أدوار بتصميم عائلي")
    assert "elevator" not in got, f"«مصعد مؤسس» must not claim an elevator, got {got}"


def test_neighbourhood_amenity_is_not_this_property_s() -> None:
    """The third not-a-yes-and-not-a-no case (2026-09-20). Listing prose is full of proximity
    claims about the STREET: verbatim from wslnaa, «قريب من مستشفى السرطان للأطفال ومقابل كمباوند
    معهد الإدارة» and «بالقرب من مركز الملك فهد». Reading amenities out of descriptions is what
    lifted wslnaa from 0 to 35 listings with a filter answer, but a naive scan would also read
    «قريب من مواقف» as "this unit has parking" — a claim about someone else's building. The
    proximity phrase suppresses the token entirely: neither yes nor no, so the column stays NULL."""
    assert normalize.amenities_from_text(
        "قريب من مستشفى السرطان للأطفال ومقابل كمباوند معهد الإدارة") == {}
    assert "parking" not in normalize.amenities_from_text("الموقع مميز وقريب من مواقف عامة")
    assert "elevator" not in normalize.amenities_from_text("بجوار برج فيه مصعد")


def test_the_property_s_own_amenity_still_reads() -> None:
    """The guard must not swallow the real thing. Both verbatim from the live sources."""
    assert normalize.amenities_from_text(
        "يتوفر مدخل للمبنى ومواقف أمامية وخلفية")["parking"] is True
    assert normalize.amenities_from_text(
        "قسم الرجال: خيمة مشب – مجلس – مطبخ – مقلط – صالة – 3 دورات مياه")["kitchen"] is True


def test_appliance_is_not_a_room() -> None:
    """compoundin's chip, verbatim: «Furnished · Kitchen · Washing Machine». A washing machine is
    an appliance; laundry_room is a room. Mapping one to the other would invent a room."""
    got = normalize.amenities_from_text("Furnished · Kitchen · Washing Machine")
    assert got["furnished"] is True and got["kitchen"] is True
    assert "laundry_room" not in got


# ─────────────────────────────── the Saudi layout idiom ────────────────────────────────────────
def test_rooms_idiom_is_read() -> None:
    """aqarnajran «تفاصيل إضافية», verbatim."""
    got = normalize.rooms_from_phrase("3 غرف وصالة ومطبخ مع تشطيب راقٍ، موقع هادئ وقريب من المدارس")
    assert got["bedrooms"] == 3 and got["halls"] == 1


def test_prose_mentioning_rooms_is_not_a_bedroom_count() -> None:
    for prose in ("قريب من المدارس والخدمات",
                  "موقع هادئ ومساحة 320 متر",
                  "شقة مميزة في برج سكني"):
        assert "bedrooms" not in normalize.rooms_from_phrase(prose), prose


# ─────────────────────────────── completion year → age ─────────────────────────────────────────
def test_completion_year_becomes_age() -> None:
    """gudai «عام الاكتمال: 2021». property_age is stored in YEARS fleet-wide (verified against
    aqar, whose live values run 0-16), so the source's own year is restated, not guessed."""
    assert normalize.age_from_completion_year("2021", this_year=2026) == 5
    assert normalize.age_from_completion_year("٢٠٢١", this_year=2026) == 5


def test_age_conversion_refuses_nonsense() -> None:
    for bad in ("", "قريباً", "20211", "1799", "abcd", None):
        assert normalize.age_from_completion_year(bad, this_year=2026) is None
    # a year in the FUTURE is not an age
    assert normalize.age_from_completion_year("2030", this_year=2026) is None


def test_stated_age_still_goes_through_the_fleet_parser() -> None:
    """safera prose, verbatim: «العمر : 16 سنه»."""
    assert normalize.parse_property_age("16 سنه") == 16


# ─────────────────────────────── the parsers actually call this ────────────────────────────────
def test_inblaj_reads_the_label_the_template_prints() -> None:
    """Verbatim «تفاصيل العقار» block from gudai.inblaj.net, 2026-09-20. The old pattern only knew
    «غرف النوم» and returned None here, which is how 0 of 6 gudai rows had a bedroom count."""
    from scrapers.common import inblaj_platform as ip
    block = ("تفاصيل العقار نوع العرض: للبيع نوع العقار: منزل المدينة: الرياض الحي: العليا "
             "عام الاكتمال: 2021 المساحة: 700 م2 عدد الغرف: 7 الحمامات: 4 مؤثثة: لا المرافق: مصعد")
    assert ip._BED_RE.search(block).group(1) == "7"
    assert ip._BATH_RE.search(block).group(1) == "4"
    assert ip._FURN_RE.search(block).group(1) == "لا"
    assert ip._YEAR_RE.search(block).group(1) == "2021"


@pytest.mark.parametrize("label", ["عدد الغرف", "مؤثثة", "عام الاكتمال"])
def test_new_labels_are_in_the_stop_set(label: str) -> None:
    """`_label()` reads "<name> : <value>" up to the NEXT known field name. A label missing from
    that closed set lets the preceding field swallow this row's value."""
    from scrapers.common import inblaj_platform as ip
    assert label in ip._FIELD_NAMES


def test_compoundin_pairs_chips_per_unit_not_page_wide() -> None:
    """Defect 3. The fix must pair chips with units BY POSITION and, when the counts disagree,
    write no amenities at all rather than attach them to the wrong unit."""
    import inspect
    from scrapers.compoundin import run as cin
    src = inspect.getsource(cin.map_units)
    assert "unit_chips" in src and "len(chips) == len(units)" in src, \
        "per-unit chip pairing (with a count guard) must be present"
    assert not re.search(r"amenities_en[\"']?\s*:\s*\(lambda m", src), \
        "the page-wide first-match lambda must be gone"


def test_every_new_parser_writes_af_columns() -> None:
    """Coverage: a parser that stops calling the shared helper silently returns to all-NULL, which
    is exactly the state the owner reported. Assert each one still routes through it."""
    import inspect
    from scrapers.common import inblaj_platform
    from scrapers.aqarnajran import run as najran
    from scrapers.compoundin import run as cin
    from scrapers.fahadalshahri import run as fahad
    assert "amenities_from_text" in inspect.getsource(inblaj_platform.map_listing)
    assert "furnished" in inspect.getsource(inblaj_platform.map_listing)
    assert "rooms_from_phrase" in inspect.getsource(najran.map_listing)
    assert "amenities_from_text" in inspect.getsource(cin.map_units)
    assert "amenities_from_text" in inspect.getsource(fahad.map_listing)


# ─────────────────────────────── a flaky sitemap must not fail the run ─────────────────────────
def test_inblaj_sitemap_fetch_is_retried() -> None:
    """gudai failed twice on 2026-09-20 with «sitemap returned no /property/ urls» while safera and
    alhumaidan — same code, same host — succeeded in the same minute. An empty catalogue is fatal
    by design (a silent zero is indistinguishable from a blocked crawl), so one flaky fetch cost a
    whole day of stale data. The real fetch function is executed here against a transport that
    fails once and then succeeds: it must return the URLs, not give up on the first miss."""
    from scrapers.common import inblaj_platform as ip

    class _R:
        def __init__(self, ok):
            self.status_code = 200 if ok else 503
            self.text = ("<urlset><loc>https://x.inblaj.net/property/a/</loc>"
                         "<loc>https://x.inblaj.net/property/b/</loc></urlset>") if ok else ""

    class _S:
        def __init__(self): self.calls = 0
        def get(self, *_a, **_k):
            self.calls += 1
            return _R(self.calls > 2)      # both spellings miss on the first pass

    sess = _S()
    got = ip.fetch_catalogue(sess, "https://x.inblaj.net")
    assert len(got) == 2, f"a retried fetch must recover the catalogue, got {got}"
    assert sess.calls > 2, "it must actually retry, not succeed by luck on the first call"


def test_a_truly_empty_sitemap_still_returns_empty() -> None:
    """The retry must not paper over a real emptiness — run_platform still has to raise on it."""
    from scrapers.common import inblaj_platform as ip

    class _R:
        status_code = 404
        text = ""

    class _S:
        def get(self, *_a, **_k): return _R()

    assert ip.fetch_catalogue(_S(), "https://x.inblaj.net") == []


# ─────────────────────────── gathern: a published label that reached no column ──────────────────
def test_gathern_balcony_label_is_mapped() -> None:
    """«بلكونة» appears on 1,508 of gathern's 29,820 live listings (measured over the FULL stored
    corpus 2026-09-20) and was captured into additional_info.amenities — but never promoted to
    balcony_terrace, so the Advanced Filter saw 0 across every row.

    The surrounding 2026-07-26 note claims every unmapped column "has NO corresponding label in the
    real data at all". Re-measured, that still holds for kitchen/air_conditioner — gathern's live
    vocabulary carries no مطبخ and no مكيف, so those zeros are HONEST and must stay unmapped rather
    than be guessed from «تلفزيون» or «انترنت». It did not hold for بلكونة. That asymmetry is the
    whole point: an exclusion list measured once decays silently as the source grows."""
    from scrapers.gathern.run import _AMENITY_FLAG_LABELS, _amenity_flags

    assert _AMENITY_FLAG_LABELS.get("balcony_terrace") == "بلكونة"

    # EXECUTE the real mapper against gathern's own verbatim label list.
    got = _amenity_flags(["إضاءة إضافية", "تلفزيون", "انترنت", "مصعد", "موقف سيارة", "بلكونة"])
    assert got["balcony_terrace"] is True
    assert got["elevator"] is True and got["parking"] is True

    # A listing WITHOUT the label must read False, not True — the flags are a closed set over the
    # labels gathern published for that unit, so absence here is the source's own silence.
    assert _amenity_flags(["تلفزيون", "انترنت"])["balcony_terrace"] is False


def test_gathern_does_not_invent_kitchen_or_ac() -> None:
    """The honest zeros. gathern publishes no مطبخ / مكيف label, so these columns must stay
    unmapped — mapping them to a nearby concept would assert a fact the source never published."""
    from scrapers.gathern.run import _AMENITY_FLAG_LABELS
    assert "kitchen" not in _AMENITY_FLAG_LABELS
    assert "air_conditioner" not in _AMENITY_FLAG_LABELS
