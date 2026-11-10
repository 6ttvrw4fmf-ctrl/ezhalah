"""A revival by the cleanup leaves its reading behind (2026-11-10).

aqar_residential 10509703 and 14993148 were hidden on 2026-10-12 on three direct «مغلق» readings.
On 2026-11-10 the cleanup re-read their pages before deleting them, read both as open again (a
browser read of 10509703 that day agrees: closed:false, published:true) and switched them back on
with `active=true, missing_count=0` and nothing else. No row said which ads, on what reading; the
listings looked «killed in the ledger, active now, never looked at since».

Every revival now writes one LIVE row to the shared reading ledger BEFORE the listing changes and
marks the listing as looked-at. It does not stamp `last_verified_alive_at`: that stays the
liveness contract's, minted by the site's own liveness job.
"""
from __future__ import annotations

import scrapers.common.cleanup as C
from scrapers.common.tests.test_cleanup import POL, _cand, _install

LEDGER = "ops_stale_inactivation_probe"


def _run(rows, probe, **kw):
    c = _install({"testp_listings": rows, LEDGER: []}, POL(), probe=probe)
    return c, C.run("testp", force=True, **kw)


def test_a_revival_writes_one_live_reading_per_ad_naming_the_ad():
    c, s = _run([_cand(1), _cand(2)], lambda url: (200, "still for sale"))
    assert s["reactivated"] == 2
    rows = [r for chunk in c.inserted[LEDGER] for r in chunk]
    assert sorted(r["listing_id"] for r in rows) == [1, 2]
    one = next(r for r in rows if r["listing_id"] == 1)
    assert one["source_table"] == "testp_listings" and one["ad_number"] == "A1"
    assert one["listing_url"] == "http://x/1"
    assert one["verdict"] == "LIVE" and one["oracle"] == "cleanup.recheck"
    assert one["http_status"] == 200 and one["body_bytes"] == len("still for sale")
    assert "HTTP 200" in one["note"]


def test_the_listing_is_marked_looked_at_and_never_stamped_proven_alive():
    c, _s = _run([_cand(1)], lambda url: (200, "still for sale"))
    (ids, patch), = c.updated["testp_listings"]
    assert ids == [1]
    assert patch["active"] is True and patch["missing_count"] == 0
    assert patch["last_liveness_probe_at"], "a revived ad must show that someone looked"
    assert "last_verified_alive_at" not in patch, "only liveness_contract mints that stamp"
    assert "last_seen_at" not in patch, "the crawl did not see it; the cleanup did"


def test_the_reading_lands_before_the_listing_changes(monkeypatch):
    order = []
    c = _install({"testp_listings": [_cand(1)], LEDGER: []}, POL(), probe=lambda url: (200, "x"))
    real = c.table

    def table(name):
        t = real(name)
        ex = t.execute

        def execute():
            if t._op:
                order.append((name, t._op[0]))
            return ex()
        t.execute = execute
        return t
    c.table = table
    C.run("testp", force=True)
    assert order.index((LEDGER, "insert")) < order.index(("testp_listings", "update"))


def test_a_ledger_that_refuses_the_write_revives_nothing():
    c = _install({"testp_listings": [_cand(1)], LEDGER: []}, POL(), probe=lambda url: (200, "x"))
    real = c.table

    def table(name):
        t = real(name)
        if name == LEDGER:
            ex = t.execute

            def execute():                       # reads answer; only the evidence write fails
                if t._op and t._op[0] == "insert":
                    raise RuntimeError("ledger down")
                return ex()
            t.execute = execute
        return t
    c.table = table
    s = C.run("testp", force=True)
    assert not c.updated.get("testp_listings"), "no evidence, no revival"
    assert s["reactivated"] == 0 and s["skipped"] == 1 and c.deleted == {}
    assert "revival_evidence_unwritten=1" in s["note"]


def test_dead_and_unknown_rows_write_no_live_reading_and_a_dry_run_writes_nothing():
    seq = iter([(404, ""), (503, "")])
    c, s = _run([_cand(1), _cand(2)], lambda url: next(seq))
    assert s["reactivated"] == 0 and not c.inserted.get(LEDGER)
    c, s = _run([_cand(1)], lambda url: (200, "x"), dry_run=True)
    assert s["reactivated"] == 1 and not c.inserted.get(LEDGER) and not c.updated.get("testp_listings")
