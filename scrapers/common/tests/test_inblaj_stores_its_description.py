"""inblaj.net variant B (safera) stores its «الوصف» prose and reads it with the ONE reader (🔬 2026-11-06).

The texts below are the visible text of two live safera pages, re-read through net.http_get on 2026-11-06 (the licence
number is the REGA ad licence the page prints). Before this every safera row had description = NULL (backlog 1373,
af-score miss safera:12390416), so the nightly text reader never saw these ads.
"""
import sys

sys.path.insert(0, ".")

from scrapers.common import inblaj_platform as I  # noqa: E402

REST_HOUSE = ("الوصف 📍 استراحة للبيع شمال بريدة – حي النور استراحة قسمين على مساحة 2144م² (67×32)، شارع شرقي 20م بطول 32م. "
              "بها بير 🔹 قسم الرجال: خيمة مشب – مجلس – مطبخ – مقلط – صالة – 3 دورات مياه 🔹 قسم النساء: صالة – مطبخ – "
              "غرفتين نوم – خيمة مشب – ألعاب أطفال ✨ تصميم واسع وموقع هادئ 💰 البيع حد مليون و600 الف ماتقبل البنك 📋 ترخيص : "
              "6200695758 📍 المنطقة: القصيم – بريدة &nbsp; Playlist Sample Video المميزات عروض مشابهه .elementor-2857")
VILLA = ("الوصف فيلا فاخرة الموقع : بريدة &#8211; حي النهضه المساحه : ٦٢٧.٣٧م شارع : شمال ١٥م العمر : 16 سنه تتكون من : "
         "مجلس رجال ودورة مياه ، مقلط ، صاله ، مجلس نساء، دوره مياه . ملحق خارجي ودوره مياه ، غرفة سائق ، مسطحات خضراء . "
         "الدور الاول : اربع اجنحه بدورات مياه ، صاله واسعه السطح : غرفه للغسيل غرفه ودوره مياه الحد مليون و٧٥٠ الف ___ "
         "رقم الترخيص : 1100043722 Playlist Sample Video المميزات عروض مشابهه")


def test_the_prose_is_stored_without_the_similar_ads_tail_or_the_licence():
    d = I.description_of(REST_HOUSE)
    assert d and "قسم الرجال" in d and "مطبخ" in d
    assert "عروض مشابهه" not in d and "Playlist" not in d and "6200695758" not in d


def test_the_one_reader_answers_from_it():
    d = I.description_of(VILLA)
    got = I.amenity_answers(d, I.PROSE_COLS, {"balcony": "balcony_terrace"})
    assert got == {"driver_room": True, "laundry_room": True}


def test_variant_a_without_prose_stores_nothing():
    assert I.description_of("تفاصيل العقار نوع العرض: للبيع نوع العقار: فيلا المرافق: مسبح، غرفة خادمة") is None


def test_the_old_matcher_no_longer_reads_the_prose():
    import inspect
    src = inspect.getsource(I.map_listing)
    assert "amenity_answers(desc" in src and 'row["description"] = desc' in src
    assert "amenities_from_text(dm" not in src


def test_line_breaks_survive_into_the_stored_description():
    """«بدون مكيفات<br>ومطبخ»: two lines, two facts — the break must reach the reader and the stored text."""
    html = "<div>الوصف<br>شقة بدون مكيفات<br>ومطبخ راكب</div><div>المميزات</div>"
    d = I.description_of(I.lines_text(html))
    assert d == "شقة بدون مكيفات\nومطبخ راكب"
    assert I.amenity_answers(d, I.PROSE_COLS, {}).get("kitchen") is True


def test_short_prose_stops_at_the_first_section():
    d = I.description_of(I.lines_text("<p>الوصف</p><p>فيلا مع مسبح</p><p>Playlist Sample Video</p>"))
    assert d == "فيلا مع مسبح"
