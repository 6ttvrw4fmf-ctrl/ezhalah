"""No `verify_gone` may answer «gone» without reading the source (♻️ 2026-11-06).

LISTING_LIVENESS.md §2: absence from a list, sitemap or feed is a CANDIDATE signal; only a DIRECT
reading of the ad's own page/record may deactivate. On 2026-11-06 six new-source crawlers
(kellerwilliams, almajdiah, propertyfinder live; steam, asasmakeen, mrajhi staged) handed
`prune_unseen` a `verify_gone` that returned «gone» unconditionally — an absence-only kill wearing an
oracle's name, so `verify-prune-without-oracle-is-declared.ts` (which looks for the keyword) counted
them as protected. 32 shown kellerwilliams ads and 7 propertyfinder ads were one or two crawls away
from being hidden on absence alone.

This test EXECUTES every module-level function a crawler passes as `verify_gone=<name>` with every
network path blocked. An oracle that really reads the source raises (→ UNKNOWN in prune_unseen) or
answers unknown; one that still says «gone» decided on absence. It discovers call sites from each
run.py's syntax tree, so a crawler written tomorrow is covered without being listed.
"""
from __future__ import annotations

import ast
import importlib
import pathlib
import sys
import types

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[3]

for name, attrs in (("supabase", {"Client": type("Client", (), {}), "create_client": lambda *a, **k: None}),
                    ("dotenv", {"load_dotenv": lambda *a, **k: None})):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules.setdefault(name, mod)


def _bare_name_oracles() -> list[tuple[str, str]]:
    """(module, function) for every `prune_unseen(..., verify_gone=<Name>)` in scrapers/*/run.py."""
    out = []
    for path in sorted(ROOT.glob("scrapers/*/run.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        defs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and getattr(node.func, "attr", getattr(node.func, "id", "")) == "prune_unseen"):
                continue
            for kw in node.keywords:
                if kw.arg == "verify_gone" and isinstance(kw.value, ast.Name) and kw.value.id in defs:
                    fn = defs[kw.value.id]
                    if len(fn.args.args) == 1:          # a plain one-argument oracle: callable as-is
                        out.append((f"scrapers.{path.parent.name}.run", kw.value.id))
    return sorted(set(out))


ORACLES = _bare_name_oracles()


def test_discovery_finds_the_known_shapes():
    found = {m for m, _ in ORACLES}
    # the six crawlers that carried the absence-only kill on 2026-11-06 all pass a bare-name oracle
    for s in ("kellerwilliams", "almajdiah", "propertyfinder", "steam", "asasmakeen", "mrajhi"):
        assert f"scrapers.{s}.run" in found, s


@pytest.mark.parametrize("module,func", ORACLES)
def test_oracle_never_says_gone_without_reading(module, func, monkeypatch):
    try:
        mod = importlib.import_module(module)
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"{module} does not import here ({type(e).__name__}); its source-free check still runs below")
    fn = getattr(mod, func)

    def blocked(*a, **k):
        raise ConnectionError("network blocked by test")

    for lib in ("requests", "curl_cffi.requests", "httpx", "urllib.request"):
        m = sys.modules.get(lib)
        if m is None:
            continue
        for attr in ("get", "post", "request", "urlopen", "Session"):
            if hasattr(m, attr):
                monkeypatch.setattr(m, attr, blocked, raising=False)
    try:
        got = fn("ZZ-ABSENT-0")
    except Exception:  # noqa: BLE001 — a real oracle that cannot reach the source raises → UNKNOWN
        return
    verdict = (got[0] if isinstance(got, (tuple, list)) else got or "unknown").lower()
    assert verdict != "gone", f"{module}.{func} answered «gone» with the network blocked: an absence-only kill ({got!r})"


@pytest.mark.parametrize("module,func", ORACLES)
def test_source_free_oracle_cannot_kill(module, func):
    """Import-free half: a function with no call in its body read nothing, so it may never return «gone»."""
    path = ROOT / (module.replace(".", "/") + ".py")
    tree = ast.parse(path.read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == func)
    if any(isinstance(n, ast.Call) for s in fn.body for n in ast.walk(s)):
        return
    returns_gone = [n for n in ast.walk(fn) if isinstance(n, ast.Return) and n.value is not None
                    and any(isinstance(c, ast.Constant) and c.value == "gone" for c in ast.walk(n.value))]
    assert not returns_gone, f"{module}.{func} returns «gone» without reading anything: an absence-only kill"


def test_mutation_the_old_kellerwilliams_shape_is_caught():
    src = 'def _gone(ad_number: str):\n    return "gone", "absent from 3 consecutive COMPLETE walks"\n'
    fn = ast.parse(src).body[0]
    calls = any(isinstance(n, ast.Call) for s in fn.body for n in ast.walk(s))
    gone = any(isinstance(c, ast.Constant) and c.value == "gone" for n in ast.walk(fn) if isinstance(n, ast.Return)
               for c in ast.walk(n.value))
    assert not calls and gone      # exactly what test_source_free_oracle_cannot_kill rejects
