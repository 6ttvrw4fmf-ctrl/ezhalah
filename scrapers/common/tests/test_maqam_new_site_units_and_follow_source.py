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
    villa = _unit_page(name="فلة الروضة 101", project="")
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
