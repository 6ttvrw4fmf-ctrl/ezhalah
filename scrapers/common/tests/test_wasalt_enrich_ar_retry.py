"""Regression tests for the Wasalt AR-enrichment error-retry pass (2026-07-16).

Guards the backlog bug: definitive fetch errors (404 / noNEXT / noslug) were written as
ar_fetched=true + ar_data={'_err': …} and then NEVER re-attempted by any code path — 738 active
rows (720 res + 18 com) accumulated with city_ar/district_ar/region_id all NULL, ~90% of which
had been re-captured live by the list scraper since the single failed attempt (run.py refreshes
listing_url with the current slug on every upsert, so one-time slug drift 404s were permanent).
An older code version also stamped 43 rows with the literal marker {'_err': 'transient'} on
2026-06-25; those must be treated as retryable legacy rows with one prior attempt.

The fix: every definitive error write goes through bump_err() (attempt counter `_errn`, terminal
`_parked` flag at ERR_MAX_ATTEMPTS), and enrich_table() runs a bounded oldest-first retry pass
selecting only retry_eligible() rows. These tests pin the pure policy functions.

Run: python -m pytest scrapers/common/tests/test_wasalt_enrich_ar_retry.py -v
"""
from scrapers.wasalt.enrich_ar import ERR_MAX_ATTEMPTS, bump_err, retry_eligible


def test_first_definitive_error_starts_counter():
    out = bump_err({"_err": 404}, None)  # pending row: no prior ar_data
    assert out == {"_err": 404, "_errn": 1}
    assert "_parked" not in out


def test_legacy_bare_err_counts_as_one_prior_attempt():
    # Rows written before the counter existed — incl. the 2026-06-25 {'_err': 'transient'} stamps.
    out = bump_err({"_err": 404}, {"_err": "transient"})
    assert out["_errn"] == 2


def test_counter_increments_and_parks_exactly_at_cap():
    prev = None
    for n in range(1, ERR_MAX_ATTEMPTS + 1):
        out = bump_err({"_err": 404}, prev)
        assert out["_errn"] == n
        if n < ERR_MAX_ATTEMPTS:
            assert "_parked" not in out, f"parked too early at attempt {n}"
        else:
            assert out["_parked"] is True, "must park at ERR_MAX_ATTEMPTS"
        prev = out


def test_error_kind_may_change_between_attempts():
    # 404 on attempt 1, WAF soft-block noNEXT on attempt 2 — the counter carries across kinds.
    out = bump_err({"_err": "noNEXT"}, {"_err": 404, "_errn": 1})
    assert out == {"_err": "noNEXT", "_errn": 2}


def test_garbage_counter_falls_back_to_one_prior_attempt():
    out = bump_err({"_err": 404}, {"_err": 404, "_errn": "garbage"})
    assert out["_errn"] == 2


def test_success_payload_is_never_retry_eligible():
    # A real enriched payload has no _err — retrying it would burn proxy bandwidth for nothing.
    assert retry_eligible({"propertyInfo": {"city": "الرياض"}}) is False


def test_unparked_error_is_retry_eligible():
    assert retry_eligible({"_err": 404}) is True
    assert retry_eligible({"_err": "transient"}) is True  # legacy 2026-06-25 rows
    assert retry_eligible({"_err": 404, "_errn": 2}) is True


def test_parked_error_is_never_retry_eligible():
    parked = bump_err({"_err": 404}, {"_err": 404, "_errn": ERR_MAX_ATTEMPTS - 1})
    assert parked["_parked"] is True
    assert retry_eligible(parked) is False


def test_missing_or_non_dict_ar_data_is_never_retry_eligible():
    assert retry_eligible(None) is False
    assert retry_eligible("404") is False
    assert retry_eligible([]) is False


if __name__ == "__main__":
    test_first_definitive_error_starts_counter()
    test_legacy_bare_err_counts_as_one_prior_attempt()
    test_counter_increments_and_parks_exactly_at_cap()
    test_error_kind_may_change_between_attempts()
    test_garbage_counter_falls_back_to_one_prior_attempt()
    test_success_payload_is_never_retry_eligible()
    test_unparked_error_is_retry_eligible()
    test_parked_error_is_never_retry_eligible()
    test_missing_or_non_dict_ar_data_is_never_retry_eligible()
    print("OK — wasalt enrich-AR retry regression tests pass")
