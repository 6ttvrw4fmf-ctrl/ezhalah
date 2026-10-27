"""Plan the small-sources-sync matrix: blank input = every source, `source=a,b` = ONLY a and b.

Why (2026-10-25): the matrix used to be a literal list, so a dispatch with `source=<one site>` still
created all ~143 jobs; every other site's job only skipped its scrape step after a runner had done
checkout + Python + pip. Five such runs held 41–143 queued jobs each for 3+ hours and nothing in the
workflow started from 08:25 to 13:00 UTC. Now the `plan` job runs this and the `sync` job's matrix is
`fromJSON(needs.plan.outputs.matrix)`.

Input: SMALL_SOURCES (env) — the `- { source: …, cmd: "…", … }` lines kept in the workflow's plan
step (one line per platform, the format every guard already parses). argv[1] = the dispatch input.
Output: `matrix={"include":[…]}` on stdout, for $GITHUB_OUTPUT.
Guard: scripts/verify-small-sources-targeted-dispatch-is-one-job.ts.
"""
import json
import os
import re
import sys

# A trailing «# comment» after the closing brace is part of the line's shape (2026-10-27): #8877 wrote
# `- { source: sakani, … }  # sale side …` and the old `\}\s*$` anchor dropped sakani from every nightly
# matrix without a word (142 of 143 planned). Lazy body, so a «}» inside the comment cannot widen it.
_ENTRY = re.compile(r"^\s*-\s*\{(.+?)\}\s*(?:#.*)?$")
_FIELD = re.compile(r"""([A-Za-z_][\w-]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,}]*))""")


def _scalar(raw: str):
    v = raw.strip()
    if v in ("true", "false"):
        return v == "true"
    return int(v) if re.fullmatch(r"-?\d+", v) else v


def entries(text: str) -> list[dict]:
    """Every active `- { source: … }` line, as GitHub's YAML would read it (ints, booleans, strings)."""
    out = []
    for line in text.splitlines():
        m = _ENTRY.match(line)
        if not m or line.lstrip().startswith("#"):
            continue
        e = {k: (dq if dq is not None else sq if sq is not None else _scalar(bare))
             for k, dq, sq, bare in ((f[1], f[2], f[3], f[4]) for f in _FIELD.finditer(m[1]))}
        if "source" in e:
            out.append(e)
    return out


def plan(text: str, source_input: str) -> dict:
    allowed = entries(text)
    wanted = [s.strip() for s in source_input.split(",") if s.strip()]
    if not wanted:
        return {"include": allowed}
    known = {e["source"] for e in allowed}
    unknown = [s for s in wanted if s not in known]
    if unknown:
        raise SystemExit(f"::error::unknown small source(s): {', '.join(unknown)} — not in the workflow's SMALL_SOURCES list")
    return {"include": [e for e in allowed if e["source"] in wanted]}


if __name__ == "__main__":
    text = os.environ.get("SMALL_SOURCES", "")
    if not entries(text):
        raise SystemExit("::error::SMALL_SOURCES is empty — refusing to plan a matrix with no sources")
    m = plan(text, sys.argv[1] if len(sys.argv) > 1 else "")
    print(f"matrix={json.dumps(m, ensure_ascii=False, separators=(',', ':'))}")
    print(f"planned {len(m['include'])} job(s): {', '.join(e['source'] for e in m['include'])}", file=sys.stderr)
