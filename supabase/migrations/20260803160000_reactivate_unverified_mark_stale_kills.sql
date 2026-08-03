-- P1 (2026-08-03): un-hide listings the OLD buggy mark_stale_listings_inactive() wrongly killed
-- before PR#256 (2026-07-28, supabase/migrations/20260728200000_mark_stale_detect_only_no_unverified_kill.sql)
-- made it detect-only. PR#256 stopped the bleeding; it never reactivated what had already bled.
--
-- SIGNATURE (proven, not assumed): active=false AND missing_count=0 (never actually re-verified as
-- gone — every source-verified kill path in this codebase writes missing_count>=3 before
-- deactivating; see PR#256's closing comment and its mon_unverified_inactivations_24h invariant)
-- AND deactivated_at's time-of-day is exactly 04:00:00 UTC (cron jobid 13's old schedule,
-- `0 4 * * *`) AND deactivated_at is before 2026-07-29 (the fix's cutover date — 0 such rows land
-- from 2026-07-29 onward, confirmed live below). No other predicate; nothing else is touched.
--
-- An earlier audit pass (2026-07-28) found 827 such rows across three tables. Re-derived fresh here
-- (time has passed; some rows self-healed via auto_recover_false_inactive — jobid 30, daily 05:20,
-- which reactivates missing_count=0 rows re-seen by a scraper in the last 24h — or were legitimately
-- re-verified/re-killed for real reasons since): 410 rows survive, across FOUR tables. The fourth,
-- aqaratikom_commercial_listings (1 row), was not in the original 3-table finding but matches the
-- identical proven signature, so it is included — same root cause, same proof, checked against every
-- one of the ~63 platform tables the old buggy sweep could have touched, not just the three
-- previously named.
--
-- deactivated_at is NOT explicitly preserved here, and that is deliberate, not an oversight: all
-- four tables carry `trg_set_deactivated_at` (BEFORE UPDATE), which unconditionally sets
-- deactivated_at := NULL whenever NEW.active = true. That is a schema-level invariant — the column
-- means "when this row was last deactivated; NULL means currently active" — and EVERY other
-- reactivation path in this codebase (auto_recover_false_inactive, scrapers/common/cleanup.py's
-- self-heal) already goes through it and already gets deactivated_at cleared on reactivation. Fighting
-- it here would make this batch the one inconsistent case in the whole system (an "active" row with a
-- stale deactivated_at), which is worse than following the existing, universally-applied convention.
--
-- missing_count is reset to 0 — already true by the match predicate — matching the normal value for
-- an active row (scrapers/common/db.py resets missing_count to 0 whenever a listing is seen again).
--
-- Fail-closed per the aqar-licence-price precedent (20260728210000_aqar_null_licence_number_prices.sql):
-- count first (per table AND total), abort if the live count has moved since this migration was
-- written, only then update, then re-verify the updated row count matches too.

do $$
declare
  n_dealapp_res      int;
  n_dealapp_com      int;
  n_aqar_com         int;
  n_aqaratikom_com   int;
  n_total            int;
  exp_dealapp_res    constant int := 356;
  exp_dealapp_com    constant int := 44;
  exp_aqar_com       constant int := 9;
  exp_aqaratikom_com constant int := 1;
  exp_total          constant int := 410;
  upd                int;
  upd_total          int := 0;
begin
  select count(*) into n_dealapp_res from public.dealapp_residential_listings
   where active = false and coalesce(missing_count, 0) = 0
     and to_char(deactivated_at at time zone 'utc', 'HH24:MI:SS') = '04:00:00'
     and deactivated_at < '2026-07-29'::date;

  select count(*) into n_dealapp_com from public.dealapp_commercial_listings
   where active = false and coalesce(missing_count, 0) = 0
     and to_char(deactivated_at at time zone 'utc', 'HH24:MI:SS') = '04:00:00'
     and deactivated_at < '2026-07-29'::date;

  select count(*) into n_aqar_com from public.aqar_commercial_listings
   where active = false and coalesce(missing_count, 0) = 0
     and to_char(deactivated_at at time zone 'utc', 'HH24:MI:SS') = '04:00:00'
     and deactivated_at < '2026-07-29'::date;

  select count(*) into n_aqaratikom_com from public.aqaratikom_commercial_listings
   where active = false and coalesce(missing_count, 0) = 0
     and to_char(deactivated_at at time zone 'utc', 'HH24:MI:SS') = '04:00:00'
     and deactivated_at < '2026-07-29'::date;

  n_total := n_dealapp_res + n_dealapp_com + n_aqar_com + n_aqaratikom_com;

  if n_dealapp_res <> exp_dealapp_res or n_dealapp_com <> exp_dealapp_com
     or n_aqar_com <> exp_aqar_com or n_aqaratikom_com <> exp_aqaratikom_com
     or n_total <> exp_total then
    raise exception 'unverified-inactivation reactivation gate mismatch: '
      'dealapp_residential=% (expected %), dealapp_commercial=% (expected %), '
      'aqar_commercial=% (expected %), aqaratikom_commercial=% (expected %), total=% (expected %) '
      '— aborting rather than reactivating an unproven set',
      n_dealapp_res, exp_dealapp_res, n_dealapp_com, exp_dealapp_com,
      n_aqar_com, exp_aqar_com, n_aqaratikom_com, exp_aqaratikom_com, n_total, exp_total;
  end if;

  update public.dealapp_residential_listings
     set active = true, missing_count = 0
   where active = false and coalesce(missing_count, 0) = 0
     and to_char(deactivated_at at time zone 'utc', 'HH24:MI:SS') = '04:00:00'
     and deactivated_at < '2026-07-29'::date;
  get diagnostics upd = row_count; upd_total := upd_total + upd;

  update public.dealapp_commercial_listings
     set active = true, missing_count = 0
   where active = false and coalesce(missing_count, 0) = 0
     and to_char(deactivated_at at time zone 'utc', 'HH24:MI:SS') = '04:00:00'
     and deactivated_at < '2026-07-29'::date;
  get diagnostics upd = row_count; upd_total := upd_total + upd;

  update public.aqar_commercial_listings
     set active = true, missing_count = 0
   where active = false and coalesce(missing_count, 0) = 0
     and to_char(deactivated_at at time zone 'utc', 'HH24:MI:SS') = '04:00:00'
     and deactivated_at < '2026-07-29'::date;
  get diagnostics upd = row_count; upd_total := upd_total + upd;

  update public.aqaratikom_commercial_listings
     set active = true, missing_count = 0
   where active = false and coalesce(missing_count, 0) = 0
     and to_char(deactivated_at at time zone 'utc', 'HH24:MI:SS') = '04:00:00'
     and deactivated_at < '2026-07-29'::date;
  get diagnostics upd = row_count; upd_total := upd_total + upd;

  if upd_total <> exp_total then
    raise exception 'unverified-inactivation reactivation updated % row(s), expected % — rolling back',
      upd_total, exp_total;
  end if;

  raise notice 'unverified-inactivation reactivation: % row(s) restored to active=true '
    '(missing_count reset to 0; deactivated_at cleared by trg_set_deactivated_at, same as every '
    'other reactivation path)', upd_total;
end $$;
