"""The three-valued liveness law for HTML-page platforms, in ONE place.

WHY THIS EXISTS
---------------
`docs/ops/LISTING_LIVENESS.md` §1–§3: liveness is ALIVE / DEAD / **UNKNOWN**, absence from our crawl
is `EvidenceKind.ABSENCE` and never a verdict, and only a DIRECT fetch of the listing's own URL may
kill. `db.prune_unseen(verify_gone=...)` is where a scraper honours that — but each platform that
gained an oracle wrote its own copy of the law alongside its own source semantics, and the two are
not the same kind of thing:

* the **law** is universal and must never vary — a 403 is not a death on any platform, ever;
* the **signal** is per-platform and must be MEASURED — aqargate flips a WordPress status, raghdan
  404s, sanadak soft-404s with a 200 shell, souq24 redirects off the listing path.

Four copies of the law is four chances to get it subtly wrong, and a weakened copy looks exactly
like a correct one until it deletes something. So the law lives here, is barriered once
(`scripts/verify-http-liveness-law.ts`), and CANNOT be relaxed by a caller: a platform supplies only
its affirmative signals, and `decide()` overrides anything that contradicts the law.

HOW A PLATFORM USES IT
----------------------
Supply a `signal(status, body, path_changed) -> 'live' | 'gone' | None` that states ONLY what this
source affirmatively does, measured against real rows with interleaved known-alive controls. Return
`None` for "no opinion" — never for "probably gone".

    from scrapers.common.http_liveness import LivenessProbe

    def _signal(status, body, path_changed):
        if status in (404, 410):
            return "gone"                      # measured: 29/31 already-dead rows, 0/40 controls
        if status == 200 and '"@type":"RealEstateListing"' in body:
            return "live"
        return None

    _probe = LivenessProbe(platform="jazwtn", signal=_signal, session=_oracle_session)
    ...
    db.prune_unseen(tbl, seen, source="Jazwtn", verify_gone=_probe.verify_gone)

WHAT THE LAW OVERRIDES, ALWAYS
------------------------------
`decide()` refuses a `'gone'` and downgrades it to UNKNOWN whenever the read cannot bear a death:

* no answer at all (timeout, connection reset, DNS) — we never reached the source;
* 401/402/403/407/408/429 — we were blocked or throttled; that is about US;
* any 5xx — the source is broken, not the listing;
* an empty body — we fetched something, we did not read an answer.

A `'live'` is refused on an empty body too, so a shell cannot manufacture a verification. Nothing a
caller can pass re-enables any of these. The one asymmetry is deliberate and comes straight from
`DELETION_SAFETY.md` §2.4 / `LISTING_LIVENESS.md` §5.4: a block cannot fabricate a live page, so an
ALIVE reading survives a degraded run where a DEAD reading must not.

THE 3xx CASE. An unresolved redirect is UNKNOWN by default — we do not know where we landed. But on
some sources the redirect IS the removal signal (souq24 sends a delisted ad to a generic page), so a
platform may return `'gone'` from its own signal on `path_changed`. That is a statement about that
source, made from measurement; it does not change the law for anyone else.
"""
from __future__ import annotations

import time
from typing import Any, Callable, Optional

# Statuses that say something about US, never about the listing (LISTING_LIVENESS.md §1).
BLOCKED_OR_THROTTLED = frozenset({401, 402, 403, 407, 408, 429})

Verdict = tuple[str, str]
Signal = Callable[[Optional[int], str, bool], Optional[str]]


def read_is_unbelievable(status: Optional[int], body: str) -> Optional[str]:
    """Why this response cannot carry a DEATH verdict — or None if it can.

    Pure and total. This is the half of the law that no platform may override, and it is the
    predicate `scripts/verify-http-liveness-law.ts` executes against every shape the contract names.
    """
    if status is None:
        return "no answer from the source (timeout / connection error)"
    if status in BLOCKED_OR_THROTTLED:
        return f"HTTP {status} is about our access, not about the listing"
    if 500 <= status <= 599:
        return f"HTTP {status} — the source is broken, not the listing"
    if not body:
        return f"HTTP {status} with an empty body — we fetched something, we did not read an answer"
    return None


def decide(status: Optional[int], body: str, path_changed: bool,
           signal: Signal) -> Optional[Verdict]:
    """Apply a platform's measured signal UNDER the law. `None` means "no answer yet — retry".

    Never raises on a bad signal: an exception from the platform's own predicate is UNKNOWN, because
    a parser that blew up has told us nothing about the listing.

    AN UNBELIEVABLE READ IS A RETRY, NOT A VERDICT. The first version of this function returned
    `('unknown', …)` immediately whenever `read_is_unbelievable()` fired. That is safe but wrong,
    and `scripts/verify-http-liveness-law.ts` caught it before any platform depended on it: one
    dropped connection ended the probe without ever using its second attempt. The outcome was
    correct (never a death) and the *behaviour* was poor — every transient blip became a permanent
    UNKNOWN for that row, so fewer real removals were ever confirmed and dead inventory lingered
    longer. Retrying costs one more request; not retrying costs the oracle its coverage.

    So: an unbelievable read yields None here, the caller spends its budget, and only an exhausted
    budget becomes UNKNOWN — with the reason `read_is_unbelievable()` gave, so the evidence row
    still says WHY (`ops_stale_inactivation_probe.note`; the lesson of ops_incident #84, where
    recording only the verdict made a kill unfalsifiable from the record).
    """
    try:
        said = signal(status, body or "", path_changed)
    except Exception as e:  # noqa: BLE001 — a broken parser is not evidence of death
        return "unknown", f"the platform signal raised {type(e).__name__}: {e}"

    if said not in (None, "live", "gone"):
        # A signal that invents a fourth value is not trusted with any of the three.
        return "unknown", f"the platform signal returned {said!r}, which is not a verdict"

    if said == "live":
        # A restorative reading is NOT gated by a degraded run — a block cannot manufacture a live
        # page (LISTING_LIVENESS.md §5.4, DELETION_SAFETY.md §2.4). But a page we could not read is
        # not a live page either, so that one case retries rather than certifying anything.
        if status is None or not body:
            return None
        return "live", f"source still serves this listing (HTTP {status})"

    unbelievable = read_is_unbelievable(status, body or "")
    if unbelievable:
        # Covers BOTH a 'gone' claim on an unreadable response and a platform with no opinion:
        # neither can be resolved from this read, and both deserve the remaining attempts.
        return None

    if said == "gone":
        return "gone", f"source confirms removal (HTTP {status})"

    return None  # believable read, platform has no opinion — retry, then UNKNOWN


class LivenessProbe:
    """A `verify_gone` callable for `db.prune_unseen`, built from a platform's measured signal.

    `url_for` turns an ad_number into THAT listing's own URL. Returning None means the row cannot be
    probed directly, which is UNKNOWN — never a kill on an unprobed row.
    """

    def __init__(self, platform: str, signal: Signal,
                 session: Callable[[], Any],
                 url_for: Callable[[str], Optional[str]],
                 attempts: int = 2, backoff: float = 1.2, timeout: int = 45,
                 canary: Optional[Callable[[], tuple[bool, str]]] = None) -> None:
        self.platform = platform
        self.signal = signal
        self.session = session
        self.url_for = url_for
        self.attempts = attempts
        self.backoff = backoff
        self.timeout = timeout
        # OPTIONAL in-run positive control (LISTING_LIVENESS.md §5.4). Returns (ok, why).
        #
        # A per-row oracle cannot see what a RUN looks like, and some sources degrade in a way that
        # mimics death rather than failure — gathern answered blocking with its own 404 at a
        # measured 100% false-death rate; dealapp serves listing-less shells to datacenter egress.
        # An aggregate alive-rate is a lagging signal: gathern inactivated 302 rows on one day and
        # 106 the next before its collapse was visible. A canary asks the sharper question BEFORE
        # each removal — is this source still serving real listings to us, right now?
        #
        # It gates ONLY removals. An ALIVE reading is never gated, because a degraded environment
        # cannot manufacture a live page (DELETION_SAFETY.md §2.4).
        self.canary = canary

    def fetch(self, url: str) -> tuple[Optional[int], str, bool]:
        """One DIRECT read of the listing's own URL. Seam: tests replace this, never the law."""
        try:
            r = self.session().get(url, timeout=self.timeout, allow_redirects=True)
            landed = str(getattr(r, "url", url) or url)
            return r.status_code, (r.text or ""), _path_of(landed) != _path_of(url)
        except Exception:  # noqa: BLE001 — an unreachable source is never proof of death
            return None, "", False

    def verify_gone(self, ad_number: str) -> Verdict:
        url = self.url_for(ad_number)
        if not url:
            return "unknown", f"{ad_number!r} does not resolve to a {self.platform} listing URL"
        last = "no attempt made"
        for attempt in range(self.attempts):
            status, body, path_changed = self.fetch(url)
            # Keep the LAW's own words for the record, so an UNKNOWN says why it is unknown rather
            # than only that it is (ops_incident #84: a verdict with no reason is unfalsifiable).
            last = read_is_unbelievable(status, body) or (
                f"HTTP {status}, but this platform's signal had no opinion about it")
            decided = decide(status, body, path_changed, self.signal)
            if decided is not None:
                if decided[0] == "gone" and self.canary is not None:
                    ok, why = self.canary()
                    if not ok:
                        # A source that has stopped serving us real listings cannot testify that
                        # any particular one is gone. Fails CLOSED: no canary answer, no removal.
                        return "unknown", f"removal withheld — {why} (would have been: {decided[1]})"
                return decided
            time.sleep(self.backoff * (attempt + 1))
        return "unknown", f"no verdict after {self.attempts} attempts — {last}"


def _path_of(u: str) -> str:
    from urllib.parse import urlparse
    p = urlparse(u)
    return (p.path or "/").rstrip("/") or "/"


def stored_listing_url(tables: tuple[str, ...]) -> Callable[[str], Optional[str]]:
    """`url_for` that reads the row's OWN stored `listing_url` back from the database.

    Most platforms cannot reconstruct a listing URL from an ad_number — the slug carries Arabic
    text (mizlaj, sanadak), or the ad_number is a hash of the link (nowaisiry), or the URL came
    from a sitemap (jazwtn). Guessing one would probe a page that is not this listing, which is the
    defect measured on sanadak: 39 of 1,724 rows store another listing's URL and three of them
    answered 'live', which a URL-trusting oracle would have turned into false resurrections.

    A lookup that FAILS returns None, and None is UNKNOWN at the call site — never a kill on a row
    we could not address. That is deliberate: a database blip must not read as a dead listing.
    """
    def url_for(ad_number: str) -> Optional[str]:
        from scrapers.common import db
        for tbl in tables:
            try:
                r = (db.sb().table(tbl).select("listing_url")
                     .eq("ad_number", ad_number).limit(1).execute())
            except Exception:  # noqa: BLE001 — a failed lookup is UNKNOWN, never a kill
                return None
            if r.data:
                return r.data[0].get("listing_url") or None
        return None
    return url_for
