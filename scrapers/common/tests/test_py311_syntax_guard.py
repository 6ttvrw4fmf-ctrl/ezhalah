"""Every .py under scrapers/ and scripts/ must parse on Python 3.11 (scripts/check_py311_syntax.py).

The ♻️ Lifecycle Engineer's container runs 3.11; CI runs 3.13. On 2026-10-02 a test file with a
backslash inside an f-string field could not be imported there and was skipped (#5608 → #5640).
On 3.13 this test drives the tokenize/ast detector; on 3.11 the same function uses compile(), so
the engineer's own run names the offending file instead of a collection error.

The fixtures below are plain strings on purpose: this file itself must import on 3.11.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location("check_py311_syntax", ROOT / "scripts/check_py311_syntax.py")
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

# 3.12-only: each must be flagged (and each is a SyntaxError on 3.11).
REJECTED = {
    "backslash in field":          r'''x = f"{'\n'.join(a)}"''',
    "backslash in nested f-string": r'''x = f"{f'\n'}"''',
    "backslash in spec's field":   r'''x = f"{x:{'\n'}}"''',
    "same quote reused":           '''x = f"{d["k"]}"''',
    "nested f-string same quote":  '''x = f"{f"{a}"}"''',
    "triple reused in triple":     "x = f'''{'''a'''}'''",
    "comment in field":            'x = f"{a # c\n}"',
    "newline in single-quoted":    'x = f"{a +\n b}"',
    "type statement":              "type X = int",
    "generic def":                 "def f[T](a: T) -> T: return a",
    "generic class":               "class C[T]: pass",
    # The exact shape of the #5608 file the engineer could not import.
    "#5608 shape":                 '''x = f"{'<b class=\\"x\\">y</b>' if call else ''}"''',
}

# Legal on 3.11: none may be flagged. The first two are the real repo files named in the task.
ACCEPTED = {
    "one quote inside triple":     "x = f'''{''.join(a)} {f'<{u}>'}'''",
    "other quote inside":          '''x = f"{d['k']}"''',
    "dict literal in field":       'x = f"{ {1: 2}[1] }"',
    "format spec alternate form":  'x = f"{n:#x} {w:>{pad}}"',
    "hash inside a string":        '''x = f"{'#'}"''',
    "escaped braces":              'x = f"{{lit}} {a}"',
    "newline in triple-quoted":    'x = f"""{a +\n b}"""',
    "backslash in literal part":   r'x = f"a\n{b}\t"',
    "continuation in literal":     'x = f"ab\\\ncd{e}"',
    "walrus, slice, nested spec":  'x = f"{(n := 3)} {a[1:2]} {b!r:>{w}.{p}f}"',
    "lambda in parens":            'x = f"{(lambda q: q)(1)}"',
    "backslash in spec text":      r'x = f"{n:\x3e10}"',
}
REAL_ACCEPTED = [
    "scrapers/common/tests/test_ashab_limit_units_and_skips.py",
    "scrapers/common/tests/test_albdah_taxonomy_period_and_debug500_oracle.py",
]


def test_detector_rejects_every_3_12_only_shape():
    missed = {k for k, src in REJECTED.items() if not guard.offenders(src, k)}
    assert not missed, f"3.12-only syntax passed the guard: {sorted(missed)}"


def test_detector_accepts_every_3_11_legal_shape():
    wrong = {k: guard.offenders(src, k) for k, src in ACCEPTED.items()}
    wrong = {k: v for k, v in wrong.items() if v}
    assert not wrong, f"legal 3.11 syntax was flagged: {wrong}"
    for rel in REAL_ACCEPTED:
        assert guard.offenders((ROOT / rel).read_text(encoding="utf-8"), rel) == []


def test_every_py_under_scrapers_and_scripts_parses_on_3_11():
    files = guard.repo_files(ROOT)
    assert len(files) > 500, f"the scan found only {len(files)} files — the glob is broken"
    bad = guard.scan(files, ROOT)
    assert not bad, "3.12-only syntax (the Lifecycle Engineer runs 3.11):\n" + "\n".join(bad)
