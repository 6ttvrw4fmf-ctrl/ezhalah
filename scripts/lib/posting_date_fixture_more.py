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
import importlib
import types

from scripts.lib.posting_date_fixture import _seed_catalog

GROUP_MODULES = [
    "scripts.lib.posting_date_fixture_g0",
    "scripts.lib.posting_date_fixture_g1",
    "scripts.lib.posting_date_fixture_g2",
    "scripts.lib.posting_date_fixture_g3",
    "scripts.lib.posting_date_fixture_g4",
    "scripts.lib.posting_date_fixture_g5",
    "scripts.lib.posting_date_fixture_g6",
]


def _groups():
    out = []
    for name in GROUP_MODULES:
        try:
            out.append(importlib.import_module(name))
        except ModuleNotFoundError as e:
            if e.name != name:          # the group exists but something IT imports is missing: loud
                raise
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
    import sys
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
    row, why = call(mod, build(*builder_args))
    return {"mapped": bool(row), "date_added": (row or {}).get("date_added"), "why": why}
