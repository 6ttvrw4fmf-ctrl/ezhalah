"""THE COMMERCIAL BRANCH MUST BE REACHABLE — fleet guard for a category split that can never fire.

THE BUG THIS EARNED (october, found 2026-09-24, live since the platform was built).
`map_item()` ended with:

    category = N.category_for_type(property_type)      # → "Residential" / "Commercial", CAPITALISED
    ...
    return row, category

and `crawl()` routed on:

    (com if cat == "commercial" else res).append(row)  # ← lowercase

`category_for_type` never returns a lowercase word, so `cat == "commercial"` was False for EVERY
row ever parsed. Every october listing — shops and warehouses included — was appended to `res` and
written to october_residential_listings; `october_commercial_listings` was never written at all
(measured: 0 rows, while a محل and a مستودع sat in the residential table). The same typo silently
killed a second reader in map_item, `if category == "commercial": baths = None`.

Nothing caught it for the platform's whole life, and nothing could have, because every layer
below the typo was healthy: the taxonomy was right, the mapping was right, both tables existed,
the upsert worked, the run reported success, and the frontend's commercial-misfile recovery
(remote.ts `attachComScopeB`, added 2026-08-29 — its comment cites this platform's row 9618987)
made the damage invisible to users. A wrong-but-plausible constant is exactly the defect class
that ships green.

WHY THIS SHAPE OF CHECK. Grepping for `.lower()` would be a source-TEXT tripwire — the thing this
repo has been burned by repeatedly (AGENTS.md: "Barriers for this class must EXECUTE"). Five
platforms (arkaan, aqaralsaudia, rakez, suwar, amlakalahsa) compute the SAME capitalised value and
are perfectly correct, because they convert at the return; a text rule would have failed all five
and taught the next author to silence it. rawasidark is capitalised on BOTH sides and is also
correct. So the invariant is not "call .lower()" — it is:

    the literal a scraper's res/com split compares against must be a value that scraper's own
    mapper can actually PRODUCE, i.e. both branches are reachable.

The producible set is computed by EXECUTING the real `normalize.category_for_type` (never a copy,
never a hardcoded "Residential"/"Commercial" — if that helper's casing ever changes, this guard
follows it) and applying the file's own transforms as read from its AST.

Run: python -m pytest scrapers/common/tests/test_category_split_branch_is_reachable.py -v
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scrapers.common import normalize as N  # noqa: E402

SCRAPERS = ROOT / "scrapers"
WRITERS = sorted(SCRAPERS.glob("*/run.py"))

# The REAL casing, executed — not asserted from memory. Both words, because a platform may legally
# compare against either one as long as its mapper produces it (rawasidark compares "Commercial").
_REAL = {N.category_for_type("Villa"), N.category_for_type("Shop")}
assert len(_REAL) == 2, f"category_for_type collapsed to one answer: {_REAL}"

_SPLIT_NAMES = ("com", "com_rows", "sold_com", "commercial")


def _is_split(node: ast.IfExp) -> bool:
    """`(com if <name> == "<word>" else res)` — the dual-table ROUTING expression.

    `node.test.left` must be a bare local Name. That is what separates routing from the `--type`
    CLI filter, `(com if args.type == "commercial" else [])`, which shares the exact IfExp shape
    but selects which table to WRITE this run, not which table a row belongs in. Matching those
    made this guard report five healthy platforms as broken on its first run.
    """
    return (isinstance(node.body, ast.Name) and node.body.id in _SPLIT_NAMES
            and isinstance(node.orelse, ast.Name)
            and isinstance(node.test, ast.Compare)
            and isinstance(node.test.left, ast.Name)
            and len(node.test.ops) == 1 and isinstance(node.test.ops[0], ast.Eq)
            and len(node.test.comparators) == 1
            and isinstance(node.test.comparators[0], ast.Constant)
            and isinstance(node.test.comparators[0].value, str))


def _splits(tree: ast.AST) -> list[ast.IfExp]:
    return [n for n in ast.walk(tree) if isinstance(n, ast.IfExp) and _is_split(n)]


def split_literals(tree: ast.AST) -> set[str]:
    return {n.test.comparators[0].value for n in _splits(tree)}


def _functions(tree: ast.AST) -> dict[str, ast.FunctionDef]:
    return {n.name: n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


def _enclosing(tree: ast.AST, node: ast.AST):
    """The function a node sits in — the scope whose assignments bind the split's variable."""
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) and any(n is node for n in ast.walk(fn)):
            return fn
    return None


def _trace_to_mapper(tree: ast.AST, scope: ast.AST, var: str):
    """`row, cat = map_listing(...)` → (the map_listing FunctionDef, cat's index in the unpack).

    This is the whole point of the guard: it follows the ACTUAL routing path — the split's own
    variable back to the function that produced it — instead of reading unrelated 2-tuple returns
    elsewhere in the file (`_verify_gone` returning `(bool, reason)` is not a category).
    """
    funcs = _functions(tree)
    for stmt in ast.walk(scope):
        if not isinstance(stmt, ast.Assign):
            continue
        for target in stmt.targets:
            if not isinstance(target, ast.Tuple):
                continue
            names = [e.id if isinstance(e, ast.Name) else None for e in target.elts]
            if var not in names:
                continue
            idx = names.index(var)
            rhs = stmt.value
            # One hop through an intermediate: `mapped = map_listing(...)` / `row, cat = mapped`.
            if isinstance(rhs, ast.Name):
                for s2 in ast.walk(scope):
                    if (isinstance(s2, ast.Assign)
                            and any(isinstance(t, ast.Name) and t.id == rhs.id for t in s2.targets)
                            and isinstance(s2.value, ast.Call)):
                        rhs = s2.value
                        break
            if isinstance(rhs, ast.Call) and isinstance(rhs.func, ast.Name) and rhs.func.id in funcs:
                return funcs[rhs.func.id], idx
    return None, None


class _Unresolved(Exception):
    """The category expression is not one of the shapes this guard can evaluate."""


def _strings(node: ast.AST, scope: ast.AST) -> set[str]:
    """Every string value `node` can evaluate to. Raises _Unresolved on an unknown shape."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.IfExp):                       # "a" if cond else "b"
        return _strings(node.body, scope) | _strings(node.orelse, scope)
    if isinstance(node, ast.Call):
        fn = node.func
        # <expr>.lower() / .upper() — the transform that makes or breaks the comparison.
        if isinstance(fn, ast.Attribute) and fn.attr in ("lower", "upper"):
            vals = _strings(fn.value, scope)
            return {v.lower() if fn.attr == "lower" else v.upper() for v in vals}
        # category_for_type(...) — EXECUTED above, not assumed.
        if isinstance(fn, ast.Attribute) and fn.attr == "category_for_type":
            return set(_REAL)
        if isinstance(fn, ast.Name) and fn.id == "category_for_type":
            return set(_REAL)
        raise _Unresolved(ast.dump(node)[:120])
    if isinstance(node, ast.Name):                        # resolve the local assignment(s)
        found: set[str] = set()
        for stmt in ast.walk(scope):
            if isinstance(stmt, ast.Assign) and any(
                    isinstance(t, ast.Name) and t.id == node.id for t in stmt.targets):
                found |= _strings(stmt.value, scope)
        if not found:
            raise _Unresolved(f"name {node.id!r} has no resolvable assignment")
        return found
    raise _Unresolved(ast.dump(node)[:120])


def produced_categories(mapper: ast.AST, idx: int) -> tuple[set[str], list[str]]:
    """(values the mapper's category slot can yield, notes about shapes we could not read)."""
    produced: set[str] = set()
    unresolved: list[str] = []
    for ret in ast.walk(mapper):
        if not (isinstance(ret, ast.Return) and isinstance(ret.value, ast.Tuple)
                and len(ret.value.elts) > idx):
            continue
        slot = ret.value.elts[idx]
        if isinstance(slot, ast.Constant) and slot.value is None:
            continue                                 # `return None, ...` — a skip, not a routing
        try:
            produced |= _strings(slot, mapper)
        except _Unresolved as e:
            unresolved.append(str(e))
    return produced, unresolved


def analyse(source: str) -> tuple[list[str], int]:
    """(provably-dead branches, number of branches PROVEN reachable).

    A branch is only reported when the proof is COMPLETE: every return in the mapper's category
    slot resolved to a known string, and the split's literal is not among them. That was october's
    exact signature. When any return is unreadable — the category comes from a source JSON field
    (`(L.get("category") or "residential").lower()`, abwbna), or via a chained helper whose result
    is tuple-unpacked (jawher) — nothing is claimed, because a guard that cried wolf at eight
    healthy platforms would be silenced within a week and protect nothing.

    The second return value is what keeps that honesty from decaying into a guard that proves
    nothing at all; see the floor test below.
    """
    tree = ast.parse(source)
    problems: list[str] = []
    proven = 0
    for split in _splits(tree):
        lit = split.test.comparators[0].value
        scope = _enclosing(tree, split)
        if scope is None:
            continue
        mapper, idx = _trace_to_mapper(tree, scope, split.test.left.id)
        if mapper is None:
            continue        # routed from a value this guard cannot follow
        produced, unresolved = produced_categories(mapper, idx)
        if lit in produced:
            proven += 1
        elif not unresolved and produced:
            problems.append(
                f"split compares to {lit!r}, which {mapper.name}() can never produce "
                f"(producible: {sorted(produced)}) — that branch is DEAD and its table can "
                f"never be written")
    return sorted(set(problems)), proven


def unreachable_branches(source: str) -> list[str]:
    return analyse(source)[0]


# ── THE FLEET ───────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("path", WRITERS, ids=lambda p: p.parent.name)
def test_every_dual_table_scraper_can_reach_its_commercial_branch(path: Path):
    problems = unreachable_branches(path.read_text(encoding="utf-8"))
    assert not problems, f"{path.relative_to(ROOT)}: " + " | ".join(problems)


# Platforms where the guard achieves a COMPLETE proof today. Shrink-only ratchet: a refactor that
# makes a mapper unreadable drops this number and fails here rather than quietly narrowing what is
# guarded. Raise the floor when the number goes up; never lower it to make a red run green.
PROVEN_FLOOR = 90


def test_the_guard_still_proves_reachability_for_most_of_the_fleet():
    """AGENTS.md's nine-dark-detectors failure: a guard that stops matching reads as a clean bill
    of health. `analyse` deliberately stays silent on shapes it cannot read, so without this floor
    it could decay to proving NOTHING — every platform "passing" — and nobody would notice.
    """
    proven = sum(analyse(p.read_text(encoding="utf-8"))[1] for p in WRITERS)
    assert proven >= PROVEN_FLOOR, (
        f"only {proven} category splits are still provably reachable (floor {PROVEN_FLOOR}) — the "
        f"mapper shape moved and this guard is now checking far less than it was written to check")


# ── THE SECOND HALF OF THE SAME BUG: a flipped row needs its twin retired ───────────────────────
# Fixing a category split MOVES rows between tables, and `prune_unseen` cannot clean up the row
# left behind: it reasons from ABSENCE one table at a time, its circuit breakers protect the orphan
# rather than age it out, and `verify_gone` then asks "is this URL still live?" — it is, because the
# ad is alive in the sibling table — so the verdict 'live' resets missing_count and makes the orphan
# IMMORTAL. One source ad, two cards, one URL. Measured on sadin (five commercial rows still
# missing_count=0 five weeks after their last parse) and on arkaan's AK907.
#
# october had BOTH halves of this bug: the dead split, and no retire call to clean up the flip the
# fix causes. The 35 platforms that were missing the call have since been backfilled, so the
# baseline is EMPTY and every dual-table pruner is covered. Kept as a ratchet, not deleted: a NEW
# dual-table scraper without the call is RED, and an entry added here would have to be justified.
#
# NOT COVERED, stated rather than silently skipped: 10 scrapers route res/com but never call
# prune_unseen at all (alta, amaall, aqarnajran, deal, fahadalshahri, ksaaqar, remal, sadiqeltajer,
# shmoualshmal, wslnaa). Whether a category flip strands a row on those depends on how each one
# deactivates instead, which nobody has analysed — that is a separate question, not this guard's.
RETIRE_BASELINE: set[str] = set()


def _calls(tree: ast.AST, name: str) -> bool:
    return any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == name
               for n in ast.walk(tree))


def _dual_table_pruners() -> dict[str, bool]:
    """{platform: calls retire_superseded_siblings} for every scraper that routes AND prunes.

    Membership is decided by real CALLS, never by `"prune_unseen" in src`: alta only mentions the
    name in a prose paragraph, and the substring version of this function counted it as a pruner
    and put it in the baseline. A comment is not a code path — the same trap this file's own
    ordering assertion fell into.
    """
    out = {}
    for path in WRITERS:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        if not (split_literals(tree) and _calls(tree, "prune_unseen")):
            continue
        out[path.parent.name] = _calls(tree, "retire_superseded_siblings")
    return out


def test_a_new_dual_table_scraper_retires_its_superseded_siblings():
    regressions = sorted(p for p, has in _dual_table_pruners().items()
                         if not has and p not in RETIRE_BASELINE)
    assert not regressions, (
        f"{regressions} route rows between a residential and a commercial table and prune both, but "
        f"never call db.retire_superseded_siblings — a row whose category flips is abandoned in the "
        f"table it left, and prune_unseen/verify_gone make that orphan immortal (one URL, two cards)")


def test_the_retire_baseline_never_reads_better_than_reality():
    """A fixed platform must leave the baseline, or the ratchet silently stops ratcheting."""
    dual = _dual_table_pruners()
    stale = sorted(p for p in RETIRE_BASELINE if dual.get(p) is True)
    gone = sorted(p for p in RETIRE_BASELINE if p not in dual)
    assert not stale, f"{stale} now call retire_superseded_siblings — remove them from RETIRE_BASELINE"
    assert not gone, f"{gone} are in RETIRE_BASELINE but no longer route+prune — remove them"


def _call_lines(tree: ast.AST, attr: str) -> list[int]:
    """Line numbers of real `<mod>.<attr>(...)` CALLS — not mentions in comments or docstrings.

    Written after the first draft of this test asserted `src.index("retire_superseded_siblings") <
    src.index("prune_unseen")` on raw text and failed: the earliest "prune_unseen" in october is
    inside the comment explaining the ordering. A comment is not a code path.
    """
    return sorted(n.lineno for n in ast.walk(tree)
                  if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                  and n.func.attr == attr)


def test_october_specifically_retires_siblings_before_it_prunes():
    """Pinned by name: october's fix FLIPS every commercial ad out of the residential table on its
    first corrected run, so without this call it would mint an immortal duplicate for each one."""
    tree = ast.parse((SCRAPERS / "october" / "run.py").read_text(encoding="utf-8"))
    retire, prune = _call_lines(tree, "retire_superseded_siblings"), _call_lines(tree, "prune_unseen")
    assert retire, "october must call db.retire_superseded_siblings"
    assert prune and retire[0] < prune[0], (
        "retire must run BEFORE prune_unseen — it reasons from positive evidence (we classified "
        "this ad this run), and prune's guards would otherwise protect the orphan")


# ── MUTATION PROOF: the guard must FAIL on the real defect, and PASS on each real correct shape ──
_SPLIT = '''
def crawl():
    res, com = [], []
    for item in items:
        row, cat = map_item(item)
        (com if cat == "commercial" else res).append(row)
    return res, com
'''

_OCTOBER_DEFECT = '''
def map_item(item):
    category = N.category_for_type(property_type)
    return row, category
''' + _SPLIT


def test_the_guard_catches_the_october_defect():
    """The exact shipped bug, reconstructed. If this ever passes, the guard has stopped working."""
    problems = unreachable_branches(_OCTOBER_DEFECT)
    assert problems and "DEAD" in problems[0], problems


@pytest.mark.parametrize("mapper,label", [
    ('''
def map_item(item):
    category = N.category_for_type(property_type).lower()
    return row, category
''', "lower() at the assignment (the fleet majority, and october's fix)"),
    ('''
def map_item(item):
    category = "Residential" if N.category_for_type(property_type) == "Residential" else "Commercial"
    return row, category.lower()
''', "capitalised ternary, lowered at the return (rakez/suwar/amlakalahsa/aqaralsaudia)"),
    ('''
def map_item(item):
    category = N.category_for_type(property_type)
    return row, ("commercial" if category == "Commercial" else "residential")
''', "converted inside the return expression (arkaan)"),
    ('''
def map_item(item):
    return row, N.category_for_type(property_type).lower()
''', "computed directly in the return (abralosol)"),
])
def test_the_guard_passes_every_correct_shape_the_fleet_really_uses(mapper, label):
    """Six platforms compute the capitalised value and are CORRECT. A guard that failed them would
    be worse than none — the next author would silence it."""
    assert not unreachable_branches(mapper + _SPLIT), label


def test_a_capitalised_split_is_correct_when_the_mapper_produces_capitalised():
    """rawasidark compares "Commercial" against an un-lowered category. Self-consistent → allowed.
    This is why the rule is reachability, not a spelling."""
    src = '''
def map_object(o):
    category = N.category_for_type(property_type)
    return row, category
def crawl():
    res, com = [], []
    for o in objs:
        row, cat = map_object(o)
        (com if cat == "Commercial" else res).append(row)
    return res, com
'''
    assert not unreachable_branches(src)


def test_the_guard_reads_the_helper_instead_of_hardcoding_its_casing():
    """_REAL is executed from the real normalize module. Pinning it here means a change to
    category_for_type's casing cannot leave this guard quietly checking a stale vocabulary."""
    assert _REAL == {N.category_for_type("Villa"), N.category_for_type("Shop")}
    assert all(isinstance(v, str) and v for v in _REAL)
