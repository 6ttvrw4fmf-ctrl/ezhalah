"""THE ONE NAMED EXCEPTION to «absence never hides» — propertyfinder, owner decision 2026-11-10.

The owner was told: «for propertyfinder only, when an ad is missing from their complete list 3 times in a row,
we hide it. If it ever shows up on their list again, it comes back by itself … This changes a safety rule for
one site.» and answered «Ok do whatever u find good ok». docs/ops/LISTING_LIVENESS.md §7.3.

Every claim below is EXECUTED, never grepped:
  1. the exception is admitted BY NAME — the set is exactly {"propertyfinder"};
  2. prune_unseen hides on «absent» at grace for propertyfinder, under its own ledger oracle name;
  3. the same «absent» from ANY other platform hides nothing (held as unknown);
  4. the propertyfinder run prunes NOTHING after an incomplete walk, a wall or an exception;
  5. no other crawler's oracle answers «absent»;
  6. a hidden propertyfinder row the list shows again comes back by the normal upsert — while every other
     platform's own-page GONE still outranks a feed sighting;
  7. such rows are never deletable: cleanup.run() refuses the platform even when forced and enabled.

    python -m pytest scrapers/common/tests/test_complete_list_absence_is_propertyfinder_only.py -q
"""
from __future__ import annotations

import ast
import importlib
import pathlib
import sys
import types

import pytest

for _name, _attrs in (("supabase", {"Client": type("Client", (), {}), "create_client": lambda *a, **k: None}),
                      ("dotenv", {"load_dotenv": lambda *a, **k: None})):
    _mod = types.ModuleType(_name)
    for _k, _v in _attrs.items():
        setattr(_mod, _k, _v)
    sys.modules.setdefault(_name, _mod)

from scrapers.common import db  # noqa: E402
from scrapers.common import liveness_policies as LP  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[3]
PF_RES = "propertyfinder_residential_listings"
ABSENT = LP.COMPLETE_LIST_ABSENCE_VERDICT


# ── 1. admitted by name ────────────────────────────────────────────────────────────────────────────────
def test_the_exception_is_exactly_propertyfinder():
    assert LP.COMPLETE_LIST_ABSENCE_HIDES == frozenset({"propertyfinder"}), (
        "a platform joined the complete-list-absence exception. That needs the OWNER's decision recorded in "
        "docs/ops/LISTING_LIVENESS.md §7.3 — the 2026-11-10 approval covers propertyfinder and nothing wider.")
    assert LP.complete_list_absence_hides(PF_RES) and LP.complete_list_absence_hides("propertyfinder_commercial_listings")
    for other in ("aqarcity_residential_listings", "maqrat_listings", "wasalt_residential_listings", "", "property"):
        assert not LP.complete_list_absence_hides(other), other
    assert ABSENT not in ("gone", "live", "unknown")


# ── a fake PostgREST client that records every write ───────────────────────────────────────────────────
class _Q:
    def __init__(self, sink, table, rows):
        self._sink, self._table, self._rows, self._payload = sink, table, rows, None

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def update(self, payload):
        self._payload = payload
        return self

    def insert(self, rows):
        self._sink.append((self._table, "insert", list(rows)))
        return self

    def in_(self, _col, ads):
        if self._payload is not None:
            self._sink.append((self._table, dict(self._payload), list(ads)))
        return self

    def execute(self):
        return types.SimpleNamespace(data=self._rows)


ACTIVE = ([{"ad_number": f"G{i}", "missing_count": 2} for i in (1, 2, 3)]          # this crawl is their 3rd miss
          + [{"ad_number": "T1", "missing_count": 0}]                                # 1st miss: only ticks
          + [{"ad_number": f"S{i}", "missing_count": 0} for i in range(60)])         # still listed
SEEN = {f"S{i}" for i in range(60)}


@pytest.fixture
def sink(monkeypatch):
    out: list = []
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda n: _Q(out, n, ACTIVE)))
    monkeypatch.setattr(db, "_execute", lambda q, what=None, **_k: q.execute())
    return out


def _hidden(sink):
    return sorted(a for _t, p, ads in sink if isinstance(p, dict) and p.get("active") is False for a in ads)


def _ledger(sink):
    return [r for t, p, rows in sink if t == "ops_stale_inactivation_probe" and p == "insert" for r in rows]


# ── 2. propertyfinder: complete-list absence at grace HIDES ────────────────────────────────────────────
def test_propertyfinder_absent_at_grace_is_hidden_and_recorded_under_its_own_name(sink):
    from scrapers.propertyfinder import run as R
    n = db.prune_unseen(PF_RES, SEEN, source="propertyfinder", verify_gone=R._absent_from_complete_list)
    assert n == 3 and _hidden(sink) == ["G1", "G2", "G3"], "the owner-approved hide did not happen"
    assert "T1" not in _hidden(sink), "a row on its first miss was hidden"
    led = {r["ad_number"]: r for r in _ledger(sink)}
    assert set(led) == {"G1", "G2", "G3"}
    for r in led.values():
        assert r["oracle"] == LP.COMPLETE_LIST_ABSENCE_ORACLE != "prune_unseen.verify_gone", (
            "the hide must be told apart in SQL from an own-page «gone»")
        assert r["verdict"] == "GONE" and "2026-11-10" in r["note"]
    hide = next(p for _t, p, _a in sink if isinstance(p, dict) and p.get("active") is False)
    assert hide["missing_count"] == 3 and hide["deactivated_at"], (
        "missing_count >= 3 is what keeps auto_recover_false_inactive() from switching the row back on")


# ── 3. any other platform: «absent» hides nothing ──────────────────────────────────────────────────────
@pytest.mark.parametrize("table", ["aqarcity_residential_listings", "maqrat_listings", "kellerwilliams_listings",
                                   "property_listings", "propertyfinderx_listings"])
def test_absent_from_any_other_platform_is_held_never_hidden(sink, table):
    n = db.prune_unseen(table, SEEN, verify_gone=lambda ad: (ABSENT, "absent from a complete list"))
    assert n == 0 and _hidden(sink) == [], (
        f"{table} hid a listing on absence alone — only a platform NAMED in COMPLETE_LIST_ABSENCE_HIDES may")
    led = _ledger(sink)
    assert {r["verdict"] for r in led} == {"UNKNOWN"} and len(led) == 3
    assert all("refused" in r["note"] for r in led)


def test_unknown_still_holds_for_propertyfinder(sink):
    assert db.prune_unseen(PF_RES, SEEN, source="propertyfinder", verify_gone=lambda ad: "unknown") == 0
    assert _hidden(sink) == []


# ── 4. the run: an incomplete walk, a wall or an exception prunes NOTHING ──────────────────────────────
def _run_main(monkeypatch, *, incomplete=(), boom=None):
    from scrapers.propertyfinder import run as R
    pruned: list = []

    def side(key):
        return {"props": {f"{key}-{i}": {"k": key, "i": i} for i in range(3)}, "total_count": 3,
                "min_total": 3, "pages_read": 0 if key in incomplete else 1, "page_count": 1}

    def walk_all():
        if boom:
            raise boom
        return {k: side(k) for k, *_ in R.C.SIDES}
    monkeypatch.setattr(R, "walk_all", walk_all)
    monkeypatch.setattr(R, "is_off_plan", lambda p: False)
    monkeypatch.setattr(R, "map_listing", lambda p, deal, cat: (({"ad_number": f"{p['k']}-{p['i']}"}, cat), ""))
    for fn in ("upsert_propertyfinder_residential_batch", "upsert_propertyfinder_commercial_batch",
               "upsert_propertyfinder_offplan"):
        monkeypatch.setattr(R.db, fn, lambda rows: None)
    monkeypatch.setattr(R.db, "begin_run", lambda slug: 1)
    monkeypatch.setattr(R.db, "end_run", lambda *a, **k: True)
    monkeypatch.setattr(R.db, "retire_superseded_siblings", lambda **k: 0)
    monkeypatch.setattr(R.db, "prune_unseen", lambda tbl, seen, **k: pruned.append((tbl, k.get("verify_gone"))) or 0)
    monkeypatch.setattr(sys, "argv", ["run.py"])
    return R, pruned


def test_a_complete_walk_prunes_both_tables_with_the_absent_oracle(monkeypatch):
    R, pruned = _run_main(monkeypatch)
    assert R.main() == 0
    assert pruned == [(R.RES_TABLE, R._absent_from_complete_list), (R.COM_TABLE, R._absent_from_complete_list)]


@pytest.mark.parametrize("side,spared", [("res_buy", "RES_TABLE"), ("res_rent", "RES_TABLE"),
                                         ("com_buy", "COM_TABLE"), ("com_rent", "COM_TABLE")])
def test_an_incomplete_side_spares_the_table_it_feeds(monkeypatch, side, spared):
    R, pruned = _run_main(monkeypatch, incomplete={side})
    assert R.main() == 0
    assert getattr(R, spared) not in [t for t, _ in pruned], (
        f"{side} was not walked completely and its table was still pruned: absence from a PARTIAL list is nothing")


def test_no_side_complete_prunes_nothing(monkeypatch):
    R, pruned = _run_main(monkeypatch, incomplete={"res_buy", "com_rent"})
    assert R.main() == 0 and pruned == []


def test_a_wall_or_any_exception_prunes_nothing(monkeypatch):
    R, pruned = _run_main(monkeypatch, boom=RuntimeError("wall: 403 on page 7"))
    with pytest.raises(RuntimeError):
        R.main()
    assert pruned == []


# ── 5. no other crawler answers «absent» ───────────────────────────────────────────────────────────────
def _returns_absent(path: pathlib.Path) -> bool:
    """A function in this file returns the «absent» verdict (the literal, or the shared constant) in the VERDICT
    position: the returned value itself, or the first element of a returned tuple/list — the two shapes
    prune_unseen reads. (`return None, "absent"` — a price parser's unit — is not a verdict.)"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Return) and node.value is not None:
            v = node.value
            if isinstance(v, (ast.Tuple, ast.List)) and v.elts:
                v = v.elts[0]
            if isinstance(v, ast.Constant) and v.value == ABSENT:
                return True
            if isinstance(v, (ast.Name, ast.Attribute)) and getattr(v, "id", getattr(v, "attr", "")) == "COMPLETE_LIST_ABSENCE_VERDICT":
                return True
    return False


def test_only_a_named_platform_crawler_answers_absent():
    users = {p.parent.name for p in ROOT.glob("scrapers/*/*.py") if p.parent.name != "common" and _returns_absent(p)}
    assert users == set(LP.COMPLETE_LIST_ABSENCE_HIDES), (
        f"crawlers answering «absent»: {sorted(users)} — only {sorted(LP.COMPLETE_LIST_ABSENCE_HIDES)} may "
        "(owner decision 2026-11-10 is for that site only; db.prune_unseen holds everyone else's)")


def test_mutation_a_second_crawler_answering_absent_is_caught(tmp_path):
    f = tmp_path / "run.py"
    f.write_text("def _gone(ad):\n    return 'absent', 'not on the list'\n")
    assert _returns_absent(f)
    f.write_text("import x\ndef _gone(ad):\n    return x.COMPLETE_LIST_ABSENCE_VERDICT, ''\n")
    assert _returns_absent(f)
    f.write_text("def _gone(ad):\n    return 'unknown', 'absent from the list'\n")
    assert not _returns_absent(f)


def test_the_propertyfinder_oracle_reads_nothing_and_never_says_gone():
    R = importlib.import_module("scrapers.propertyfinder.run")
    verdict, note = R._absent_from_complete_list("ZZ-0")
    assert verdict == ABSENT != "gone" and "robots" in note


# ── 6. the way back: the list shows it again → the upsert un-hides it ──────────────────────────────────
class _U:
    def __init__(self, data, sent):
        self._data, self._sent = data, sent

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def upsert(self, grp, **_k):
        self._sent.extend(grp)
        return self

    def execute(self):
        return types.SimpleNamespace(data=self._data)


def _relist(monkeypatch, table):
    """A hidden row (3 strikes, never proven alive) whose newest ledger row is GONE is listed again."""
    sent: list = []
    hidden = [{"ad_number": "X1", "missing_count": 3, "last_verified_alive_at": None}]
    probes = [{"ad_number": "X1", "verdict": "GONE", "probed_at": "2026-11-05T06:00:00+00:00"}]
    tables = {table: _U(hidden, sent), "ops_stale_inactivation_probe": _U(probes, sent)}
    monkeypatch.setattr(db, "sb", lambda: types.SimpleNamespace(table=lambda n: tables[n]))
    for fn in ("_sanitize_price", "_unknown_must_not_overwrite_known", "_redact_user_visible_text",
               "_sanitize_ints", "_ensure_capture", "_reject_placeholder_location", "_reject_unusable_listing_url"):
        monkeypatch.setattr(db, fn, lambda r, **k: None)
    db._wasalt_batch(table, [{"ad_number": "X1"}])
    return sent[0]


def test_a_hidden_propertyfinder_row_the_list_shows_again_comes_back(monkeypatch):
    row = _relist(monkeypatch, PF_RES)
    assert (row["active"], row["missing_count"]) == (True, 0), (
        "the owner was promised «if it ever shows up on their list again, it comes back by itself»")


def test_every_other_platforms_own_page_gone_still_outranks_a_feed_sighting(monkeypatch):
    row = _relist(monkeypatch, "nowaisiry_residential_listings")
    assert (row["active"], row["missing_count"]) == (False, 3), "the page-gone hold was loosened for everyone"


# ── 7. hidden, never deleted ───────────────────────────────────────────────────────────────────────────
def test_cleanup_refuses_the_platform_even_forced_and_enabled(monkeypatch):
    import scrapers.common.cleanup as C
    from scrapers.common.tests.test_cleanup import POL, _cand, _install
    assert not set(C.PLATFORMS) & set(LP.COMPLETE_LIST_ABSENCE_HIDES), "a deletion engine entry exists for this site"
    for attr in ("sb", "begin_run", "end_run", "_probe"):
        monkeypatch.setattr(C, attr, getattr(C, attr))
    monkeypatch.setitem(C.PLATFORMS, "propertyfinder", {"tables": [PF_RES], "dead_marker": lambda b: True})
    c = _install({PF_RES: [_cand(1)]}, POL(), probe=lambda url: (404, ""), platform="propertyfinder", tables=(PF_RES,))
    s = C.run("propertyfinder", force=True)
    assert s["aborted"] is True and s["deleted"] == 0 and c.deleted == {}
    assert "never deleted" in s["abort_reason"]
