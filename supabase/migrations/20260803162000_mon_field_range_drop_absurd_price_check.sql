-- Nightly audit (2026-08-03): mon_check_run_field_ranges check (b) `absurd_price_while_active`
-- is a stale invariant left behind by PR#280 and must go.
--
-- Its own comment states the premise: "thresholds IDENTICAL to _sanitize_price() (>1B total /
-- >100M annual). A row over these lines surviving as active means the Python guard didn't run on
-- this write path. Live baseline today: exactly 0 rows fleet-wide."
--
-- PR#280 deleted that Python guard ON PURPOSE (owner rule: extreme-price verify-then-preserve — a
-- source-published price is NEVER grounds to hide a listing; it is stored EXACTLY and the row stays
-- active). So the assertion inverted: it now fires precisely when the pipeline behaves correctly.
-- Observed: dealapp run 22880 (2026-08-03 15:32) wrote 138 rows, killed nothing (`sold=0 pruned=0`),
-- hit ONE active row over the threshold, and was RC-B-demoted to ok=False by end_run() — which also
-- feeds mon_detect_silent_scraper_death, so a healthy crawl would have raised a false P1. Every one
-- of the ~34 scrapers funnels through end_run(), so this was not a dealapp-only fault: any platform
-- touching a source-published extreme price would be falsely demoted.
--
-- Parse-artifact coverage is NOT reduced: the phone/ID artifact bands ([500M,600M] mobile,
-- [100.0M,101.0M] REGA/ID) stay in mon_detect_field_integrity, the low band stays in
-- mon_buy_token_price, and checks (a) null-price regression, (c) tiny-rent, (d) placeholder
-- location and (e) missing critical field are untouched by this migration.
--
-- The `absurd_price_active` variable and its aggregate term are intentionally LEFT IN PLACE so the
-- positional INTO list of the single aggregate pass stays aligned; only the reason block is removed.
--
-- Guarded needle-edit per the RPC full-body-replace rule: built from the LIVE function def, aborts
-- if the anchor is not found. Live def md5 at authoring time: 2df5ffde066e98cc6971c5e061866cb9.
do $mig$
declare src text; out text; needle text; repl text;
begin
  src := pg_get_functiondef('public.mon_check_run_field_ranges(bigint, text, text, timestamptz, text[])'::regprocedure);

  needle := $needle$  -- (b) absurd active price — zero-tolerance, thresholds IDENTICAL to _sanitize_price()
  -- (>1B total / >100M annual). A row over these lines surviving as active means the Python
  -- guard didn't run on this write path. Live baseline today: exactly 0 rows fleet-wide.
  if absurd_price_active > 0 then
    degraded := true;
    worst_sev := 'P1';
    reasons := reasons || jsonb_build_object('check','absurd_price_while_active',
      'count', absurd_price_active, 'threshold_total_sar', 1000000000, 'threshold_annual_sar', 100000000);
  end if;
$needle$;

  repl := $repl$  -- (b) REMOVED 2026-08-03 (nightly audit). This asserted that no ACTIVE row may carry
  -- price_total > 1B or price_annual > 100M — i.e. that _sanitize_price() had force-killed it.
  -- PR#280 deleted that clause deliberately (owner rule: extreme-price verify-then-preserve), so the
  -- assertion inverted and fired exactly when the pipeline behaved CORRECTLY: it RC-B-demoted a
  -- healthy dealapp crawl to ok=False (run 22880, 2026-08-03 15:32, 1 row, sold=0 pruned=0) and
  -- would raise a false silent-scraper-death P1 on any platform touching such a row. Parse-artifact
  -- coverage is unchanged — phone/ID bands in mon_detect_field_integrity, low band in
  -- mon_buy_token_price, checks (a)/(c)/(d)/(e) below untouched. `absurd_price_active` is still
  -- selected above only to keep the aggregate's positional INTO list aligned.
$repl$;

  if position(needle in src) = 0 then
    raise exception 'mon_check_run_field_ranges: absurd-price needle not found — aborting (function shape changed)';
  end if;

  out := replace(src, needle, repl);

  if out = src then
    raise exception 'mon_check_run_field_ranges: edit did not apply — aborting';
  end if;
  if position('absurd_price_while_active' in out) > 0 then
    raise exception 'mon_check_run_field_ranges: reason string still present after edit — aborting';
  end if;
  if position('placeholder_location_written' in out) = 0
     or position('missing_critical_field' in out) = 0
     or position('rent_annual_suspiciously_tiny' in out) = 0
     or position('buy_price_null_regression' in out) = 0
     or position('rent_price_null_regression' in out) = 0 then
    raise exception 'mon_check_run_field_ranges: a sibling check was lost — aborting';
  end if;

  execute out;
end
$mig$;
