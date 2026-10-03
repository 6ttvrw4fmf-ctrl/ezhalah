"""The nightly 'dead ads a customer can see' measurement (scrapers/common/dead_visible_score.py): the
rulebook's sample sizes, UNKNOWN never counted as gone, a website whose known-live controls fail is
VOID (nothing decided), the ♻️ rating cap is read from the rows, and a dead ad never fails the job.
Fake client, fake readers, no network, no sleeps."""
from __future__ import annotations

import random

import pytest

import scrapers.common.dead_visible_score as S
from scrapers.common.liveness_contract import ALIVE, DEAD, UNKNOWN


def _row(platform="x", shown=1000, live=0, gone=0, unknown=0, note=None):
    return S.empty_row("2026-10-02", platform, shown, sampled=live + gone + unknown, live=live, gone=gone,
                       unknown=unknown, note=note)


def test_sample_sizes_are_the_rulebooks():
    assert S.sample_size(500) == 10 and S.sample_size(121_421) == 10      # big: 10
    assert S.sample_size(499) == 5 and S.sample_size(372) == 5            # small: 5
    assert S.sample_size(3) == 3 and S.sample_size(0) == 0                # or all of them


def test_gone_share_is_among_decided_and_unknown_is_never_dead():
    assert S.gone_share(_row(live=9, gone=1)) == pytest.approx(0.1)
    assert S.gone_share(_row(live=9, gone=1, unknown=90)) == pytest.approx(0.1)
    assert S.gone_share(_row(unknown=10)) is None                         # nothing decided, never 0%


def test_the_lines():
    assert S.over_the_line(_row(live=9, gone=1))                          # 10% > 5%, any size
    assert not S.over_the_line(_row(live=38, gone=2))                     # 5.0% is not > 5%, < 50 decided
    assert S.over_the_line(_row(live=37, gone=3))                         # 7.5%
    assert not S.over_the_line(_row(live=59, gone=1))                     # 1.7% on 60 decided
    assert S.over_the_line(_row(live=58, gone=2))                         # 3.3% on 60 decided > 2%
    assert not S.over_the_line(_row(unknown=10))


def test_rating_cap_is_read_from_the_rows():
    clean = [_row("a", live=10), _row("b", live=5)]
    assert S.rating_cap(clean) == (10, "fleet gone share 0 and every website measured")
    assert S.rating_cap(clean, complete=False)[0] == 9                    # a partial run is never a 10
    assert S.rating_cap([])[0] == 9
    assert S.rating_cap(clean + [_row("c", unknown=5, note="void")])[0] == 9
    assert S.rating_cap([_row("a", live=99, gone=1), _row("b", live=5)])[0] == 9     # 1% on 100 decided
    cap, why = S.rating_cap([_row("a", live=10), _row("b", live=4, gone=1)])
    assert cap == 5 and "b" in why
    assert S.rating_cap([_row("a", live=58, gone=2)])[0] == 5


def test_fleet_number_is_dead_share_times_shown():
    f = S.fleet([_row("a", shown=1000, live=9, gone=1), _row("b", shown=50, live=5), _row("c", shown=7, unknown=5)])
    assert f["visible_dead_estimate"] == 100 and f["gone"] == 1 and f["decided"] == 15
    assert f["measured"] == 2 and f["unmeasured"] == ["c"] and f["over_the_line"] == ["a"]


def test_exit_code_is_transport_never_a_dead_ad():
    assert S.exit_code(S.fleet([_row("a", gone=10)])) == 0               # every ad dead: a finding
    assert S.exit_code(S.fleet([_row("a", unknown=10)])) == 1            # nothing could be read


# ── score_site: controls gate, buckets, evidence ─────────────────────────────────────────────────

def _fake(monkeypatch, controls, sample, answers):
    monkeypatch.setattr(S, "sample", lambda *a, **k: sample)
    monkeypatch.setattr(S, "pick_controls", lambda *a, **k: controls)

    def read(r):
        a = answers[r["listing_url"]]
        if isinstance(a, Exception):
            raise a
        return a
    monkeypatch.setattr(S, "reader_for", lambda platform, control: ("fake", read))


def _ads(prefix, n, table="t_residential_listings"):
    return [{"table": table, "id": i, "ad_number": f"{prefix}{i}", "listing_url": f"https://x/{prefix}{i}"}
            for i in range(n)]


def test_unknown_and_a_raising_reader_are_never_gone_and_gone_ids_are_the_evidence(monkeypatch):
    ctl, ads = _ads("c", 5), _ads("a", 4)
    answers = {f"https://x/c{i}": ALIVE for i in range(5)}
    answers.update({"https://x/a0": ALIVE, "https://x/a1": DEAD, "https://x/a2": UNKNOWN,
                    "https://x/a3": RuntimeError("boom")})
    _fake(monkeypatch, ctl, ads, answers)
    row = S.score_site(object(), "x", 400, n=4, rng=random.Random(1), night="2026-10-02", pace=0)
    assert (row["sampled"], row["live"], row["gone"], row["unknown"]) == (4, 1, 1, 2)
    assert row["gone_ids"] == ["t_residential_listings:1"] and row["gated"] is True
    assert S.gone_share(row) == pytest.approx(0.5)


def test_failed_controls_make_the_website_void_not_dead(monkeypatch):
    ctl, ads = _ads("c", 5), _ads("a", 4)
    answers = {f"https://x/c{i}": DEAD for i in range(5)}                 # a block that answers 404
    answers.update({f"https://x/a{i}": DEAD for i in range(4)})
    _fake(monkeypatch, ctl, ads, answers)
    row = S.score_site(object(), "x", 400, n=4, rng=random.Random(1), night="2026-10-02", pace=0)
    assert row["sampled"] == row["gone"] == 0 and row["note"].startswith("void")
    assert S.gone_share(row) is None and S.rating_cap([row])[0] == 9     # not measured, not a 5


def test_a_tiny_website_has_no_gate_and_an_ad_without_a_url_is_unknown(monkeypatch):
    ads = _ads("a", 2) + [{"table": "t_residential_listings", "id": 9, "ad_number": None, "listing_url": None}]
    _fake(monkeypatch, ads[:2], ads, {"https://x/a0": ALIVE, "https://x/a1": ALIVE})
    row = S.score_site(object(), "x", 3, n=3, rng=random.Random(1), night="2026-10-02", pace=0)
    assert row["gated"] is False and row["note"].startswith("no control gate")
    assert (row["sampled"], row["live"], row["gone"], row["unknown"]) == (3, 2, 0, 1)


def test_missing_table_is_reported_and_other_write_failures_raise():
    class _Missing:
        def table(self, t): return self
        def upsert(self, *a, **k): return self
        def execute(self):
            raise RuntimeError("{'code': 'PGRST205', 'message': \"Could not find the table 'public.ops_dead_visible_score'\"}")

    class _Down(_Missing):
        def execute(self): raise RuntimeError("connection reset")

    assert S.write_rows(_Missing(), [_row()]).startswith(S.TABLE + " does not exist yet")
    with pytest.raises(RuntimeError):
        S.write_rows(_Down(), [_row()])
