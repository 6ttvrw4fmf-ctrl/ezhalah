"""opensooq: the ad PAGE's own ticked amenity list answers the Advanced Filter (🔬 AF engineer, 2026-10-26).

The SERP card has no amenity field and cuts its description at ~125 characters, so 0 of 5 sampled ads were findable
(af-score dry run 40299809948, every ask included «elevator»). The ad page publishes the list in its flight data:
«وسائل الراحة» → «إضافية (2)»: «موقف سيارات», «مصعد» (CI source-reread 40301252058, 14174571). «المناطق المجاورة» is
what is near the building and is never read. Fixture trimmed from that page, in its escaped form.
"""
import scrapers.opensooq.run as R

# As the page carries it: JSON inside a JS string, every quote backslash-escaped.
LIVE = ('self.__next_f.push([1,"{\\"amenitiyTitle\\":\\"مزايا إضافية\\",\\"amenities\\":[{\\"name\\":\\"بلكونة\\"},'
        '{\\"name\\":\\"مصعد\\"},{\\"name\\":\\"كراج\\"}],\\"dynamicTabsSection\\":[{\\"title\\":\\"وسائل الراحة\\",'
        '\\"shownItemNumber\\":5,\\"tabs\\":[{\\"title\\":\\"إضافية (2)\\",\\"shownItemNumber\\":5,\\"items\\":'
        '[\\"موقف سيارات\\",\\"مصعد\\"]},{\\"title\\":\\"المناطق المجاورة (5)\\",\\"shownItemNumber\\":5,\\"items\\":'
        '[\\"سوبر ماركت\\",\\"مسجد\\",\\"صيدلية\\",\\"مدرسة\\",\\"مستشفى\\"]}]}],\\"subCatUrl\\":\\"عقارات\\"}"])')


def test_the_ticked_list_answers_parking_and_elevator():
    assert R.page_amenities(LIVE) == {"parking": True, "elevator": True}


def test_the_nearby_tab_and_the_icon_taxonomy_are_never_the_unit():
    nearby_only = LIVE.replace('\\"موقف سيارات\\",\\"مصعد\\"', '').replace("إضافية (2)", "إضافية (0)")
    nearby_only = nearby_only.replace("سوبر ماركت", "مواقف سيارات")
    assert R.page_amenities(nearby_only) == {}          # section read, nothing ticked → silence, never a «no»


def test_the_last_tab_is_read_too():
    only = LIVE.replace(',{\\"title\\":\\"المناطق المجاورة (5)\\",\\"shownItemNumber\\":5,\\"items\\":'
                        '[\\"سوبر ماركت\\",\\"مسجد\\",\\"صيدلية\\",\\"مدرسة\\",\\"مستشفى\\"]}', '')
    assert "المناطق" not in only
    assert R.page_amenities(only) == {"parking": True, "elevator": True}


def test_a_page_without_the_section_says_nothing():
    assert R.page_amenities("<html>هذا الإعلان غير متوفر</html>") is None
    assert R.page_amenities(None) is None


class _Resp:
    def __init__(self, status, text):
        self.status_code, self.text = status, text


class _S:
    def __init__(self, resp):
        self.resp = resp

    def get(self, url, timeout=None):
        return self.resp


def test_one_get_files_the_pin_and_the_answers(monkeypatch):
    monkeypatch.setattr(R.time, "sleep", lambda *_: None)
    said: dict = {}
    body = LIVE + ' <a href="https://www.google.com/maps/search/?api=1&amp;query=21.567797,39.150801&amp;zoom=15">map</a>'
    pin = R._page_pin(_S(_Resp(200, body)), 1, said)
    assert said == {"answers": {"parking": True, "elevator": True}} and pin
    failed: dict = {}
    R._page_pin(_S(_Resp(503, LIVE)), 1, failed)
    assert failed == {}                                  # a failed read is no statement: the prose fallback stays


def test_the_score_reads_the_same_list_and_never_another_ads_card():
    """🔬 10-26: 13872036 was asked elevator from a related ad's card («شقة للايجار فاخرة مصعد راكب») on the page."""
    from scrapers.common import af_score as A
    card = "شقة للايجار فاخرة مصعد راكب وموقع قريب من جميع الخدمات"
    no_lift = {"jsonld": [{"additionalProperty": A.opensooq_props(LIVE.replace('\\"مصعد\\"]', ']'))}]}
    assert A.structured_says(no_lift, "elevator") is None and A.structured_says(no_lift, "parking") is True
    assert not A.says_yes([card], "elevator", "opensooq", no_lift)
    lift = {"jsonld": [{"additionalProperty": A.opensooq_props(LIVE)}]}
    assert A.says_yes([], "elevator", "opensooq", lift)
