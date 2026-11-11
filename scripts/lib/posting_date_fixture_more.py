"""Mapper inputs for verify-source-posting-date-more-sites.ts — the sites added after PR #11531.

Same contract as scripts/lib/posting_date_fixture.py (which covers the first eight platforms), split
into one file per group of sites so several people can add sites at once without touching the same
file. Each group module exposes:

  PLATFORMS = {site: (scraper module, builder, call)}
      builder(*args) → the argument list the site's REAL mapper takes (no network)
      call(module, built_args) → (row dict or None, skip note)
  CASES = {site: [(builder args, expected date_added, what the case proves), ...]}
      every site carries at least: a value read from a live ad page → what `date_added` must hold,
      and «no posting date published» → None. A site that also publishes an edit / bump / licence
      date carries a case where ONLY that date is present → None.
  MUTATIONS (optional) = {site: [(label, scraper file, find, replace, builder args), ...]}
      a source edit that re-creates a specific wrong reading (e.g. the edit date read as the posting
      date); the barrier applies it to the real module and requires a different answer than the real
      mapper gives for those args.

Nothing here maps or decides anything: the posting-date logic under test lives in the scrapers.
"""
import contextlib
import importlib
import os
import sys
import types

from scripts.lib.posting_date_fixture import _seed_catalog

_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")

GROUP_MODULES = [
    "scripts.lib.posting_date_fixture_g0",
    "scripts.lib.posting_date_fixture_g1",
    "scripts.lib.posting_date_fixture_g2",
    "scripts.lib.posting_date_fixture_g3",
    "scripts.lib.posting_date_fixture_g4",
    "scripts.lib.posting_date_fixture_g5",
    "scripts.lib.posting_date_fixture_g6",
    "scripts.lib.posting_date_fixture_g8",
    "scripts.lib.posting_date_fixture_g10",
]


def _groups():
    out = []
    for name in GROUP_MODULES:
        out.append(importlib.import_module(name))   # a listed group that is missing fails LOUDLY
    return out


def _registry(with_mutations=False):
    reg, cases, muts = {}, {}, {}
    for m in _groups():
        for site, spec in m.PLATFORMS.items():
            if site in reg:
                raise ValueError(f"{site} is registered by two fixture groups")
            reg[site] = spec
            cases[site] = m.CASES.get(site, [])
            muts[site] = getattr(m, "MUTATIONS", {}).get(site, [])
    return (reg, cases, muts) if with_mutations else (reg, cases)


def platforms():
    """[{site, module, cases: [[args, expected, why], ...]}] for every registered site."""
    reg, cases, muts = _registry(with_mutations=True)
    return [{"site": s, "module": reg[s][0], "cases": [list(c) for c in cases[s]],
             "mutations": [list(x) for x in muts[s]]} for s in sorted(reg)]


def mapped_without_helper(platform, builder_args):
    """The same mapping with site_posting_date() switched off in EVERY loaded scraper module — the
    site's own run.py and any shared engine it calls. A site whose date still reaches `date_added`
    is writing it some other way (unchecked shape, no Saudi-time conversion); a positive case must
    therefore come back None here."""
    reg, _ = _registry()
    _seed_catalog()
    importlib.import_module(reg[platform][0])
    off = lambda *_a, **_k: None   # noqa: E731
    saved = []
    for name, m in list(sys.modules.items()):
        if (name == "scrapers" or name.startswith("scrapers.")) and name != "scrapers.common.posting_date" \
                and getattr(m, "site_posting_date", None) is not None:
            saved.append((m, m.site_posting_date))
            m.site_posting_date = off
    try:
        return mapped(platform, builder_args)
    finally:
        for m, fn in saved:
            m.site_posting_date = fn


def mapped(platform, builder_args, mutated_source=None):
    """{"mapped": did the mapper return a row, "date_added": what it would store, "why": skip note}."""
    reg, _ = _registry()
    module, build, call = reg[platform]
    _seed_catalog()
    real = importlib.import_module(module)
    mod = real
    if mutated_source:
        mod = types.ModuleType("mutant")
        mod.__dict__.update({k: v for k, v in real.__dict__.items() if not k.startswith("__")})
        mod.__dict__["__file__"] = real.__file__
        mod.__dict__["__name__"] = "mutant"
        exec(compile(mutated_source, "mutant.py", "exec"), mod.__dict__)
    # A scraper's progress print must never reach stdout: the barrier reads stdout as the JSON answer.
    with contextlib.redirect_stdout(sys.stderr):
        row, why = call(mod, build(*builder_args))
    return {"mapped": bool(row), "date_added": (row or {}).get("date_added"), "why": why}


def no_date_report():
    """Sites whose printed «date» is NOT a posting date (group modules' NO_DATE): [{site, module, raw, got,
    raw_kept, mutations: [[label, file, applied, real, mutant]]}]. The barrier judges; nothing here does."""
    out = []
    for m in _groups():
        for site, (module, build, call, raw_path) in getattr(m, "NO_DATE", {}).items():
            def run(mutated=None, args=None):
                _seed_catalog()                  # the same stubbed location catalog the dated sites map against
                real = importlib.import_module(module)
                mod = real
                if mutated:
                    mod = types.ModuleType("mutant")
                    mod.__dict__.update({k: v for k, v in real.__dict__.items() if not k.startswith("__")})
                    mod.__dict__["__file__"] = real.__file__
                    mod.__dict__["__name__"] = "mutant"
                    exec(compile(mutated, "mutant.py", "exec"), mod.__dict__)
                with contextlib.redirect_stdout(sys.stderr):
                    row, why = call(mod, build(*(args or [])))
                return row, why
            rep = {"site": site, "module": module, "mutations": []}
            try:
                row, why = run()
                kept = row
                for k in raw_path:
                    kept = kept.get(k) if isinstance(kept, dict) else None
                printed = build()[0]
                want = printed
                for k in raw_path[1:]:
                    want = want.get(k) if isinstance(want, dict) else None
                rep.update(mapped=bool(row), date_added=(row or {}).get("date_added"), why=why,
                           raw_kept=(kept is not None and kept == want))
            except Exception as e:  # noqa: BLE001
                rep.update(error=f"{type(e).__name__}: {e}"[-400:])
            for label, rel, find, replace, args in getattr(m, "MUTATIONS", {}).get(site, []):
                with open(os.path.join(_ROOT, rel), encoding="utf-8") as fh:
                    src = fh.read()
                mutated = src.replace(find, replace)
                if mutated == src:
                    rep["mutations"].append([label, rel, False, None]); continue
                try:
                    row, _ = run(mutated, args)
                    rep["mutations"].append([label, rel, True, {"mapped": bool(row), "date_added": (row or {}).get("date_added")}])
                except Exception as e:  # noqa: BLE001
                    rep["mutations"].append([label, rel, True, {"error": f"{type(e).__name__}: {e}"[-300:]}])
            out.append(rep)
    return out


def _safe(fn, *a):
    try:
        return fn(*a)
    except Exception as e:  # noqa: BLE001 — one broken site must not hide the others' answers
        return {"error": f"{type(e).__name__}: {e}"[-400:]}


def run_all():
    """Every site's answers in ONE process: [{site, module, cases: [[args, want, why, got]], helper_off,
    mutations: [[label, file, applied, real, mutant]]}]. `got`/`real`/`mutant` are mapped() answers or
    {"error": ...}. The barrier judges them; nothing is judged here."""
    out = []
    for p in platforms():
        site = p["site"]
        rep = {"site": site, "module": p["module"], "cases": [], "helper_off": None, "mutations": []}
        for args, want, why in p["cases"]:
            rep["cases"].append([args, want, why, _safe(mapped, site, args)])
        pos = next((c for c in p["cases"] if isinstance(c[1], str)), None)
        if pos:
            rep["helper_off"] = _safe(mapped_without_helper, site, pos[0])
        for label, rel, find, replace, args in p["mutations"]:
            with open(os.path.join(_ROOT, rel), encoding="utf-8") as fh:
                real_src = fh.read()
            mutated = real_src.replace(find, replace)
            applied = mutated != real_src
            rep["mutations"].append([label, rel, applied, _safe(mapped, site, args),
                                     _safe(mapped, site, args, mutated) if applied else None])
        out.append(rep)
    return out
