"""The AI facts reader stamps every row with the hash of the text it read, so a later text is read again.

Measured 2026-10-31: 13 small sites (ksaaqar, therc, sanadak, ashab, aqargate, manzo, hajer, satel, akariyoun, …)
got their descriptions crawled that morning, but the AI backlog of 10-26..10-30 had already read 2,119 of their
ads from the TITLE alone and left `_none` markers; facts_ai_todo_ids() counted any row as "read", so the real
text was never read. Now every listing_facts row carries text_hash = md5(title + "\\n" + description) of what
the model saw — the same bytes as public.facts_text_hash() (migration 20261031080211), which
facts_ai_is_read() compares with the ad's CURRENT text. The vectors below were produced by production
Postgres (`select md5('شقة للإيجار' || E'\\n' || 'مسبح خاص ومصعد')`), so this test pins Python = SQL.

Run: python -m pytest scrapers/common/tests/test_facts_reader_rereads_when_the_text_arrives.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.facts.extract import text_hash  # noqa: E402

TITLE = "شقة للإيجار"
TEXT = "مسبح خاص ومصعد"
PG_FULL = "29c83702b34bd531f1f5d9155b4c0385"      # md5(title || E'\n' || text) in production Postgres
PG_TITLE_ONLY = "69f41b4cc753452d7dfb774cb047a1c6"  # md5(title || E'\n' || '')


def test_python_hash_equals_the_postgres_hash():
    assert text_hash(TITLE, TEXT) == PG_FULL


def test_a_missing_description_hashes_like_an_empty_one_in_both_worlds():
    # coalesce(description, '') in SQL ↔ (description or "") in Python: NULL and '' are the same read.
    assert text_hash(TITLE, None) == text_hash(TITLE, "") == PG_TITLE_ONLY


def test_text_that_arrives_later_changes_the_hash_so_the_ad_is_unread_again():
    assert text_hash(TITLE, None) != text_hash(TITLE, TEXT)


def test_every_stored_row_carries_the_hash():
    # Both row shapes the reader upserts — a fact and the `_none` marker — stamp text_hash from the raw row.
    src = (ROOT / "scrapers" / "facts" / "extract.py").read_text(encoding="utf-8")
    assert src.count('"text_hash": text_hash(r.get("title"), r.get("text"))') == 2, \
        "the fact row and the _none marker row must both carry the hash of what the model read"
