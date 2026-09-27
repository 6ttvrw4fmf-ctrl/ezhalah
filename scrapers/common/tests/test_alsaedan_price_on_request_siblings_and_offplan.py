"""alsaedan's traps: a platform that HOLDS prices and publishes «السعر عند الطلب» instead, a page
whose sibling-unit block prints other units' numbers, an off-plan project marked only on its project
card, a unit sold under two purposes at once, and a de-listed unit that loses its page to a 302.

Fixtures are VERBATIM HTML captured live 2026-09-24 from alsaedan.com — a two-card slab of
/sales?view=units&purpose=sale&available=1 together with the `asp-count` it printed, single cards
for the land / shop / sold / off-plan shapes, and the al-liwan + deem-10 project cards (inline
<svg> icons stripped; nothing the code reads was touched). Assertions execute the SHIPPING
functions: run.parse_unit_cards, run.parse_projects, run.map_listing, run._specs, run._signal.
Offline: only to_catalog / find_district_in_text are stubbed (they read loc_catalog_* over the
network); no database is touched.

MUTATION-VERIFIED 2026-09-24 — each mutant was applied to scrapers/alsaedan/run.py, this suite run,
the mutant reverted, and the suite run again:
  · MUTANT A, the "stale price never clears" defect:
        absent = db.AUTHORITATIVE_NULL if on_request else None   →   absent = None
    → 2 failed, 49 passed. Killed by test_price_on_request_is_an_authoritative_null_not_a_silent_none
    and test_no_rent_row_carries_a_period_because_the_source_states_none.
    NOTE, because it is the point: test_the_evidence_records_the_absence_as_the_sources_own_statement
    SURVIVED this mutant — price_evidence still says authoritative_absent=True while the column
    silently stopped clearing. The evidence is an audit trail, not the guard; the COLUMN is asserted.
  · MUTANT B, the sibling-contamination defect — parse_unit_cards reading the page instead of each
    card's own container:
        specs = _one(ASP_USPECS, c)   →   specs = _one(ASP_USPECS, page)
    → 1 failed, 50 passed. Killed by test_a_siblings_area_is_never_read_as_this_units_area (both
    cards took the first card's 128.58 m²).
  Restored: 51 passed.

Run: python -m pytest scrapers/common/tests/test_alsaedan_price_on_request_siblings_and_offplan.py -v
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scrapers.alsaedan import run as R  # noqa: E402

# ── VERBATIM CAPTURES (alsaedan.com, 2026-09-24) ─────────────────────────────────────
# The page's own printed count plus TWO ADJACENT unit cards — 128.58 m² / 3 rooms beside
# 137.19 m² / 3 rooms. This slab IS the sibling trap: a parser that reads the page instead of the
# card gives one unit the other's area.
TWO_CARDS = """<div class="asp-count">
                                                    283 وحدة متاحة
                                            </div>
<article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/3197"
                    style="background-image:url('/uploads/projects/deem-10/17-1.jpg')"                    aria-label="شقة KHR-DM10-AP-A10">
                    <button type="button" class="asp-fav" data-fav="u3197"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/deem-10">ديم 10</a>
                             — حي الحمراء، الخبر                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/3197">
                            شقة — وحدة KHR-DM10-AP-A10                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>128.58 م²</span>                        <span>3 غرف</span>                        <span>3 دورة مياه</span>                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/3197"
                           onclick="aspTrack('sales_unit_opened',52)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>
                    
            <article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/3229"
                    style="background-image:url('/uploads/projects/deem-11/18.jpg')"                    aria-label="شقة KHR-DM11-AP-A50">
                    <button type="button" class="asp-fav" data-fav="u3229"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/deem-11">ديم 11</a>
                             — حي الحمراء، الخبر                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/3229">
                            شقة — وحدة KHR-DM11-AP-A50                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>137.19 م²</span>                        <span>3 غرف</span>                        <span>3 دورة مياه</span>                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/3229"
                           onclick="aspTrack('sales_unit_opened',53)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# A sama-najd plot: area with a THOUSANDS SEPARATOR and no rooms/bathrooms spans at all.
CARD_LAND = """<article class="asp-ucard">
                <a class="asp-uphoto none" href="https://alsaedan.com/sales/unit/4715"
                                      aria-label="أرض سكنية RIY-LAND-B4-22">
                    <button type="button" class="asp-fav" data-fav="u4715"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/sama-najd">سما نجد</a>
                             — الرياض                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/4715">
                            أرض سكنية — وحدة RIY-LAND-B4-22                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>1,992.35 م²</span>                                                                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/4715"
                           onclick="aspTrack('sales_unit_opened',63)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# A rent-side shop («محل» → Shop → the commercial table).
CARD_SHOP_RENT = """<article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/3411"
                    style="background-image:url('/uploads/projects/asal-plaza/2.jpg')"                    aria-label="محل asal-18">
                    <button type="button" class="asp-fav" data-fav="u3411"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/assal-center">آصال بلازا</a>
                             — حي طويق، الرياض                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/3411">
                            محل — وحدة asal-18                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>91.00 م²</span>                                                                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/3411"
                           onclick="aspTrack('sales_unit_opened',57)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# A SOLD unit, from the list crawled without `available=1`: the source's own `asp-pill off`.
CARD_SOLD = """<article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/69"
                    style="background-image:url('/uploads/projects/legacy/1-deem1-deem1.jpg')"                    aria-label="شقة 1">
                    <button type="button" class="asp-fav" data-fav="u69"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/deem-01">ديم-01</a>
                             — حي القادسية، الرياض                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/69">
                            شقة — وحدة 1                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>125.00 م²</span>                        <span>3 غرف</span>                                                <span>الدور 1</span>                        <span class="asp-pill off">مباعة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/69"
                           onclick="aspTrack('sales_unit_opened',20)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# An al-liwan unit — indistinguishable from a live one on the card. Only its PROJECT says
# «قيد الإنشاء».
CARD_ALLIWAN = """<article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/3314"
                    style="background-image:url('/uploads/projects/al-liwan-residential/01-entrance-foyer-p03.jpg')"                    aria-label="فيلا DRH-LIWAN-TWN-39">
                    <button type="button" class="asp-fav" data-fav="u3314"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/al-liwan">الليوان السكني</a>
                             — حي الرحاب، الرياض                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/3314">
                            فيلا — وحدة DRH-LIWAN-TWN-39                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>374.00 م²</span>                        <span>3 غرف</span>                        <span>6 دورة مياه</span>                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/3314"
                           onclick="aspTrack('sales_unit_opened',55)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# The two project cards: al-liwan carries `st-construction`, deem-10 `st-partial`.
PROJECT_ALLIWAN = """<article class="asp-card">
                <div class="asp-photo "
                      style="background-image:url('/uploads/projects/al-liwan-residential/01-entrance-foyer-p03.jpg')"                      role="img" aria-label="الليوان السكني">
                                        <span class="asp-tag2">مجتمعات سكنيه</span>                                                                <span class="asp-status st-construction">قيد الإنشاء</span>
                                        <button type="button" class="asp-fav" data-fav="p55"
                            aria-label="حفظ المشروع" title="حفظ">&#9825;</button>
                </div>

                <div class="asp-in-card">
                    <h2 class="asp-name"><a href="https://alsaedan.com/sales/al-liwan">الليوان السكني</a></h2>
                    <div class="asp-where">حي الرحاب، الرياض</div>
                    
                    
                                            <div class="asp-price none">السعر عند الطلب</div>
                    
                    <div class="asp-facts">
                        <span class="asp-fact ok">
                            
                            74 وحدة متاحة
                        </span>
                        <span class="asp-fact">374.00 – 619.00 م²</span>                        <span class="asp-fact">3 – 5 غرف</span>                                                
                                                    <span class="asp-fact warranty">بضمان</span>
                                            </div>

                    <div class="asp-cta">
                        <a class="main" href="https://alsaedan.com/sales/al-liwan"
                           onclick="aspTrack('sales_project_opened',55)">استكشف المشروع</a>
                                                    <a class="alt" target="_blank" rel="noopener"
                               href="https://www.google.com/maps/search/?api=1&query=24.7861125,46.5639844"
                               onclick="aspTrack('sales_map_opened',55)"
                               aria-label="عرض على الخريطة" title="عرض على الخريطة">&#9678;</a>
                                            </div>
                </div>
            </article>"""

PROJECT_DEEM10 = """<article class="asp-card">
                <div class="asp-photo "
                      style="background-image:url('/uploads/projects/deem-10/17-1.jpg')"                      role="img" aria-label="ديم 10">
                                        <span class="asp-tag2">مجتمعات سكنيه</span>                                                                <span class="asp-status st-partial">مباع جزئي</span>
                                        <button type="button" class="asp-fav" data-fav="p52"
                            aria-label="حفظ المشروع" title="حفظ">&#9825;</button>
                </div>

                <div class="asp-in-card">
                    <h2 class="asp-name"><a href="https://alsaedan.com/sales/deem-10">ديم 10</a></h2>
                    <div class="asp-where">حي الحمراء، الخبر</div>
                    
                    
                                            <div class="asp-price none">السعر عند الطلب</div>
                    
                    <div class="asp-facts">
                        <span class="asp-fact ok">
                            
                            90 وحدة متاحة
                        </span>
                        <span class="asp-fact">127.54 – 342.73 م²</span>                        <span class="asp-fact">2 – 3 غرف</span>                                                
                                                    <span class="asp-fact warranty">بضمان</span>
                                            </div>

                    <div class="asp-cta">
                        <a class="main" href="https://alsaedan.com/sales/deem-10"
                           onclick="aspTrack('sales_project_opened',52)">استكشف المشروع</a>
                                                    <a class="alt" target="_blank" rel="noopener"
                               href="https://www.google.com/maps/search/?api=1&query=26.2330375,50.2012344"
                               onclick="aspTrack('sales_map_opened',52)"
                               aria-label="عرض على الخريطة" title="عرض على الخريطة">&#9678;</a>
                                            </div>
                </div>
            </article>"""

# The page's own printed count plus TWO ADJACENT unit cards from the live grid — unit 3197
# (deem-10, 128.58 m²) beside unit 3229 (deem-11, 137.19 m²). This slab IS the sibling trap: a
# parser that reads the PAGE instead of each card's own `asp-uspecs` hands one unit the other's
# numbers, and the same for its project, its cover and its URL.
TWO_CARDS = """<div class="asp-count">
                                                    283 وحدة متاحة
                                            </div>
<article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/3197"
                    style="background-image:url('/uploads/projects/deem-10/17-1.jpg')"                    aria-label="شقة KHR-DM10-AP-A10">
                    <button type="button" class="asp-fav" data-fav="u3197"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/deem-10">ديم 10</a>
                             — حي الحمراء، الخبر                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/3197">
                            شقة — وحدة KHR-DM10-AP-A10                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>128.58 م²</span>                        <span>3 غرف</span>                        <span>3 دورة مياه</span>                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/3197"
                           onclick="aspTrack('sales_unit_opened',52)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>
                    
            <article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/3229"
                    style="background-image:url('/uploads/projects/deem-11/18.jpg')"                    aria-label="شقة KHR-DM11-AP-A50">
                    <button type="button" class="asp-fav" data-fav="u3229"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/deem-11">ديم 11</a>
                             — حي الحمراء، الخبر                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/3229">
                            شقة — وحدة KHR-DM11-AP-A50                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>137.19 م²</span>                        <span>3 غرف</span>                        <span>3 دورة مياه</span>                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/3229"
                           onclick="aspTrack('sales_unit_opened',53)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# A sama-najd plot: an area with a THOUSANDS SEPARATOR and no rooms/bathrooms spans at all.
CARD_LAND = """<article class="asp-ucard">
                <a class="asp-uphoto none" href="https://alsaedan.com/sales/unit/4715"
                                      aria-label="أرض سكنية RIY-LAND-B4-22">
                    <button type="button" class="asp-fav" data-fav="u4715"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/sama-najd">سما نجد</a>
                             — الرياض                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/4715">
                            أرض سكنية — وحدة RIY-LAND-B4-22                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>1,992.35 م²</span>                                                                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/4715"
                           onclick="aspTrack('sales_unit_opened',63)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# A rent-side shop («محل» → Shop → the commercial table).
CARD_SHOP_RENT = """<article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/3411"
                    style="background-image:url('/uploads/projects/asal-plaza/2.jpg')"                    aria-label="محل asal-18">
                    <button type="button" class="asp-fav" data-fav="u3411"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/assal-center">آصال بلازا</a>
                             — حي طويق، الرياض                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/3411">
                            محل — وحدة asal-18                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>91.00 م²</span>                                                                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/3411"
                           onclick="aspTrack('sales_unit_opened',57)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# A SOLD unit, from the list crawled WITHOUT `available=1`: the source's own `asp-pill off`. It
# also carries «الدور 1», the floor span that no available card currently prints.
CARD_SOLD = """<article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/69"
                    style="background-image:url('/uploads/projects/legacy/1-deem1-deem1.jpg')"                    aria-label="شقة 1">
                    <button type="button" class="asp-fav" data-fav="u69"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/deem-01">ديم-01</a>
                             — حي القادسية، الرياض                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/69">
                            شقة — وحدة 1                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>125.00 م²</span>                        <span>3 غرف</span>                                                <span>الدور 1</span>                        <span class="asp-pill off">مباعة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/69"
                           onclick="aspTrack('sales_unit_opened',20)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# An al-liwan unit. On the card it is indistinguishable from a live one — only its PROJECT card
# says «قيد الإنشاء».
CARD_ALLIWAN = """<article class="asp-ucard">
                <a class="asp-uphoto " href="https://alsaedan.com/sales/unit/3314"
                    style="background-image:url('/uploads/projects/al-liwan-residential/01-entrance-foyer-p03.jpg')"                    aria-label="فيلا DRH-LIWAN-TWN-39">
                    <button type="button" class="asp-fav" data-fav="u3314"
                            onclick="event.preventDefault()"
                            aria-label="حفظ الوحدة" title="حفظ">&#9825;</button>
                </a>

                <div class="asp-ubody">
                    <div class="asp-uproj">
                                                    <a href="https://alsaedan.com/sales/al-liwan">الليوان السكني</a>
                             — حي الرحاب، الرياض                                             </div>

                    <h2 class="asp-uname">
                        <a href="https://alsaedan.com/sales/unit/3314">
                            فيلا — وحدة DRH-LIWAN-TWN-39                        </a>
                    </h2>

                    <div class="asp-uspecs">
                        <span>374.00 م²</span>                        <span>3 غرف</span>                        <span>6 دورة مياه</span>                                                <span class="asp-pill ok">متاحة</span>
                    </div>

                    <div class="asp-ufoot">
                        
                                                    <span class="asp-uprice none">السعر عند الطلب</span>
                                                <a class="asp-ubtn" href="https://alsaedan.com/sales/unit/3314"
                           onclick="aspTrack('sales_unit_opened',55)">تفاصيل الوحدة</a>
                    </div>
                </div>
            </article>"""

# Six real project cards: al-liwan (st-construction), deem-10 / deem-11 / sama-najd /
# assal-center (st-partial) and deem-01 (st-full). Inline <svg> icons stripped; nothing the code
# reads was touched. Every project card also prints an AREA RANGE («374.00 – 619.00 م²») and
# its own «السعر عند الطلب» — neither may ever reach a unit row.
PROJECTS = """<article class="asp-card">
                <div class="asp-photo "
                      style="background-image:url('/uploads/projects/al-liwan-residential/01-entrance-foyer-p03.jpg')"                      role="img" aria-label="الليوان السكني">
                                        <span class="asp-tag2">مجتمعات سكنيه</span>                                                                <span class="asp-status st-construction">قيد الإنشاء</span>
                                        <button type="button" class="asp-fav" data-fav="p55"
                            aria-label="حفظ المشروع" title="حفظ">&#9825;</button>
                </div>

                <div class="asp-in-card">
                    <h2 class="asp-name"><a href="https://alsaedan.com/sales/al-liwan">الليوان السكني</a></h2>
                    <div class="asp-where">حي الرحاب، الرياض</div>
                    
                    
                                            <div class="asp-price none">السعر عند الطلب</div>
                    
                    <div class="asp-facts">
                        <span class="asp-fact ok">
                            
                            74 وحدة متاحة
                        </span>
                        <span class="asp-fact">374.00 – 619.00 م²</span>                        <span class="asp-fact">3 – 5 غرف</span>                                                
                                                    <span class="asp-fact warranty">بضمان</span>
                                            </div>

                    <div class="asp-cta">
                        <a class="main" href="https://alsaedan.com/sales/al-liwan"
                           onclick="aspTrack('sales_project_opened',55)">استكشف المشروع</a>
                                                    <a class="alt" target="_blank" rel="noopener"
                               href="https://www.google.com/maps/search/?api=1&query=24.7861125,46.5639844"
                               onclick="aspTrack('sales_map_opened',55)"
                               aria-label="عرض على الخريطة" title="عرض على الخريطة">&#9678;</a>
                                            </div>
                </div>
            </article>
<article class="asp-card">
                <div class="asp-photo "
                      style="background-image:url('/uploads/projects/deem-10/17-1.jpg')"                      role="img" aria-label="ديم 10">
                                        <span class="asp-tag2">مجتمعات سكنيه</span>                                                                <span class="asp-status st-partial">مباع جزئي</span>
                                        <button type="button" class="asp-fav" data-fav="p52"
                            aria-label="حفظ المشروع" title="حفظ">&#9825;</button>
                </div>

                <div class="asp-in-card">
                    <h2 class="asp-name"><a href="https://alsaedan.com/sales/deem-10">ديم 10</a></h2>
                    <div class="asp-where">حي الحمراء، الخبر</div>
                    
                    
                                            <div class="asp-price none">السعر عند الطلب</div>
                    
                    <div class="asp-facts">
                        <span class="asp-fact ok">
                            
                            90 وحدة متاحة
                        </span>
                        <span class="asp-fact">127.54 – 342.73 م²</span>                        <span class="asp-fact">2 – 3 غرف</span>                                                
                                                    <span class="asp-fact warranty">بضمان</span>
                                            </div>

                    <div class="asp-cta">
                        <a class="main" href="https://alsaedan.com/sales/deem-10"
                           onclick="aspTrack('sales_project_opened',52)">استكشف المشروع</a>
                                                    <a class="alt" target="_blank" rel="noopener"
                               href="https://www.google.com/maps/search/?api=1&query=26.2330375,50.2012344"
                               onclick="aspTrack('sales_map_opened',52)"
                               aria-label="عرض على الخريطة" title="عرض على الخريطة">&#9678;</a>
                                            </div>
                </div>
            </article>
<article class="asp-card">
                <div class="asp-photo "
                      style="background-image:url('/uploads/projects/deem-11/18.jpg')"                      role="img" aria-label="ديم 11">
                                        <span class="asp-tag2">مجتمعات سكنيه</span>                                                                <span class="asp-status st-partial">مباع جزئي</span>
                                        <button type="button" class="asp-fav" data-fav="p53"
                            aria-label="حفظ المشروع" title="حفظ">&#9825;</button>
                </div>

                <div class="asp-in-card">
                    <h2 class="asp-name"><a href="https://alsaedan.com/sales/deem-11">ديم 11</a></h2>
                    <div class="asp-where">حي الحمراء، الخبر</div>
                    
                    
                                            <div class="asp-price none">السعر عند الطلب</div>
                    
                    <div class="asp-facts">
                        <span class="asp-fact ok">
                            
                            69 وحدة متاحة
                        </span>
                        <span class="asp-fact">124.98 – 314.82 م²</span>                        <span class="asp-fact">2 – 3 غرف</span>                                                
                                                    <span class="asp-fact warranty">بضمان</span>
                                            </div>

                    <div class="asp-cta">
                        <a class="main" href="https://alsaedan.com/sales/deem-11"
                           onclick="aspTrack('sales_project_opened',53)">استكشف المشروع</a>
                                                    <a class="alt" target="_blank" rel="noopener"
                               href="https://www.google.com/maps/search/?api=1&query=26.2306125,50.2021719"
                               onclick="aspTrack('sales_map_opened',53)"
                               aria-label="عرض على الخريطة" title="عرض على الخريطة">&#9678;</a>
                                            </div>
                </div>
            </article>
<article class="asp-card">
                <div class="asp-photo none"
                                          role="img" aria-label="سما نجد">
                    <span class="ph">سما نجد</span>                    <span class="asp-tag2">مخططات مطورة</span>                                                                <span class="asp-status st-partial">مباع جزئي</span>
                                        <button type="button" class="asp-fav" data-fav="p63"
                            aria-label="حفظ المشروع" title="حفظ">&#9825;</button>
                </div>

                <div class="asp-in-card">
                    <h2 class="asp-name"><a href="https://alsaedan.com/sales/sama-najd">سما نجد</a></h2>
                    <div class="asp-where">الرياض</div>
                    
                    
                                            <div class="asp-price none">السعر عند الطلب</div>
                    
                    <div class="asp-facts">
                        <span class="asp-fact ok">
                            
                            22 وحدة متاحة
                        </span>
                        <span class="asp-fact">286.00 – 8,064.00 م²</span>                                                                        
                                            </div>

                    <div class="asp-cta">
                        <a class="main" href="https://alsaedan.com/sales/sama-najd"
                           onclick="aspTrack('sales_project_opened',63)">استكشف المشروع</a>
                                            </div>
                </div>
            </article>
<article class="asp-card">
                <div class="asp-photo "
                      style="background-image:url('/uploads/projects/asal-plaza/2.jpg')"                      role="img" aria-label="آصال بلازا">
                                        <span class="asp-tag2">مشاريع تجاريه</span>                                                                <span class="asp-status st-partial">مؤجّر جزئي</span>
                                        <button type="button" class="asp-fav" data-fav="p57"
                            aria-label="حفظ المشروع" title="حفظ">&#9825;</button>
                </div>

                <div class="asp-in-card">
                    <h2 class="asp-name"><a href="https://alsaedan.com/sales/assal-center">آصال بلازا</a></h2>
                    <div class="asp-where">حي طويق، الرياض</div>
                    
                    
                                            <div class="asp-price none">السعر عند الطلب</div>
                    
                    <div class="asp-facts">
                        <span class="asp-fact ok">
                            
                            وحدتان متاحتان
                        </span>
                        <span class="asp-fact">58.00 – 6,000.00 م²</span>                                                                            <span class="asp-fact">نوعان</span>
                                                
                                                    <span class="asp-fact warranty">بضمان</span>
                                            </div>

                    <div class="asp-cta">
                        <a class="main" href="https://alsaedan.com/sales/assal-center"
                           onclick="aspTrack('sales_project_opened',57)">استكشف المشروع</a>
                                                    <a class="alt" target="_blank" rel="noopener"
                               href="https://www.google.com/maps/search/?api=1&query=24.5546306,46.5166485"
                               onclick="aspTrack('sales_map_opened',57)"
                               aria-label="عرض على الخريطة" title="عرض على الخريطة">&#9678;</a>
                                            </div>
                </div>
            </article>
<article class="asp-card">
                <div class="asp-photo "
                      style="background-image:url('/uploads/projects/legacy/1-deem1-deem1.jpg')"                      role="img" aria-label="ديم-01">
                                        <span class="asp-tag2">مجتمعات سكنيه</span>                                                                <span class="asp-status st-full">مباع بالكامل</span>
                                        <button type="button" class="asp-fav" data-fav="p20"
                            aria-label="حفظ المشروع" title="حفظ">&#9825;</button>
                </div>

                <div class="asp-in-card">
                    <h2 class="asp-name"><a href="https://alsaedan.com/sales/deem-01">ديم-01</a></h2>
                    <div class="asp-where">حي القادسية، الرياض</div>
                    
                    
                    
                    <div class="asp-facts">
                        <span class="asp-fact off">
                            
                            لا يوجد متاح حالياً
                        </span>
                        <span class="asp-fact">125.00 – 375.00 م²</span>                        <span class="asp-fact">3 غرف</span>                                                    <span class="asp-fact">نوعان</span>
                                                
                                                    <span class="asp-fact warranty">بضمان</span>
                                            </div>

                    <div class="asp-cta">
                        <a class="main" href="https://alsaedan.com/sales/deem-01"
                           onclick="aspTrack('sales_project_opened',20)">استكشف المشروع</a>
                                                    <a class="alt" target="_blank" rel="noopener"
                               href="https://www.google.com/maps/search/?api=1&query=24.8212117,46.83144679999999"
                               onclick="aspTrack('sales_map_opened',20)"
                               aria-label="عرض على الخريطة" title="عرض على الخريطة">&#9678;</a>
                                            </div>
                </div>
            </article>"""

# ── OFFLINE SEAMS. Only the location catalog is stubbed; every other call is the shipping one. ────
_RIYADH, _KHOBAR = 3, 31
_DISTRICTS = {_RIYADH: ("حي القادسية", "حي الرحاب", "حي طويق", "حي المعذر الشمالي"),
              _KHOBAR: ("حي الحمراء",)}


@pytest.fixture(autouse=True)
def _no_catalog_network(monkeypatch):
    """to_catalog / find_district_in_text would otherwise read loc_catalog_* from the database.
    Both cities and all five districts DO resolve live (verified 2026-09-24 against the catalog)."""
    cities = {"الرياض": (_RIYADH, 1), "الخبر": (_KHOBAR, 5)}
    monkeypatch.setattr(R, "to_catalog",
                        lambda c, region_hint=None: cities.get((c or "").strip()) or (None, None))
    monkeypatch.setattr(R, "find_district_in_text",
                        lambda t, cid: next((d for d in _DISTRICTS.get(cid, ()) if t and d in t), None))


def _projects():
    return R.parse_projects(PROJECTS)


def _cards(page=TWO_CARDS):
    cards, declared = R.parse_unit_cards(page)
    assert cards, "the fixture must yield cards, or every assertion below is vacuous"
    return cards, declared


def _card(fixture):
    cards, _ = R.parse_unit_cards(fixture)
    assert len(cards) == 1, f"expected one card, parsed {len(cards)}"
    return cards[0]


def _row(card, purpose="sale", also=False):
    row, cat, why = R.map_listing(card, _projects().get(card.get("project_slug") or ""),
                                 purpose, also_offered=also)
    assert row, f"unit {card.get('id')} unexpectedly skipped: {why}"
    return row, cat


def _skip(card, purpose="sale", projects=None):
    row, cat, why = R.map_listing(
        card, (_projects() if projects is None else projects).get(card.get("project_slug") or ""),
        purpose)
    assert row is None, f"unit {card.get('id')} should have been skipped, got a row"
    return why


# ── 1. THE PRICE TRAP: the platform HOLDS prices and publishes «السعر عند الطلب» ──────────────────
# Measured 2026-09-24: all 332 available cards and all 332 detail pages render
# `class="asp-uprice none"` with those words, while the platform's own filter answers
# &minPrice=1000000 with 1,371 of 1,812 units. The numbers exist. They are not published, so they
# are not ours, and the row must say "the source states there is no price" — not "we didn't look".

def test_price_on_request_is_an_authoritative_null_not_a_silent_none():
    """MUTATION-VERIFIED: with `absent = None` this test fails.

    The difference is not cosmetic. A plain None is DROPPED by db._unknown_must_not_overwrite_known,
    so a figure stored by an earlier run would survive forever after the source stopped publishing
    it. AUTHORITATIVE_NULL is the sentinel that makes the NULL actually get written.
    """
    buy, _ = _row(_cards()[0][0])
    rent, _ = _row(_card(CARD_SHOP_RENT), purpose="rent")
    assert buy["price_total"] is R.db.AUTHORITATIVE_NULL, "«السعر عند الطلب» is the source's own NO"
    assert rent["price_annual"] is R.db.AUTHORITATIVE_NULL
    # The other side of each row is untouched — a Buy row must not claim a rent, or vice versa.
    assert buy["price_annual"] is None and rent["price_total"] is None


def test_no_number_on_the_card_is_ever_turned_into_a_price():
    """The card prints an area, a room count and a bathroom count. None of them is a price, and the
    platform's own filter bounds (1,000,000 / 5,000,000 …) are not published either."""
    for card in (_cards()[0][0], _card(CARD_LAND), _card(CARD_SHOP_RENT)):
        row, _ = _row(card, purpose="rent" if "محل" in (card["name"] or "") else "sale")
        for col in ("price_total", "price_annual", "price_per_meter"):
            assert not isinstance(row.get(col), int), (
                f"{col} holds {row.get(col)!r} — no figure on this source may become a price")


def test_a_land_plot_gets_no_per_metre_rate_invented_for_it():
    """This source publishes no «سعر المتر» and no «إجمالي السعر» anywhere — not even for its 22
    plots. price_per_meter must stay unwritten rather than be derived from the area."""
    row, cat = _row(_card(CARD_LAND))
    assert row.get("price_per_meter") is None
    assert row["area_m2"] == 1992, "«1,992.35 م²» — the separator is thousands, the .35 truncates"
    assert row["property_type"] == "Residential Land" and cat == "residential"


def test_the_evidence_records_the_absence_as_the_sources_own_statement():
    """MUTATION-VERIFIED: with `absent = None`, authoritative_absent still reads True here while the
    column no longer clears — which is why the column itself is asserted above, not just this."""
    row, _ = _row(_cards()[0][0])
    ev = row["price_evidence"]
    assert ev["authoritative_absent"] is True and ev["stored"] is None
    assert ev["raw"] == "السعر عند الطلب", "keep the source's own words as the audit trail"
    assert ev["field"] == "asp-uprice" and ev["origin"] == "structured"
    assert ev["unit"] == "total", "a per-metre unit would be a lie: no rate exists on this source"


def test_a_published_figure_would_be_stored_verbatim_the_day_it_appears():
    """SYNTHETIC SHAPE, and labelled as such: no alsaedan card prints a figure today (0 of 2,374).

    It exists because the opposite failure is worse than a missing branch — a scraper that hardcodes
    «on request» would keep NULLing real prices the day the platform starts publishing them, which
    is the "no hiding a source-published price" regression. The figure is stored EXACTLY, with no
    ×12 and no period invented for it.
    """
    priced = _card(CARD_SHOP_RENT.replace(
        '<span class="asp-uprice none">السعر عند الطلب</span>',
        '<span class="asp-uprice">45,000 ريال</span>'))
    row, _ = _row(priced, purpose="rent")
    assert row["price_annual"] == 45000, "stored exactly as printed — never ×12, never rounded"
    assert row["price_total"] is None
    assert "rent_period" not in row, "a figure with no stated period does NOT become annual"
    assert row["price_evidence"]["authoritative_absent"] is False
    assert row["price_evidence"]["raw"] == "45,000 ريال"


# ── 2. THE SIBLING TRAP: every field comes from the card's OWN container ──────────────────────────

def test_a_siblings_area_is_never_read_as_this_units_area():
    """MUTATION-VERIFIED: with `_specs()` scanning the page instead of the card, this test fails.

    The two cards in the fixture are adjacent in the live grid and carry different areas, and each
    detail page additionally prints a «وحدات مشابهة في المشروع نفسه» block full of other units'
    numbers (unit 2558: own area 35.00 م², sibling's 100.00 م²).
    """
    cards, _ = _cards()
    assert len(cards) == 2, "the slab must hold two cards or the trap is not exercised"
    areas = [c["specs"][0] for c in cards]
    assert areas[0] != areas[1], "the fixture's two cards must differ, or nothing is proven"
    first, _ = _row(cards[0])
    second, _ = _row(cards[1])
    assert first["area_m2"] == 128 and second["area_m2"] == 137
    assert first["ad_number"] != second["ad_number"]
    assert first["listing_url"].endswith(f"/{cards[0]['id']}")
    assert second["listing_url"].endswith(f"/{cards[1]['id']}")
    assert first["project_name"] == "ديم 10" and second["project_name"] == "ديم 11"
    assert first["photo_urls"] != second["photo_urls"], "a cover must not bleed across cards either"
    assert first["additional_info"]["photo_is_project_cover"] is True


def test_a_project_cards_area_range_and_price_can_never_become_a_units_values():
    """Project cards print «374.00 – 619.00 م²» and their own «السعر عند الطلب». parse_unit_cards
    only ever matches `asp-ucard`, so a projects page yields no listings at all."""
    cards, declared = R.parse_unit_cards(PROJECTS)
    assert cards == [] and declared is None
    projects = _projects()
    assert set(projects) == {"al-liwan", "deem-10", "deem-11", "sama-najd", "assal-center",
                             "deem-01"}
    assert all(k in projects["deem-10"] for k in ("status_class", "status", "name", "where"))


def test_specs_are_matched_by_content_not_by_position():
    """63 of the 332 available cards print area + status only. A positional read files the status
    pill as a bathroom count; the land card proves counts stay UNKNOWN rather than 0."""
    land = R._specs(_card(CARD_LAND))
    assert "area_raw" in land and "bedrooms" not in land and "bathrooms" not in land
    row, _ = _row(_card(CARD_LAND))
    assert row["bedrooms"] is None and row["bathrooms"] is None, "absent is UNKNOWN, never 0"
    full = R._specs(_cards()[0][0])
    assert (full["area_raw"], full["bedrooms"], full["bathrooms"]) == ("128.58", "3", "3")


def test_arabic_indic_digits_in_the_spec_spans_parse_the_same_as_western_ones():
    """The site serves western digits today; the fleet rule is that ٠-٩ must parse everywhere."""
    one = TWO_CARDS.split("</article>")[0] + "</article>"
    card = _card(one.replace("128.58 م²", "١٢٨.٥٨ م²").replace("<span>3 غرف</span>",
                                                               "<span>٣ غرف</span>"))
    spec = R._specs(card)
    assert R.normalize.to_int(spec["area_raw"]) == 128 and R.normalize.to_int(spec["bedrooms"]) == 3
    row, _ = _row(card)
    assert row["area_m2"] == 128 and row["bedrooms"] == 3


# ── 3. RENT PERIOD: this source states none, anywhere, ever ───────────────────────────────────────

def test_no_rent_row_carries_a_period_because_the_source_states_none():
    """Checked live on all 332 pages and all 2,374 cards: no «شهري», no «سنوي», no «/ سنوياً».

    The key is ABSENT rather than None-valued, so our silence cannot overwrite a period a future
    run reads from a page that starts printing one.
    """
    rent, cat = _row(_card(CARD_SHOP_RENT), purpose="rent")
    assert rent["transaction_type"] == "Rent" and cat == "commercial"
    assert "rent_period" not in rent
    assert rent["price_annual"] is R.db.AUTHORITATIVE_NULL


def test_the_shipping_file_never_writes_the_rent_period_column_at_all():
    """A defaulted period is the souq24 defect (5,000 شهري stored as annual — a 12x understatement).
    This platform publishes no period, so the guarantee is checkable as a property of the file: the
    column is never assigned, in a literal or afterwards."""
    code = Path(R.__file__).read_text(encoding="utf-8").split('"""', 2)[2]
    assert not re.search(r'row\[["\']rent_period["\']\]\s*=', code), (
        "alsaedan assigns rent_period — this source states no period anywhere"
    )
    assert not re.search(r'["\']rent_period["\']\s*:', code), (
        "alsaedan puts rent_period in a row literal — this source states no period anywhere"
    )


# ── 4. PDPL: a poisoned card must leak nothing ────────────────────────────────────────────────────
# The unit block on the live page carries `wa.me/966920004365` and the number 920004365 on all 332
# pages, and the footer adds tel:, mailto: and @alsaedan addresses. Here every text field the parser
# reads is poisoned with those real strings.
_POISON = ("0555754441", "+966555754441", "wa.me/966920004365", "920004365", "Info@alsaedan.com")
POISONED_CARD = (TWO_CARDS.split("</article>")[0] + "</article>") \
    .replace("شقة — وحدة KHR-DM10-AP-A10",
             "شقة — وحدة KHR-DM10-AP-A10 للتواصل 0555754441 واتساب https://wa.me/966920004365") \
    .replace("ديم 10</a>", "ديم 10 Info@alsaedan.com</a>") \
    .replace("حي الحمراء، الخبر", "حي الحمراء 920004365، الخبر") \
    .replace("السعر عند الطلب", "السعر عند الطلب — اتصل +966555754441")


def test_no_contact_detail_survives_anywhere_in_a_stored_row():
    """This test found TWO real leaks when it was written, both now fixed: `neighborhood` stored the
    card's location line verbatim, so a number appended to the district — «حي الحمراء 920004365،
    الخبر» — went straight into a column; and price_evidence.raw kept the price text verbatim, so a
    number beside «السعر عند الطلب» was archived. The district still RESOLVES from the raw text;
    only the stored copies are redacted.
    """
    row, _ = _row(_card(POISONED_CARD))
    assert row["district_ar"] == "حي الحمراء", "the lookup must still find the district"
    assert row["neighborhood"] == "حي الحمراء [redacted]"
    blob = json.dumps(row, default=str, ensure_ascii=False)
    for bad in _POISON:
        assert bad not in blob, (
            f"{bad!r} reached a stored payload. PDPL: no phone, WhatsApp link or email may appear "
            f"in a column, in additional_info or in source_capture."
        )
    assert not re.search(r"(?:\+?966|00966)?0?5\d{7,}|wa\.me|@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", blob)


def test_the_poison_really_is_in_the_fixture():
    """CONTROL: if the poisoning stopped landing in the HTML, the test above passes vacuously."""
    for bad in _POISON:
        assert bad in POISONED_CARD


def test_there_is_no_advertiser_identity_on_this_source_to_leak():
    """The limit of pattern redaction, stated rather than papered over.

    redact_pii() deliberately does NOT scrub personal NAMES — a name-shaped scrubber would eat
    regulatory text like «مكتب المسكن الثاني العقارية» or a licence holder. On alsaedan that is
    safe by construction rather than by luck: this is a DEVELOPER selling its own units, and no
    advertiser, agent, broker, owner or employee field exists anywhere — not on the card, not on the
    unit page, not on the project card. The only identity the pages carry is the company's own
    sales channel (920004365 / wa.me/966920004365), which IS pattern-redacted above.
    strip_pii_fields() then guards the key side: an identity-shaped key added upstream is dropped.
    """
    row, _ = _row(_card(POISONED_CARD))
    for payload in (row["additional_info"], row["source_capture"]):
        assert not [k for k in payload if any(
            p in k.lower() for p in ("advertiser", "broker", "owner", "agent", "employee", "phone",
                                     "mobile", "whatsapp", "contact", "email", "seller"))]
    # And the shipping mapper reads no such field in the first place.
    code = Path(R.__file__).read_text(encoding="utf-8").split('"""', 2)[2]
    for never in ("advertiser", "broker", "agentName", "phoneNumber", "ownerName"):
        assert never not in code


# ── 5. OFF-PLAN and AVAILABILITY: the source's own markers, never a heuristic ──────────────────────

def test_an_under_construction_projects_units_are_skipped_on_the_sources_own_marker():
    """al-liwan carries `<span class="asp-status st-construction">قيد الإنشاء</span>` and 74 of the
    283 available sale units belong to it. The skip reason names the source's own word."""
    why = _skip(_card(CARD_ALLIWAN))
    assert why.startswith("project_under_construction"), why
    assert "قيد" in why and "الإنشاء" in why, "the reason must quote the source, not paraphrase it"
    assert _projects()["al-liwan"]["status_class"] == R._OFF_PLAN_CLASS


def test_a_built_project_is_not_skipped_for_being_called_a_project():
    """Owner ruling 2026-09-13: a completed project is a real property. deem-10 is `st-partial`
    («مباع جزئي»), deem-01 `st-full`, sama-najd `st-partial` — none of them is off-plan."""
    for slug, cls in (("deem-10", "st-partial"), ("deem-01", "st-full"), ("deem-11", "st-partial"),
                      ("sama-najd", "st-partial"), ("assal-center", "st-partial")):
        assert _projects()[slug]["status_class"] == cls != R._OFF_PLAN_CLASS
    row, _ = _row(_cards()[0][0])
    assert row["project_name"] == "ديم 10" and row["active"] is True


def test_a_project_we_could_not_resolve_fails_closed():
    """"We could not read the project's status" is not "the project is built"."""
    assert _skip(_cards()[0][0], projects={}) == "project_status_unknown"
    assert _skip(_cards()[0][0], projects={"deem-10": {"status_class": None}}) == \
        "project_status_unknown"


def test_a_unit_the_source_does_not_call_available_is_skipped():
    """`asp-pill ok` «متاحة» 400, `off` «مباعة» 1,530 / «مؤجرة» 443, `warn` «محجوزة» 1 over the whole
    catalogue. With `available=1` the source serves only `ok`, so this guard measures 0 — it exists
    so a crawl without the filter can never turn a sold unit into live inventory."""
    sold = _card(CARD_SOLD)
    assert sold["status_class"] == "off" and sold["status"] == "مباعة"
    assert _skip(sold) == "unit_not_available_مباعة"


def test_the_floor_span_on_a_sold_card_is_still_read_by_content():
    """«الدور 1» exists on 75 SOLD cards and on no available one. Parsed anyway, so a unit that
    returns to the market brings its floor with it instead of silently losing it."""
    assert R._specs(_card(CARD_SOLD)).get("floor_number") == "1"


def test_an_auction_ad_is_refused():
    """No «مزاد» exists on this developer's portal (0 of 332 pages). The fleet rule is absolute, so
    the word is refused rather than assumed absent forever."""
    auction = CARD_SHOP_RENT.replace("محل — وحدة asal-18", "محل — وحدة asal-18 مزاد علني")
    assert _skip(_card(auction), purpose="rent") == "auction_مزاد"


# ── 6. TYPES, LOCATION, and the two-purpose unit ──────────────────────────────────────────────────

@pytest.mark.parametrize("word,expected,category", [
    ("شقة", "Apartment", "residential"),
    ("فيلا", "Villa", "residential"),
    ("دور", "Floor", "residential"),
    ("أرض سكنية", "Residential Land", "residential"),
    ("تاون هاوس", "Villa", "residential"),
    ("عمارة سكنية", "Building", "residential"),
    ("محل", "Shop", "commercial"),
    ("مكتب", "Office", "commercial"),
    ("عمارة تجارية", "Commercial Building", "commercial"),
    ("مستودع", "Warehouse", "commercial"),
    ("معرض", "Showroom", "commercial"),
])
def test_every_type_word_the_catalogue_contains_maps_and_lands_in_the_right_table(
        word, expected, category):
    """All eleven words, counted over the whole catalogue 2026-09-24: أرض سكنية 1,288, شقة 691,
    فيلا 156, محل 143, دور 28, تاون هاوس 22, مستودع 22, مكتب 14, معرض 6, عمارة تجارية 3,
    عمارة سكنية 1. «تاون هاوس» → Villa is the fleet's existing decision, not a new one."""
    got = R.normalize.map_type_exact(word, R._TYPE_OVERRIDES)
    assert got == expected, f"«{word}» must map to {expected}"
    assert R.normalize.category_for_type(got).lower() == category


def test_an_unmapped_type_word_skips_with_the_word_in_the_reason():
    card = _card(CARD_SHOP_RENT.replace("محل — وحدة", "كشك — وحدة"))
    assert _skip(card, purpose="rent") == "type_unmapped_كشك"


def test_the_city_is_the_last_part_and_the_district_is_what_precedes_it():
    row, _ = _row(_cards()[0][0])
    assert (row["city_ar"], row["city_id"], row["region_id"]) == ("الخبر", _KHOBAR, 5)
    assert row["district_ar"] == "حي الحمراء" and row["neighborhood"] == "حي الحمراء"
    # A card with no district keeps a NULL district rather than borrowing the city's name.
    land, _ = _row(_card(CARD_LAND))
    assert land["city_ar"] == "الرياض" and land["district_ar"] is None
    assert land["neighborhood"] is None


def test_a_city_outside_the_catalog_skips_rather_than_landing_under_a_neighbour():
    card = _card(CARD_LAND.replace("— الرياض", "— بلدة لا وجود لها"))
    assert _skip(card) == "city_not_in_catalog"


def test_a_unit_offered_both_ways_becomes_two_rows_that_name_each_other():
    """68 of the 332 available units appear under BOTH purposes — per-unit, not per-project
    (deem-11 serves 69 sale and 68 rent, so the flags differ by unit)."""
    card = _cards()[0][0]
    buy, _ = _row(card, purpose="sale", also=True)
    rent, _ = _row(card, purpose="rent", also=True)
    assert buy["ad_number"] == f"SDN{card['id']}"
    assert rent["ad_number"] == f"SDN{card['id']}-R"
    assert buy["listing_url"] == rent["listing_url"], "one unit, one page — two offers"
    assert buy["additional_info"]["also_offered_as"] == "Rent"
    assert rent["additional_info"]["also_offered_as"] == "Buy"
    single, _ = _row(card, purpose="sale", also=False)
    assert "also_offered_as" not in single["additional_info"]


def test_the_unit_code_is_the_units_own_stable_identity():
    assert R._unit_code("شقة — وحدة KHR-DM10-AP-A87") == "KHR-DM10-AP-A87"
    assert R._unit_code("دور — وحدة فلة رقم 4 - الدور الملحق") == "فلة رقم 4 - الدور الملحق"
    assert R._unit_code("شقة") is None
    row, _ = _row(_cards()[0][0])
    assert row["additional_info"]["unit_code"] == "KHR-DM10-AP-A10"


# ── 7. COMPLETENESS and the REMOVAL ORACLE ────────────────────────────────────────────────────────

def test_the_page_prints_its_own_count_and_that_count_is_the_prune_gate():
    """`<div class="asp-count">283 وحدة متاحة</div>` is the source's own enumeration claim. A page
    that stops printing it yields None, and fetch_units then reports complete=False, which blocks
    prune_unseen entirely — a truncated crawl must never look like a shrunken catalogue."""
    cards, declared = _cards()
    assert declared == 283, "the captured page printed 283"
    assert len(cards) < declared, "two cards are not a complete catalogue"
    _, none_declared = R.parse_unit_cards(TWO_CARDS.replace('class="asp-count"', 'class="gone"'))
    assert none_declared is None


@pytest.mark.parametrize("status,body,path_changed,expect,why", [
    (404, "Not Found", False, "gone", "3/3 fabricated ids (0, 999999) answered 404"),
    (200, "<h1 class=\"aup-h1\">شقة</h1>", True, "gone",
     "302 onto its project page — 14/14 unavailable ids, 0/6 available controls"),
    (302, "", True, "gone", "the redirect itself is the removal signal on this source"),
    (200, '<h1 class="aup-h1">شقة — وحدة KHR-DM10-AP-A87</h1>', False, "live",
     "its own unit block on its own path"),
    (200, "<html>a shell with no unit block</html>", False, None, "no opinion, never a kill"),
    (403, "blocked", False, None, "about our access, not the listing"),
    (500, "boom", False, None, "the source is broken, not the listing"),
    (200, "", False, None, "an empty body is not an answer"),
])
def test_the_oracle_only_kills_on_a_404_or_a_path_change(status, body, path_changed, expect, why):
    assert R._signal(status, body, path_changed) == expect, why


def test_a_200_alone_is_never_read_as_life_on_this_source():
    """The decisive measurement: a de-listed unit's 302 lands on its PROJECT page, which answers 200
    with full content. An "is it 200?" oracle would call every sold unit alive forever."""
    project_page = "<html>" + PROJECTS + "</html>"
    assert 'class="aup-h1"' not in project_page, "the project page carries no unit block"
    assert R._signal(200, project_page, True) == "gone"
    assert R._signal(200, project_page, False) is None, "no unit block, no verdict"


@pytest.mark.parametrize("ad,expected_id", [("SDN3120", "3120"), ("SDN3120-R", "3120")])
def test_both_sides_of_a_dual_unit_probe_that_units_own_url(ad, expected_id, monkeypatch):
    """Two rows, one page: «-R» must not become part of the id we probe."""
    seen: list[str] = []

    def fetch(self, url):
        seen.append(url)
        return 404, "Not Found", False

    monkeypatch.setattr(R.LivenessProbe, "fetch", fetch)
    verdict, why = R._make_verify_gone(None)(ad)
    assert seen and seen[0] == f"https://alsaedan.com/sales/unit/{expected_id}"
    # And with no row from this run to use as a positive control, the removal is WITHHELD.
    assert verdict == "unknown" and "removal withheld" in why, why


def test_a_removal_needs_a_live_positive_control_and_is_granted_once_it_has_one(monkeypatch):
    """The canary fails CLOSED: a source that has stopped serving us real listings cannot testify
    that any particular one is gone."""
    def fetch(self, url):
        if url.endswith("/3120"):
            return 200, '<h1 class="aup-h1">شقة — وحدة KHR-DM10-AP-A87</h1>', False
        return 404, "Not Found", False

    monkeypatch.setattr(R.LivenessProbe, "fetch", fetch)
    assert R._make_verify_gone({"ad_number": "SDN3120"})("SDN9999")[0] == "gone"

    def dead(self, url):
        return 503, "upstream is down", False

    monkeypatch.setattr(R.LivenessProbe, "fetch", dead)
    verdict, why = R._make_verify_gone({"ad_number": "SDN3120"})("SDN9999")
    assert verdict == "unknown", why


def test_an_ad_number_that_is_not_ours_is_unknown_not_a_kill():
    assert R._make_verify_gone(None)("NOPE")[0] == "unknown"


def test_every_row_carries_the_units_own_verified_url_and_the_platforms_photo_base():
    """All 332 /sales/unit/{id} URLs were fetched live: 332 × HTTP 200, each with its own aup-h1.
    Two photo URLs were fetched: 200 image/jpeg."""
    for card, purpose in ((_cards()[0][0], "sale"), (_card(CARD_SHOP_RENT), "rent"),
                          (_card(CARD_LAND), "sale")):
        row, _ = _row(card, purpose=purpose)
        assert row["listing_url"] == f"https://alsaedan.com/sales/unit/{card['id']}"
        assert row["source"] == "آل سعيدان"
        for url in row.get("photo_urls") or []:
            assert url.startswith("https://alsaedan.com/uploads/")
