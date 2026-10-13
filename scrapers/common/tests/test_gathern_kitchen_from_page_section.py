"""Gathern kitchen comes from the unit page's own «مرافق المطبخ» list when it names «مطبخ مجهز»
(🆕 New Listings Engineer, 2026-10-12, backlog #379 / #393).

The section was stored in additional_info.extra_sections on 4,754 active units and names «مطبخ مجهز»
on 218 of them, yet `kitchen` stayed NULL on every Gathern unit, so an Advanced Filter kitchen search
never found one. LISTED = YES; an appliance list without the item, an empty block or no section is
silence → None, never «no».

    python -m pytest scrapers/common/tests/test_gathern_kitchen_from_page_section.py -q
"""
from __future__ import annotations

import sys
import types

_supabase_mod = types.ModuleType("supabase")
_supabase_mod.Client = type("Client", (), {})
_supabase_mod.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase_mod)
_dotenv_mod = types.ModuleType("dotenv")
_dotenv_mod.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv_mod)

import pytest  # noqa: E402

from scrapers.gathern import run as R  # noqa: E402

# Unit 196227 (re-read run 38216215705), as fetch_detail() stores it: the <li> items joined by spaces.
_EQUIPPED = {"header": "مرافق المطبخ",
             "content": "فريزر فرن ثلاجه مايكرويف غلايه اوانى طبخ الة قهوه مطبخ مجهز غسالة ملابس"}
_APPLIANCES = {"header": "مرافق المطبخ", "content": "ثلاجه مايكرويف غلايه"}
_EMPTY = {"header": "مرافق المطبخ", "content": ""}
_OTHER = {"header": "المرافق", "content": "مطبخ مجهز"}


@pytest.mark.parametrize("secs,want", [
    ([_EQUIPPED], True),
    ([{"header": "دورات المياة", "content": "دورة مياه واحدة"}, _EQUIPPED], True),
    ([_APPLIANCES], None),          # appliances are not a statement about a kitchen
    ([_EMPTY], None),
    ([_OTHER], None),               # only the kitchen section's own list is read
    ([], None),
    (None, None),
])
def test_kitchen_from_sections(secs, want):
    assert R._kitchen_from_sections(secs) is want


def test_never_returns_false():
    for secs in ([_APPLIANCES], [_EMPTY], [], None):
        assert R._kitchen_from_sections(secs) is not False
