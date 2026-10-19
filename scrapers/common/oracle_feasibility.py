"""CAN THIS PLATFORM'S LISTING PAGE TELL A DEAD AD FROM A LIVE ONE? — measured, never assumed.

WHY THIS EXISTS (owner, 2026-09-21, items 3 and 5)
--------------------------------------------------
    "Validate the reachable platforms from the actual GitHub Actions environment and wire proper
     liveness/stale-listing coverage for them. Test each platform independently before allowing
     automated deactivation."
    "For the genuinely difficult platforms, do not pretend they are covered. Identify exactly what
     information is missing... Report back before implementing anything risky."

23 production-searchable platforms prune on crawl absence alone with no source oracle
(`scrapers/absence-only-prune.txt`). Thirteen of those 23 are marked "EGRESS BLOCKED" — and
`docs/ops/LISTING_LIVENESS.md` §9.4 is explicit that such a note is **a fact about the container
that wrote it, not about the platform**. Measured the same day that rule was written: probing
gathern from a cloud-routine egress returned 404 on 10 of 12 listings the crawl had served alive two
hours earlier — an 83% false-death rate — while CI egress got clean 200s on 10/10 canaries.

So the only honest place to ask this question is the egress the jobs really use: a GitHub Actions
runner. That is what this module is for.

WHAT IT MEASURES, AND WHY IT IS SHAPED THIS WAY
-----------------------------------------------
Two cohorts per platform, fetched interleaved so a mid-run change at the source hits both alike:

    LIVE     rows that are active and were seen by the crawl recently — our best "should be alive"
    DEAD     rows already inactive with strikes — our best "should be gone"

An oracle is possible only if some OBSERVABLE separates them. The failures this repo has already
paid for say exactly which observables to record and which conclusions to refuse:

* **aqaratikom** — dead and live returned a byte-identical 5,795-byte SPA shell with one shared
  title (12 + 12 probed). Status code and title were useless; only `bytes` and a body marker could
  ever have told them apart, and neither did. So body SIZE and title are recorded, not just status.
* **satel** — 12/12 dead and 12/12 live both answered 200 with *distinct* per-listing titles, and
  none of 18 candidate sold/rented markers appeared on either cohort. Distinct titles are therefore
  not evidence of anything; "the page renders" is not "the ad is live".
* **ramzalqasim** — the LIVE controls shared a single title across all 12, so the title
  discriminated nothing and the 200s could not be read in either direction.
* **fursaghyr** — «غير متاح» turned out to be a REGISTRATION-FORM string and «مؤجر» appeared in the
  advertising prose of LIVE listings. A marker that appears on live pages is furniture, so every
  candidate marker is counted on BOTH cohorts and a marker present on any live row is disqualified.
* **abeea** — a "200 means alive" rule wrongly restored 9 rows. A 200 we cannot recognise is
  UNKNOWN, never a verification.

THIS MODULE DECIDES NOTHING AND WRITES NOTHING. It returns a measurement. Whether a platform gets
an oracle, and what its signal is, is a judgement made by a human reading these numbers — because
every one of the five failures above would have passed a naive automated reading of them.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Optional

from scrapers.common.http_liveness import read_is_unbelievable

# THIS MODULE STAYS IMPORT-LIGHT, and that is load-bearing rather than tidy. Everything here is pure:
# no HTTP client, no database client, nothing needing a network. `oracle_feasibility_run` is the
# shell that adds `requests` and the Supabase reads on top. Keeping the split means the judgement can
# be exercised by a test that installs nothing — and the first CI run of this change proved the point
# the hard way: the ledger reader lived in the RUNNER, so importing it to test it dragged `requests`
# in, and the hermetic test failed with ModuleNotFoundError on a job that had no reason to need an
# HTTP library. Same lesson `src/data/loaderPlatforms.ts` records on the TypeScript side.
_LEDGER = Path(__file__).resolve().parents[1] / "absence-only-prune.txt"


def absence_only_platforms() -> list[str]:
    """The worklist: every platform still pruning on crawl absence alone.

    DISCOVERED from the committed ledger rather than hardcoded, so a platform that joins the gap
    tomorrow is probed without anyone remembering to extend a list.
    """
    out: list[str] = []
    for line in _LEDGER.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line.split("|")[0].strip())
    return out

# Candidate Arabic/English removal markers seen across Saudi listing platforms. Presence on a LIVE
# row disqualifies a marker outright — that is the fursaghyr lesson, and it is why both cohorts are
# counted rather than only the dead one.
CANDIDATE_MARKERS: tuple[str, ...] = (
    "تم البيع", "تم الإيجار", "تم التأجير", "تم التاجير", "مباع", "مؤجر",
    "الإعلان منتهي", "إعلان منتهي", "غير متاح", "غير متوفر", "لم يتم العثور",
    "هذه الصفحة غير متوفرة", "الصفحة غير موجودة", "تم حذف", "منتهي الصلاحية",
    "Property Not Found", "Not Found", "no longer available", "SoldOut", "OutOfStock",
)

_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)


@dataclass
class Read:
    """One fetch of one listing URL. `status is None` means we never reached the source at all."""
    ad_number: str
    url: str
    cohort: str                   # 'live' | 'dead'
    status: Optional[int]
    bytes_: int
    title: str
    path_changed: bool
    markers: tuple[str, ...] = ()
    error: str = ""


@dataclass
class PlatformVerdict:
    platform: str
    live_n: int = 0
    dead_n: int = 0
    unreachable_live: int = 0
    unreachable_dead: int = 0
    live_statuses: dict[int, int] = field(default_factory=dict)
    dead_statuses: dict[int, int] = field(default_factory=dict)
    distinct_live_titles: int = 0
    distinct_live_bytes: int = 0
    usable_markers: tuple[str, ...] = ()
    disqualified_markers: tuple[str, ...] = ()
    verdict: str = "UNMEASURED"
    why: str = ""


def unreadable_reason(r: Read) -> Optional[str]:
    """Why this read cannot be used as a control — asked of the SHARED LAW, never re-derived.

    `http_liveness.read_is_unbelievable()` is the half of the liveness law no platform may override:
    no answer, 401/402/403/407/408/429, any 5xx, or an empty body. A read that cannot bear a DEATH
    verdict cannot bear a "this platform has no signal" verdict either — the second claim is no
    weaker than the first, and pretending otherwise is the exact defect this whole module exists to
    prevent.

    MEASURED, in this probe's OWN first run (2026-09-21): sadin answered HTTP 502 on all ten live
    and all ten dead rows — its site has been down since 09-07 — and the judgement returned
    NO_SIGNAL_ON_THIS_PAGE, describing a 502 error page as "one shared shell for every id, the
    aqaratikom shape". That is a failed read rendered as a platform limitation, by the instrument
    built to catch failed reads rendered as platform limitations. The bug was that `reached` meant
    only `status is not None`.

    The body is not retained (only its length), so emptiness is reconstructed from `bytes_` — which
    is the only property of the body the law actually tests.
    """
    return read_is_unbelievable(r.status, "x" if r.bytes_ else "")


def _count(reads: Iterable[Read]) -> dict[int, int]:
    out: dict[int, int] = {}
    for r in reads:
        key = r.status if r.status is not None else 0
        out[key] = out.get(key, 0) + 1
    return out


def title_of(body: str) -> str:
    m = _TITLE.search(body or "")
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""


def markers_in(body: str) -> tuple[str, ...]:
    b = body or ""
    return tuple(m for m in CANDIDATE_MARKERS if m in b)


def judge(platform: str, reads: list[Read]) -> PlatformVerdict:
    """Turn a set of interleaved reads into a verdict. Pure, so it can be tested without a network.

    The verdict vocabulary is deliberately three-valued in the same spirit as liveness itself:
    an oracle is POSSIBLE, IMPOSSIBLE-on-this-page, or the read itself was UNUSABLE. "Unusable" is
    never quietly folded into "impossible" — that conflation is what turned an egress block into a
    claim about a platform thirteen times over in `scrapers/absence-only-prune.txt`.
    """
    v = PlatformVerdict(platform=platform)
    live = [r for r in reads if r.cohort == "live"]
    dead = [r for r in reads if r.cohort == "dead"]
    v.live_n, v.dead_n = len(live), len(dead)
    v.unreachable_live = sum(1 for r in live if r.status is None)
    v.unreachable_dead = sum(1 for r in dead if r.status is None)
    v.live_statuses, v.dead_statuses = _count(live), _count(dead)
    # READABLE, not merely "answered". A 502 is an answer and proves nothing — see
    # unreadable_reason(). Judged by the shared law so this can never drift from what the real
    # liveness path believes.
    reached_live = [r for r in live if unreadable_reason(r) is None]
    v.distinct_live_titles = len({r.title for r in reached_live if r.title})
    v.distinct_live_bytes = len({r.bytes_ for r in reached_live})

    # 1. THE READ ITSELF. Without a live cohort we are reading the network, not the platform.
    #    This is the branch §9.4 exists for: no positive control, no conclusion, in EITHER direction.
    if not reached_live:
        reasons = sorted({str(unreadable_reason(r)) for r in live}) or ["no live rows were supplied"]
        v.verdict = "UNUSABLE_READ"
        v.why = (f"not one of {v.live_n} known-live listing(s) produced a READABLE answer from this "
                 f"egress ({'; '.join(reasons)}). That is a fact about our network or about the "
                 "source being down — never about whether its page can discriminate. Re-measure "
                 "from the egress the job really uses (LISTING_LIVENESS.md §9.4).")
        return v

    # 2. THE gathern SIGNATURE. Live rows answering 404 means the source is refusing US, and a
    #    404-means-gone oracle here would be WORSE than none: it manufactures deaths on command.
    live_404 = sum(1 for r in reached_live if r.status in (404, 410))
    if live_404 * 2 > len(reached_live):
        v.verdict = "UNUSABLE_READ"
        v.why = (f"{live_404} of {len(reached_live)} KNOWN-LIVE listings answered 404/410. The "
                 "source is expressing a block as a not-found, so absence of the page proves "
                 "nothing. This is the gathern signature (83% false-death rate measured "
                 "2026-09-21 from a cloud egress).")
        return v

    if not dead:
        v.verdict = "NO_DEAD_COHORT"
        v.why = ("this platform has no inactive rows, so the removal limb cannot be validated "
                 "against anything. A live-only measurement can confirm reachability and a "
                 "proof-of-life marker; it cannot license a kill.")
        return v

    # 3. MARKERS. A marker on any live row is furniture, not a signal (the fursaghyr lesson).
    live_markers = {m for r in reached_live for m in r.markers}
    reached_dead = [r for r in dead if unreadable_reason(r) is None]
    dead_markers = {m for r in reached_dead for m in r.markers}
    v.usable_markers = tuple(sorted(dead_markers - live_markers))
    v.disqualified_markers = tuple(sorted(dead_markers & live_markers))

    # 4. STATUS SEPARATION: dead 404/410 while live is 200.
    dead_404 = sum(1 for r in reached_dead if r.status in (404, 410))
    live_200 = sum(1 for r in reached_live if r.status == 200)
    status_separates = reached_dead and dead_404 == len(reached_dead) and live_200 == len(reached_live)

    if status_separates:
        v.verdict = "ORACLE_POSSIBLE"
        v.why = (f"clean status separation: {dead_404}/{len(reached_dead)} dead answered 404/410 and "
                 f"{live_200}/{len(reached_live)} live answered 200. Wire 404/410 as the death limb "
                 "and keep every other shape UNKNOWN.")
        return v
    if v.usable_markers:
        v.verdict = "ORACLE_POSSIBLE"
        v.why = ("no status separation, but a body marker appears on dead pages and on NO live page: "
                 f"{list(v.usable_markers)}. Validate it against a larger cohort before wiring, and "
                 "gate removals on an in-run canary.")
        return v

    # 5. NOTHING SEPARATES THEM. Say what is missing rather than inventing a rule.
    identical_shell = v.distinct_live_bytes <= 1 and v.distinct_live_titles <= 1
    v.verdict = "NO_SIGNAL_ON_THIS_PAGE"
    v.why = (
        "dead and live are indistinguishable on the listing page: "
        f"live statuses {v.live_statuses}, dead statuses {v.dead_statuses}, "
        f"{v.distinct_live_titles} distinct live title(s), {v.distinct_live_bytes} distinct live "
        f"body size(s), 0 usable markers"
        + (f", {list(v.disqualified_markers)} disqualified for appearing on LIVE pages" if v.disqualified_markers else "")
        + ". "
        + ("The page is one shared shell for every id — the aqaratikom shape; an oracle must come "
           "from an API or a status field, not this page. " if identical_shell else "")
        + "Do NOT invent a page-text heuristic to close this (the fursaghyr mistake). What is "
          "missing is a source-published status: an API record, a sitemap/feed membership test, or "
          "a status endpoint."
    )
    return v


def probe_platform(
    platform: str,
    live_rows: list[dict],
    dead_rows: list[dict],
    fetch: Callable[[str], tuple[Optional[int], str, bool]],
) -> tuple[PlatformVerdict, list[Read]]:
    """Fetch both cohorts INTERLEAVED and judge them.

    Interleaving is not tidiness: a source that degrades halfway through a run would otherwise hit
    one cohort and not the other, and the difference would read as a signal. `fetch` is injected so
    the whole thing can be exercised against a stub.
    """
    reads: list[Read] = []
    pairs: list[tuple[str, dict]] = []
    for i in range(max(len(live_rows), len(dead_rows))):
        if i < len(live_rows):
            pairs.append(("live", live_rows[i]))
        if i < len(dead_rows):
            pairs.append(("dead", dead_rows[i]))

    for cohort, row in pairs:
        url = (row.get("listing_url") or "").strip()
        ad = str(row.get("ad_number") or "")
        if not url:
            reads.append(Read(ad, "", cohort, None, 0, "", False, error="no stored listing_url"))
            continue
        try:
            status, body, moved = fetch(url)
        except Exception as e:                       # a probe that throws is UNREACHABLE, never dead
            reads.append(Read(ad, url, cohort, None, 0, "", False, error=f"{type(e).__name__}: {e}"))
            continue
        reads.append(Read(ad, url, cohort, status, len(body or ""), title_of(body),
                          moved, markers_in(body)))
    return judge(platform, reads), reads
