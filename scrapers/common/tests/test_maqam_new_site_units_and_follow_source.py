"""Maqam moved off Nuzul to its own site maqamco.sa (2026-11-07). Pinned to the page shapes measured
that day (trimmed): /units/<n> server-renders the status badge, «رقم الوحدة», the type line and a
Product JSON-LD; /projects carries every project card in its Next.js payload.

  · only «متاحة» is published; «مباعة» / «محجوزة» / «غير متاحة» skip; an off-plan project's unit skips;
  · «السعر عند الطلب» stores price NULL (never 0) and says so; area keeps two decimals;
  · a name that contradicts the type line («فلة …» typed «شقة في عمارة») is never guessed;
  · a project sold WHOLE (no unit page names it) is its own ad at /projects/<n>;
  · the oracle: 404 is gone, a non-«متاحة» badge is gone, an old Nuzul key reads its stored URL;
    a removal is withheld while the control row does not read live.
"""
from __future__ import annotations

import json

import pytest

from scrapers.maqam import run as R


def _unit_page(status="متاحة", unit="A03", name="شقة مقام 18", type_line="شقة في عمارة", project="مقام 18",
               price='<p>1,227,000 ر.س</p>', offer=1227000):
    ld = {"@context": "https://schema.org", "@type": "Product", "name": name, "sku": unit,
          "image": ["https://maqamco.sa/api/public/units/media/9"]}
    if offer:
        ld["offers"] = {"@type": "Offer", "price": offer, "availability": "https://schema.org/InStock"}
    return (f'<html><script type="application/ld+json">{json.dumps([ld], ensure_ascii=False)}</script><main>'
            f'<span>{status}</span><p>رقم الوحدة:</p><p>{unit}</p><h1>{name}</h1><p>{type_line}</p><p>·</p><p>سكني</p>'
            f'<p>ضمن مشروع</p><p>{project}</p><p>حي الرمال، الرياض، المملكة العربية السعودية</p>'
            '<dt>المساحة</dt><dd>189.15000000000001 م²</dd><dt>غرف النوم</dt><dd>3</dd><dt>دورات المياه</dt><dd>4</dd>'
            '<dt>الدور</dt><dd>الدور الأرضي</dd><a href="https://www.google.com/maps/place/x/@24.8,46.7,17z/data=!3d24.84975!4d46.7841667">m</a>'
            f'<p>سعر الوحدة</p>{price}<h2>وحدات أخرى في المشروع</h2><span>مباعة</span><p>رقم الوحدة:</p><p>A02</p>'
            '</main></html>')


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    monkeypatch.setattr(R, "resolve", lambda c, d=None, region_hint=None: {"city_id": 3, "region_id": 1, "city_ar": c})
    monkeypatch.setattr(R, "catalog_district", lambda cid, d: d)


PROJECTS = {"مقام 18": {"id": "1", "title": "مقام 18", "status": "available", "statusLabel": "متاح"},
            "مقام 19": {"id": "3", "title": "مقام 19", "status": "off_plan", "statusLabel": "على الخارطة"}}


def test_an_available_unit_maps_at_the_source_price_and_its_own_url():
    u = R.parse_unit(_unit_page())
    assert u["status"] == "متاحة" and u["unit_number"] == "A03" and u["project"] == "مقام 18"
    (row, cat), why = R.map_unit(91, u, PROJECTS)
    assert not why and cat == "residential"
    assert row["ad_number"] == "MQMU91" and row["listing_url"] == "https://maqamco.sa/units/91"
    assert row["price_total"] == 1227000 and row["transaction_type"] == "Buy" and row["property_type"] == "Apartment"
    assert row["area_m2"] == 189.15 and row["bedrooms"] == 3 and row["floor_number"] == 0
    assert row["additional_info"]["latitude"] and row["additional_info"]["unit_number"] == "A03"


@pytest.mark.parametrize("status", ["مباعة", "محجوزة", "غير متاحة"])
def test_only_available_is_published(status):
    assert R.map_unit(1, R.parse_unit(_unit_page(status=status)), PROJECTS) == (None, f"status_{status}")


def test_off_plan_and_type_conflict_are_never_published():
    assert R.map_unit(93, R.parse_unit(_unit_page(project="مقام 19")), PROJECTS)[1] == "offplan"
    villa = _unit_page(name="فلة الروضة 101")
    assert R.map_unit(27, R.parse_unit(villa), PROJECTS)[1] == "type_conflict"


def test_price_on_request_is_null_never_zero():
    (row, _), _ = R.map_unit(52, R.parse_unit(_unit_page(price="<p>السعر عند الطلب</p>", offer=None)), PROJECTS)
    assert row["price_total"] is R.db.AUTHORITATIVE_NULL and row["additional_info"]["price_on_request"] is True


def test_a_project_sold_whole_is_its_own_ad():
    payload = json.dumps([{"id": "13", "title": "مقام 13 البيع بالكامل", "status": "available", "statusLabel": "متاح",
                           "price": "تبدأ من 11,500,000 ر.س", "hidePrice": False, "neighborhood": "الياسمين",
                           "city": "الرياض", "unitsArea": "780 م²"}], ensure_ascii=False)
    page = f'<script>self.__next_f.push([1,{json.dumps(payload, ensure_ascii=False)}])</script>'
    p = R.projects_from_listing(page)[13]
    (row, _), why = R.map_whole_project(13, p, unit_projects={"مقام 18"})
    assert not why and row["ad_number"] == "MQMP13" and row["listing_url"] == "https://maqamco.sa/projects/13"
    assert row["price_total"] == 11500000 and row["property_type"] == "Building" and row["area_m2"] == 780
    assert R.map_whole_project(13, p, unit_projects={"مقام 13 البيع بالكامل"})[1] == "project_with_units"


def test_the_oracle_reads_the_card_link_and_needs_a_live_control():
    pages = {"https://maqamco.sa/units/91": (200, _unit_page()),
             "https://maqamco.sa/units/92": (200, _unit_page(status="مباعة")),
             "https://maqamco.sa/units/5": (404, ""),
             "https://property.maqamco.sa/properties/42571": (404, "رمز الخطأ 404")}
    st = lambda url: pages.get(url, (None, ""))  # noqa: E731
    v = R._make_verify_gone({"ad_number": "MQMU91"}, status=st)
    assert v("MQMU91")[0] == "live"
    assert v("MQMU92")[0] == "gone"                     # retired in place
    assert v("MQMU5")[0] == "gone"
    assert v("MQM42571")[0] == "gone"                   # the old Nuzul card: its own link is a 404
    assert v("MQMU77")[0] == "unknown"                  # unreadable is no opinion
    blind = R._make_verify_gone({"ad_number": "MQMU5"}, status=st)
    assert blind("MQM42571")[0] == "unknown", "no live control: no removal"


def test_num_reads_the_first_figure_only():
    assert R._num("ر.س 1,227,000") == 1227000 and R._num("1,227,000 ر.س") == 1227000
    assert R._num("174.32 م²") == 174.32 and R._num("السعر عند الطلب") is None


class _Q:
    def __init__(self, log, rows):
        self.log, self.rows = log, rows

    def __getattr__(self, name):
        def chain(*a, **k):
            if name in ("update", "insert"):
                self.log.append((name, a[0]))
            if name == "in_":
                self.log.append(("in_", list(a[1])))
            return self
        return chain


def _fake_db(monkeypatch, rows, fail_evidence=False):
    log: list = []
    monkeypatch.setattr(R.db, "sb", lambda: _Q(log, rows))

    def execute(q, what=""):
        if what.endswith("follow_source_select"):
            return type("X", (), {"data": rows})()
        if fail_evidence and what.startswith("ops_stale"):
            raise RuntimeError("evidence table down")
        return type("X", (), {"data": []})()
    monkeypatch.setattr(R.db, "_execute", execute)
    return log


OLD = [{"ad_number": "MQM42572", "listing_url": "https://property.maqamco.sa/properties/42572",
        "district_ar": "حي الرمال", "source_capture": {"unit_number": "A03"}},
       {"ad_number": "MQM51641", "listing_url": "https://property.maqamco.sa/properties/51641",
        "district_ar": "حي النرجس", "source_capture": {"unit_number": "A01"}}]
CONTROLS = [{"ad_number": "MQMU91", "listing_url": "https://maqamco.sa/units/91"},
            {"ad_number": "MQMU90", "listing_url": "https://maqamco.sa/units/90"}]


def _status_map(controls_live=True, old_404=True):
    def st(url):
        if "/units/" in url:
            return (200, _unit_page()) if controls_live else (None, "")
        return (404, "") if old_404 and "42572" in url else (200, "")
    return st


def test_follow_source_hides_only_proven_rows_with_evidence(monkeypatch):
    log = _fake_db(monkeypatch, OLD)
    h, k, why = R.follow_source_hide(R.RES_TABLE, set(), CONTROLS, {("حي الرمال", "A03"): "MQMU91"}, status=_status_map())
    assert (h, k, why) == (1, 1, "done")
    assert ("in_", ["MQM42572"]) in log
    ev = next(v for n, v in log if n == "insert")
    assert "same unit A03 now served as MQMU91" in ev[0]["note"] and ev[1]["verdict"] == "UNKNOWN"


def test_follow_source_needs_two_live_controls_and_never_hides_without_evidence(monkeypatch):
    log = _fake_db(monkeypatch, OLD)
    assert R.follow_source_hide(R.RES_TABLE, set(), CONTROLS[:1], {}, status=_status_map())[0] == 0
    assert R.follow_source_hide(R.RES_TABLE, set(), CONTROLS, {}, status=_status_map(controls_live=False))[0] == 0
    assert not [x for x in log if x[0] == "update"]
    log = _fake_db(monkeypatch, OLD, fail_evidence=True)
    assert R.follow_source_hide(R.RES_TABLE, set(), CONTROLS, {}, status=_status_map())[0] == 0
    assert not [x for x in log if x[0] == "update"]


def test_a_unit_whose_project_has_no_card_is_never_published():
    assert R.map_unit(5, R.parse_unit(_unit_page(project="مقام 21")), PROJECTS)[1] == "project_unmatched"
    assert R.projects_from_listing('<script>self.__next_f.push([1,"[{\\"id\\":\\"1\\",\\"statusLabel"])</script>') == {}


def test_complete_needs_every_listed_page():
    w = {"units": {1: {}}, "listed": 1, "projects": {1: {}}, "listed_projects": 1, "bad": {}}
    assert R.complete(w)
    assert not R.complete({**w, "bad": {"unit_unparsed": 1}}) and not R.complete({**w, "listed": 2})


def _no_map(page: str) -> str:
    import re
    return re.sub(r'<a href="https://www\.google\.com/maps[^"]*">m</a>', "", page)


def test_a_unit_page_without_a_map_link_takes_its_projects_own_pin():
    """Four-place rule, place 4 (the parent page): مقام 17's unit pages carry no Maps link (re-read
    42451335417, 2026-11-08); the unit takes the pin its PROJECT's mapUrl publishes, in any shape."""
    projects = {"مقام 18": {**PROJECTS["مقام 18"], "mapUrl": "https://www.google.com/maps?q=24.8455,46.6512"}}
    u = R.parse_unit(_no_map(_unit_page()))
    assert u["pin"] is None
    (row, _), _ = R.map_unit(114, u, projects)
    assert (row["additional_info"]["latitude"], row["additional_info"]["longitude"]) == (24.8455, 46.6512)


def test_a_units_own_pin_wins_and_no_map_anywhere_stays_unpinned():
    projects = {"مقام 18": {**PROJECTS["مقام 18"], "mapUrl": "https://www.google.com/maps?q=24.1111,46.2222"}}
    (row, _), _ = R.map_unit(91, R.parse_unit(_unit_page()), projects)
    assert row["additional_info"]["latitude"] == 24.84975                       # the unit's own link
    (row, _), _ = R.map_unit(114, R.parse_unit(_no_map(_unit_page())), PROJECTS)  # project has no mapUrl
    assert "latitude" not in row["additional_info"]


def test_a_whole_project_reads_a_q_shaped_map_url():
    p = {"id": "13", "title": "مقام 13 البيع بالكامل", "status": "available", "statusLabel": "متاح",
         "price": "11,500,000", "neighborhood": "الياسمين", "city": "الرياض",
         "mapUrl": "https://maps.google.com/?q=24.8231,46.6402"}
    (row, _), _ = R.map_whole_project(13, p, unit_projects=set())
    assert row["additional_info"]["latitude"] == 24.8231


class _Hop:
    def __init__(self, status, loc=None):
        self.status_code, self.headers, self.text = status, ({"location": loc} if loc else {}), ""


def test_a_short_map_link_is_resolved_honestly_once_per_project(monkeypatch):
    """CodeRabbit (PR #11247): the short-link hop uses our own bot UA (no impersonation, no proxy), keeps the
    honest client's one-request-per-gap clock, reads only the redirect, and runs ONCE per link per run."""
    R._SHORT_PIN_CACHE.clear()
    calls, sleeps = [], []
    def get(url, headers=None, allow_redirects=True, timeout=None):
        calls.append((url, headers, allow_redirects))
        return _Hop(302, "https://www.google.com/maps/place/x/@24.812345,46.623456,17z")
    monkeypatch.setattr(R.cc, "get", get)
    monkeypatch.setattr(R.time, "sleep", lambda d: sleeps.append(d))
    R.H._last[0] = R.time.time()
    p = {"mapUrl": "https://maps.app.goo.gl/AbCdEf123"}
    assert R._project_pin(p) == R._project_pin(p)
    assert len(calls) == 1
    assert calls[0][1] == {"User-Agent": R.H.UA} and calls[0][2] is False
    assert sleeps and sleeps[0] > 0                                     # waited for the shared gap


def test_a_wall_on_the_hop_stops_and_leaves_no_pin(monkeypatch):
    R._SHORT_PIN_CACHE.clear()
    monkeypatch.setattr(R.cc, "get", lambda *a, **k: _Hop(429))
    monkeypatch.setattr(R.time, "sleep", lambda d: None)
    assert R._project_pin({"mapUrl": "https://maps.app.goo.gl/Wall999"}) is None
