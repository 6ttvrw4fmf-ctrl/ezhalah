"""A haraj post the seller re-titled «تم البيع» / «تم التأجير» is a done deal: gone on its own page, never stored.

2026-11-02 (♻️, backlog 1167, owner «fix everything»): 29 served haraj ads titled «… (تم البيع)» and 23
«… (تم التأجير)» were stamped alive at 07:32 UTC by the own-page oracle, because the post stays up (200)
with the word added. A bare «مؤجر/مؤجرة» (an income property for sale) and «لم يتم البيع» are NOT closed.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from scrapers.haraj import run as R  # noqa: E402

LIVE_DESC = "شقة للايجار في حي النرجس"


def page(name, desc=LIVE_DESC):
    ld = {"@type": "RealEstateListing", "name": name, "description": desc,
          "image": ["https://img4cdn.haraj.com.sa/a.jpg"], "url": "https://haraj.com.sa/11190690713/x/",
          "address": {"addressLocality": "الرياض"}}
    return '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + "</script>"


@pytest.mark.parametrize("title", [
    "للبيع أرض في حي الناصرية 6 على شارع 18م (تم البيع)",      # HRJ11186170938, served 11-02
    "( تم البيع ) للبيع ارض بضاحية الجبيل",
    "تم البيع",
    "شقة للايجار في ضاحية لبن ( تم التأجير )",
    "دور ارضي للايجار في حي ضاحية نمار ( تم التأجير بحمد الله)",
    "شقة للإيجار تم الإيجار",
    "أرض للبيع .. تم بيعها",
])
def test_a_seller_closed_title_reads_gone(title):
    assert R.seller_closed_title(title)
    assert R._signal(200, page(title), False) == "gone"


@pytest.mark.parametrize("title", [
    "شقة للايجار في حي النرجس",
    "عمارة مؤجرة للبيع دخل 120 ألف",          # income property for sale — not a removal
    "للبيع فيلا لم يتم البيع حتى الآن",        # «لم يتم البيع» is the opposite
    "أرض للبيع يتم البيع بالمزاد",
])
def test_an_open_offer_is_not_closed(title):
    assert not R.seller_closed_title(title)
