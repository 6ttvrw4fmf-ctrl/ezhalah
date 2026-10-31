"""wahadat: every unit carries its project's own «about» text as `description` (backlog 892, 2026-10-31).

`parse_project` read `about_ar` into the project since onboarding (2026-09-26) and `map_unit` never wrote
it: 0 of 998 active units stored a description, so the AI facts reader had nothing to read. Units carry
no text of their own on this source, so a unit carries its project's text — the same scope as its photos.
PDPL: the text goes through redact_pii. No text → None, never ''.

    python -m pytest scrapers/common/tests/test_wahadat_stores_project_about_text.py -q
"""
from __future__ import annotations

import os
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test")
_supabase = types.ModuleType("supabase")
_supabase.Client = type("Client", (), {})
_supabase.create_client = lambda url, key: None
sys.modules.setdefault("supabase", _supabase)
_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *a, **k: None
sys.modules.setdefault("dotenv", _dotenv)

from scrapers.wahadat import run as R  # noqa: E402

ABOUT = "مشروع سكني متكامل في حي النرجس، وحدات بتشطيب فاخر ومواقف قبو. للتواصل 0551234567"


def test_the_project_about_text_is_kept_redacted():
    d = R.project_description({"about_ar": ABOUT})
    assert d and d.startswith("مشروع سكني متكامل في حي النرجس")
    assert "0551234567" not in d


def test_html_about_text_is_plain_text():
    d = R.project_description({"about_ar": "<p>تشطيب فاخر</p><p>مواقف قبو</p>"})
    assert d and "<" not in d and "تشطيب فاخر" in d and "مواقف قبو" in d


def test_no_text_is_none_never_empty():
    for about in (None, "", "   ", 5):
        assert R.project_description({"about_ar": about}) is None
    assert R.project_description({}) is None


def test_every_unit_row_writes_it():
    src = open(R.__file__, encoding="utf-8").read()
    body = src[src.index("def map_unit("):]
    assert '"description": project_description(proj),' in body
    assert '"about_ar")}' in src  # parse_project still carries the field into proj
