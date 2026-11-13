"""⚡ 2026-11-12 — a failed Chromium install must never cost a site its crawl.

The 11-11 04:22 small-sources nightly lost 5 crawls (tawia, shomou, nowaisiry, therc, abralosol) in the
«Install Chromium for the maps.app.goo.gl pin hop» step: the runner's DNS failed during apt, the step
exited 100 and the job stopped before `begin_run`, so no scrape_runs row was written and therc paged
P0 silent_scraper_death. The browser only serves the pin hop, which already degrades to keeping the
stored pin. This test EXECUTES the step's shell with a `python` that always fails and proves the step
still exits 0 after retrying; on the old one-line step it exits non-zero.
"""
from __future__ import annotations

import os
import pathlib
import re
import stat
import subprocess
import tempfile

WF = pathlib.Path(__file__).resolve().parents[3] / ".github/workflows/small-sources-sync.yml"


def _install_step_script(text: str) -> str:
    i = text.index("- name: Install Chromium for the maps.app.goo.gl pin hop")
    block = text[i:text.index("\n      - name:", i + 10)]
    m = re.search(r"run: \|\n((?:          .*\n?|\s*\n)+)", block)
    if m:
        return "\n".join(l[10:] for l in m.group(1).splitlines())
    return re.search(r"run: (.+)", block).group(1)


def _run(script: str, python_ok: bool) -> tuple[int, int]:
    with tempfile.TemporaryDirectory() as d:
        calls = pathlib.Path(d, "calls")
        fake = pathlib.Path(d, "python")
        fake.write_text(f"#!/bin/sh\necho x >> {calls}\nexit {0 if python_ok else 100}\n")
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        sleep = pathlib.Path(d, "sleep")
        sleep.write_text("#!/bin/sh\nexit 0\n")
        sleep.chmod(sleep.stat().st_mode | stat.S_IEXEC)
        env = dict(os.environ, PATH=f"{d}:{os.environ['PATH']}")
        rc = subprocess.run(["bash", "-e", "-c", script], env=env, capture_output=True).returncode
        n = len(calls.read_text().splitlines()) if calls.exists() else 0
        return rc, n


def test_a_failing_install_retries_then_lets_the_crawl_run():
    rc, tries = _run(_install_step_script(WF.read_text()), python_ok=False)
    assert rc == 0, "a failed Chromium install must not fail the job (the crawl still runs)"
    assert tries == 3, f"expected 3 install tries, saw {tries}"


def test_a_working_install_runs_once():
    rc, tries = _run(_install_step_script(WF.read_text()), python_ok=True)
    assert (rc, tries) == (0, 1)


def test_the_old_one_line_step_is_caught():
    old = "python -m playwright install --with-deps chromium"
    rc, _ = _run(old, python_ok=False)
    assert rc != 0  # the shape this test exists to refuse
