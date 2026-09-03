"""Dealapp liveness classifier — the platform where a naive rule would have been catastrophic.

MEASURED ON PRODUCTION 2026-08-30, and the reason every test below exists: dealapp returns HTTP 200
with an identical ~131KB Angular shell for a REAL listing id AND a BOGUS one. `ng-state` is
hydrated in both; the listing schema is in neither. So:

  · `200 ⇒ alive` would have manufactured verification for 14,568 rows nobody checked.
  · `200-without-schema ⇒ dead` would have mass-killed live inventory the moment the runner's
    egress changed — and run.py's own diagnostic taxonomy calls that shape "the cleanest
    'genuinely gone' signal", so the tempting reading is written down in the repo already.

Both directions are wrong, and the classifier must refuse both.
"""
from __future__ import annotations

import pytest

from scrapers.common.liveness_contract import (
    ALIVE, DEAD, UNKNOWN, EvidenceKind, LivenessPolicy, decide, verification_patch,
)
from scrapers.dealapp.liveness import (
    classify_dealapp, environment_is_trustworthy, listing_schema_present, sitemap_candidate_rank,
    sold_or_rented,
)

POLICY = LivenessPolicy(platform="dealapp", grace=3, max_verification_age_hours=96)
REQ = "https://dealapp.sa/ar/ad-details/501525"
SCHEMA = '<script>{"@id":"real-estate-listing-schema-501525","name":"شقة"}</script>'
SHELL = '<html><script id="ng-state" type="application/json">{"x":1}</script></html>'


# ── The shell must never read as either verdict ─────────────────────────────────────────────────
def test_the_spa_shell_is_unknown_not_alive():
    """A real id whose page came back as a shell is unreadable, not verified."""
    v = classify_dealapp(200, body=SHELL, adid="501525", final_url=REQ, requested_url=REQ)
    assert v == UNKNOWN
    assert verification_patch(decide(v, strikes=0, policy=POLICY), now_iso="T") == {}


def test_the_spa_shell_is_unknown_not_dead():
    """The dangerous direction: run.py's diagnostics call hydrated-but-schema-less 'genuinely
    gone'. As a deactivation rule that would mass-kill live rows from a shelled environment."""
    v = classify_dealapp(200, body=SHELL, adid="501525", final_url=REQ, requested_url=REQ)
    assert v == UNKNOWN
    assert decide(v, strikes=2, policy=POLICY).action == "none", "must not even take a strike"


def test_a_bogus_id_and_a_real_id_are_indistinguishable_and_both_unknown():
    """Exactly the production measurement: neither may produce a verdict."""
    real = classify_dealapp(200, body=SHELL, adid="501525", final_url=REQ, requested_url=REQ)
    bogus = classify_dealapp(200, body=SHELL, adid="999999999",
                             final_url="https://dealapp.sa/ar/ad-details/999999999",
                             requested_url="https://dealapp.sa/ar/ad-details/999999999")
    assert real == bogus == UNKNOWN


# ── Positive verification requires THIS ad's schema ─────────────────────────────────────────────
def test_this_ads_schema_is_alive():
    v = classify_dealapp(200, body=SCHEMA, adid="501525", final_url=REQ, requested_url=REQ)
    assert v == ALIVE
    assert verification_patch(decide(v, strikes=1, policy=POLICY), now_iso="T") == {
        "last_verified_alive_at": "T"}


def test_another_ads_schema_does_not_verify_this_one():
    """A recommendations rail or template fragment naming a different listing is not proof about
    the listing we asked for."""
    other = '<script>{"@id":"real-estate-listing-schema-777777"}</script>'
    assert classify_dealapp(200, body=other, adid="501525", final_url=REQ, requested_url=REQ) == UNKNOWN
    assert listing_schema_present(other, "501525") is False


def test_schema_id_match_is_exact_not_prefix():
    """`...-5015251` must not satisfy a probe for 501525."""
    assert listing_schema_present('real-estate-listing-schema-5015251', "501525") is False
    assert listing_schema_present('real-estate-listing-schema-501525 ', "501525") is True


# ── Real deaths ─────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("status", [404, 410])
def test_hard_gone_is_dead(status):
    assert classify_dealapp(status, adid="501525", requested_url=REQ) == DEAD


def test_redirected_off_the_ad_path_is_dead():
    """dealapp itself moved us away from /ad-details/{id} — its own statement the id is gone."""
    v = classify_dealapp(200, body="<html>home</html>", adid="501525",
                         final_url="https://dealapp.sa/ar/home", requested_url=REQ)
    assert v == DEAD


def test_sold_or_rented_on_a_rendered_ad_is_dead():
    for marker in ('"availability":"https://schema.org/SoldOut"', '"availability":"OutOfStock"', "مباع", "مؤجر"):
        body = SCHEMA + marker
        assert classify_dealapp(200, body=body, adid="501525", final_url=REQ, requested_url=REQ) == DEAD, marker


def test_sold_markers_are_ignored_without_the_schema():
    """A shell that happens to contain the word مباع somewhere is not an availability statement."""
    assert classify_dealapp(200, body=SHELL + "مباع", adid="501525",
                            final_url=REQ, requested_url=REQ) == UNKNOWN


# ── Failed reads ────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("status", [None, 401, 403, 429, 500, 502, 503, 301, 302])
def test_failed_blocked_or_unresolved_reads_are_unknown(status):
    v = classify_dealapp(status, body="", adid="501525", requested_url=REQ)
    assert v == UNKNOWN
    assert decide(v, strikes=2, policy=POLICY).action == "none"


# ── The environment guard ───────────────────────────────────────────────────────────────────────
def test_a_shelled_run_may_not_deactivate_anything():
    """0 of 500 probes verified ⇒ we are being served shells ⇒ this run's 404s are suspect too."""
    assert environment_is_trustworthy(alive_count=0, probe_count=500) is False


def test_a_healthy_run_is_trusted():
    assert environment_is_trustworthy(alive_count=400, probe_count=500) is True


def test_a_tiny_run_is_never_trusted_on_its_own():
    """Too few probes to tell a shelled environment from a small unlucky sample."""
    assert environment_is_trustworthy(alive_count=5, probe_count=5) is False


# ── The sitemap is a candidate filter, never a verdict ──────────────────────────────────────────
def test_sitemap_absence_only_reorders_probing():
    ids = frozenset({"111", "222"})
    assert sitemap_candidate_rank("999", ids) == 0, "absent → probe first"
    assert sitemap_candidate_rank("111", ids) == 1, "present → probe later"


def test_sitemap_absence_can_never_deactivate():
    """3,244 of our active rows are absent from dealapp's sitemap. Not one of them may be
    deactivated on that basis — only a DIRECT verdict can."""
    d = decide(DEAD, strikes=2, policy=POLICY, evidence=EvidenceKind.ABSENCE)
    assert d.action == "none" and d.strikes == 2


def test_death_still_requires_the_full_grace():
    strikes = 0
    for expected in ("strike", "strike", "deactivate"):
        d = decide(classify_dealapp(404, adid="1", requested_url=REQ), strikes=strikes, policy=POLICY)
        assert d.action == expected
        strikes = d.strikes
