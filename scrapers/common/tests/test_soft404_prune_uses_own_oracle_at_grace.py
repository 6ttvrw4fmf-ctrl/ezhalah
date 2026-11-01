"""A soft-404 site's absence prune must decide strike 3 with the site's OWN oracle (2026-10-31, ♻️).

albukaeri (removed ad = 200 empty shell) and azdad (removed ad = 200 «غير موجود») called
db.prune_unseen WITHOUT verify_gone, so on a night the prune was not refused the at-grace check fell
back to the shared status-only oracle, which reads a 200 shell as no answer — the row was held at
missing_count 2 forever while its own page said gone (azdad 10778041 since 10-24 and 19414954 since
10-25; albukaeri 3 ads since 10-13; all read gone from CI 10-31 and hidden by hand). superoffice
already passed its oracle. Now every one of them hands its own oracle to the prune itself.
"""
from __future__ import annotations

import pytest

from scrapers.albukaeri import run as ALB
from scrapers.azdad import run as AZ
from scrapers.superoffice import run as SO


@pytest.mark.parametrize("mod", [ALB, AZ, SO], ids=["albukaeri", "azdad", "superoffice"])
def test_the_prune_itself_gets_the_site_oracle(monkeypatch, mod):
    calls = {}

    def fake_prune(tbl, seen, **kw):
        calls["vg"] = kw.get("verify_gone")
        return 0
    monkeypatch.setattr(mod.db, "prune_unseen", fake_prune)
    vg = object()
    assert mod.prune_table("t", {"X"}, vg) == 0
    assert calls["vg"] is vg, "strike 3 must be decided by the site's own oracle, not the status-only default"
