-- =====================================================================================================
-- Ezhalah owner-locked 7-day listing lifecycle — STEP 4 / 6
-- Patch mark_stale_listings_inactive(): also set missing_count = 3 when it hides a row.
-- =====================================================================================================
--
-- THE BUG BEING FIXED (immortality)
--   Today mark_stale sets active=false but leaves missing_count untouched (stays 0 from the last
--   upsert). The purge gate requires missing_count >= 3, so every row mark_stale hides is UNPURGEABLE
--   forever — this is the source of the ~4,365 "immortal" mc=0 inactive rows measured on 2026-07-10.
--   Setting missing_count = 3 in the same UPDATE aligns mark_stale's hides with the mc>=3 purge gate,
--   exactly as the 3-strike prune and sold-pin paths already do.
--
-- WHAT IS PRESERVED EXACTLY (owner requirement — do not touch)
--   * The wasalt_% and aqar_residential_listings exclusions (verbatim, including the original
--     TEMPORARY rationale comments).
--   * The circuit breaker: if act >= 8 AND stale > max_frac * act -> raise notice + SKIP the table.
--     One bad crawl must never stale-out a big chunk of a platform.
--   * The signature, defaults (stale_days=7, max_frac=0.30), loop, counters and return value.
--
-- deactivated_at IS NOT SET HERE ON PURPOSE
--   The step-2 BEFORE-UPDATE trigger stamps deactivated_at automatically when active flips true->false,
--   so mark_stale needs no deactivated_at logic. Keeping the hide logic in one place (the trigger)
--   avoids drift between the five different hide paths.
--
-- ONLY CHANGE vs the live function: `set active = false`  ->  `set active = false, missing_count = 3`
-- (plus these comments). Everything else is byte-for-byte the current production body.
--
-- FILES ONLY. Not applied. Cron jobid 13 (this function, 04:00 UTC) is NOT modified.
-- =====================================================================================================

CREATE OR REPLACE FUNCTION public.mark_stale_listings_inactive(stale_days integer DEFAULT 7, max_frac numeric DEFAULT 0.30)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare t text; n int; act int; stale int; total int := 0; skipped int := 0;
begin
  -- TEMPORARY: exclude Wasalt (re-scrape off; last_seen not a validity signal).
  -- TEMPORARY (2026-06-30): exclude Aqar RESIDENTIAL during the all-SA deep scrape — its deeper
  -- pages are back-filled in batches and a 400-sample showed ~84% of "inactive" aqar_residential
  -- were still LIVE. Aqar is governed by its own liveness sweep (3-strike HTTP check) instead.
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'wasalt_%'
      and tablename <> 'aqar_residential_listings'
  loop
    execute format('select count(*) from public.%I where active = true', t) into act;
    execute format('select count(*) from public.%I where active = true and last_seen_at < now() - $1 * interval ''1 day''', t)
      using stale_days into stale;
    -- circuit breaker: refuse to stale-out a big chunk of a platform in one pass.
    if act >= 8 and stale > max_frac * act then
      raise notice 'mark_stale: SKIP %  (% of % active would go stale > %%%)', t, stale, act, (max_frac*100)::int;
      skipped := skipped + 1;
      continue;
    end if;
    -- PATCH (7-day lifecycle): ALSO set missing_count = 3 so the hidden row satisfies purge's mc>=3
    -- gate instead of becoming an immortal mc=0 row. deactivated_at is handled by trg_set_deactivated_at.
    execute format(
      'update public.%I set active = false, missing_count = 3 where active = true and last_seen_at < now() - $1 * interval ''1 day''',
      t
    ) using stale_days;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  if skipped > 0 then
    raise notice 'mark_stale: % table(s) skipped by circuit breaker', skipped;
  end if;
  return total;
end $function$;
