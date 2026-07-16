"""Null-deal guard (fix/null-deal-recovery, 2026-07-16): transaction_type must be TOTAL at
the scraper layer — no scraper may ever write transaction_type=None/NULL.

Context: the 2026-07-16 null-deal investigation proved the ~1,300 rows Batch 2 quarantined
(NULL transaction_type through listing_native_location_v2) did NOT come from the scrapers —
live check found 0 NULL/blank transaction_type across all 70 *_listings tables, active and
inactive, and every writer already maps deal totally. The NULL was manufactured in the SQL
location layer (listing_native_location_v1's phasea/legacy arms hard-code NULL, with only
stale listing_location_canonical.purpose as fallback) and is fixed by
supabase/migrations/20260717_deal_truth_recovery.sql. A scraper that CAN emit None would
silently re-populate the quarantine class (sync eligibility
`lower(transaction_type) in ('buy','rent')` drops the row from search entirely), so this
hermetic source-lint (AST-based, no network/DB) locks the invariant:

  1. Every `"transaction_type": <expr>` dict entry in a writer module must be provably
     total AND canonical: the literal "Buy"/"Rent", a conditional whose BOTH branches are
     those literals, or a name/call whose every binding/return is one of those shapes.
  2. All 34 known writer modules must keep writing transaction_type at all (coverage — a
     dropped key would surface as NULL on every new row).

Run: python -m pytest scrapers/common/tests/test_deal_mapping_total.py -v
"""
from __future__ import annotations

import ast
from pathlib import Path

SCRAPERS_DIR = Path(__file__).resolve().parents[2]  # …/scrapers
REPO_ROOT = SCRAPERS_DIR.parent

CANONICAL = {"Buy", "Rent"}

# Every module that writes a transaction_type row value (33 run.py + aqar's enrichment
# writer, which builds the row dicts for aqar_residential/commercial). aqar/run.py itself
# is an orchestrator and writes no rows.
WRITERS = sorted(
    p for p in SCRAPERS_DIR.glob("*/run.py") if p.parent.name != "aqar"
) + [SCRAPERS_DIR / "aqar" / "enrich_residential.py"]


def _is_canonical_const(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and node.value in CANONICAL


def _is_total_expr(node: ast.AST, tree: ast.Module) -> bool:
    """True when the expression can only ever evaluate to 'Buy' or 'Rent'."""
    if _is_canonical_const(node):
        return True
    if isinstance(node, ast.IfExp):
        return _is_canonical_const(node.body) and _is_canonical_const(node.orelse)
    if isinstance(node, ast.Name):
        return _name_is_total(node.id, tree)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        return _local_fn_is_total(node.func.id, tree)
    return False


def _name_is_total(name: str, tree: ast.Module) -> bool:
    """Every assignment binding `name` anywhere in the module must be total."""
    bindings = [
        n.value
        for n in ast.walk(tree)
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)
    ]
    return bool(bindings) and all(
        _is_canonical_const(v)
        or (isinstance(v, ast.IfExp)
            and _is_canonical_const(v.body) and _is_canonical_const(v.orelse))
        or (isinstance(v, ast.Call) and isinstance(v.func, ast.Name)
            and _local_fn_is_total(v.func.id, tree))
        for v in bindings
    )


def _local_fn_is_total(fn_name: str, tree: ast.Module) -> bool:
    """A module-level helper (e.g. souq24's _deal) is total when every return statement
    returns the literal 'Buy' or 'Rent' — no bare return, no None, no computed value."""
    for n in tree.body:
        if isinstance(n, ast.FunctionDef) and n.name == fn_name:
            returns = [r for r in ast.walk(n) if isinstance(r, ast.Return)]
            return bool(returns) and all(
                r.value is not None and _is_canonical_const(r.value) for r in returns
            )
    return False


def _deal_entries(tree: ast.Module) -> list[tuple[int, ast.AST]]:
    out: list[tuple[int, ast.AST]] = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Dict):
            for k, v in zip(n.keys, n.values):
                if isinstance(k, ast.Constant) and k.value == "transaction_type":
                    out.append((k.lineno, v))
    return out


def test_every_transaction_type_write_is_total_and_canonical():
    offenders: list[str] = []
    for path in WRITERS:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for lineno, value in _deal_entries(tree):
            if not _is_total_expr(value, tree):
                offenders.append(
                    f"{path.relative_to(REPO_ROOT)}:{lineno}: "
                    f"transaction_type value is not provably total/canonical "
                    f"({ast.dump(value)[:120]})"
                )
    assert not offenders, (
        "A scraper can emit a transaction_type other than the literal 'Buy'/'Rent' "
        "(None/unknown deals get quarantined out of search by the sync's eligibility "
        "predicate — the exact class the 2026-07-16 null-deal recovery closed):\n"
        + "\n".join(offenders)
    )


def test_every_known_writer_still_writes_transaction_type():
    missing = [
        str(path.relative_to(REPO_ROOT))
        for path in WRITERS
        if not _deal_entries(ast.parse(path.read_text(encoding="utf-8")))
    ]
    assert not missing, (
        "Writer module no longer writes a transaction_type key — every new row it upserts "
        "would carry NULL deal and be quarantined out of search:\n" + "\n".join(missing)
    )


def test_recovery_migration_keeps_both_deal_truth_diffs():
    """Guard the two one-line diffs the recovery depends on: the [DEAL-SRC] coalesce order
    (live base row before the v1/llc location layer) and the [DEAL-DRIFT] re-select arm."""
    mig = (
        REPO_ROOT / "supabase" / "migrations" / "20260717_deal_truth_recovery.sql"
    ).read_text(encoding="utf-8")
    assert "COALESCE(a.transaction_type, v1.transaction_type)" in mig, (
        "[DEAL-SRC] regressed: listing_native_location_v2 must prefer the live base row's "
        "transaction_type over the stale v1/listing_location_canonical layer"
    )
    assert "s3.deal_ar is distinct from" in mig, (
        "[DEAL-DRIFT] regressed: deal drift must remain a sync re-select trigger, or "
        "relabels never propagate to already-indexed rows"
    )
