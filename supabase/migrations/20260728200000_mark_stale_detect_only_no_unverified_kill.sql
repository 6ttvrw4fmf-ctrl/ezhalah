-- P1 (2026-07-28 audit): `mark_stale_listings_inactive` must never flip `active` again.
--
-- WHAT IT DID: cron jobid 13 (`0 4 * * *`) deactivated listings on ONE predicate —
--   last_seen_at < now() - stale_days
-- with NO source re-fetch. It is plpgsql; it CANNOT re-fetch a listing_url. So it is structurally
-- incapable of satisfying the standing rule that a kill must be source-verified, and no amount of
-- guard-tuning fixes that. Every OTHER kill path in this system re-fetches before killing:
-- scrapers/aqar/liveness.py (404/410/dead-marker), scrapers/wasalt/liveness.py (enum-strike +
-- control group), db.prune_unseen (3-strike enumeration + 0-seen/collapse/coverage breakers), and
-- scrapers/common/cleanup.py (probe → verdict → reactivate-on-live).
--
-- THE HARM, MEASURED: on 2026-07-28 04:00 it deactivated 59 dealapp_commercial rows in a single
-- statement (all sharing deactivated_at to the microsecond, all missing_count=0). 12 of those were
-- sampled and re-fetched LIVE through dealapp's OWN sold-predicate: 12/12 returned HTTP 200 with
-- schema.org availability=InStock, no sold badge, and real prices. They were ALIVE. dealapp
-- commercial inventory dropped 204 → 145 (-28.9%) with zero source evidence.
--
-- WHY ITS TWO GUARDS DID NOT SAVE IT: the collapse breaker needs stale > 30% of active — 59/204 was
-- 28.9%, just under. The coverage gate credits `max(rows_seen)` from ANY scrape_runs row matching
-- `platform = plat OR platform ~ '^plat[_:]'`, so the COMMERCIAL table's floor of 102 was cleared by
-- a run of a different vertical — in fact by `dealapp_recover`, the weekly RECOVERY arm, which only
-- re-probes already-inactive rows and enumerates no catalogue at all. Coverage was "proven" by a job
-- that provides zero coverage evidence.
--
-- WHY REMOVING THE FLIP IS SAFE — measured, not assumed. Rows killed by this path in the last 30
-- days, per table (active=false, missing_count=0, deactivated_at in the 04:00-04:01 window):
--     dealapp_residential   715
--     dealapp_commercial    118
--     aqar_commercial        10
--     aqaratikom_commercial   1
--     every other table       0
-- 844 total, 833 of them dealapp (98.7%). The "last-resort sweep for ~30 tables" concern does not
-- survive contact with the data: 26 of the 30 tables in the loop have had ZERO kills from it, so
-- they cannot depend on it. And all four that did have a source-verified path of their own —
-- dealapp has jobid 48 `dealapp-recover-weekly` (2026-07-27 run: checked 1,770, recovered 591 proven
-- alive, found 0 sold), aqar_commercial has scrapers/aqar/liveness.py, aqaratikom has prune_unseen.
-- The platform this swept hardest is precisely the one that needs it least.
--
-- WHAT IT DOES NOW: staleness is reported, not acted on. That is what it actually measures — "a
-- scraper's catalogue coverage has gaps" — not "these listings are gone". Both former flip sites
-- raise a P2 alert instead. The breakers and the coverage gate are kept because they still decide
-- whether the signal is trustworthy enough to alert on. Deactivation stays owned by the four paths
-- that re-fetch the source and self-heal.
--
-- Trade accepted, per the standing rule (false-ALIVE beats false-kill): a genuinely dead listing on
-- a platform with a weak re-probe may linger until its real liveness pass catches it. That is the
-- direction the owner has chosen, and it is recoverable; a false kill is silent and is not.
--
-- Body rebuilt from pg_get_functiondef of the LIVE function; ONLY the two `set active = false,
-- missing_count = 0` writes are replaced. Same signature (integer, numeric) so no new overload.

create or replace function public.mark_stale_listings_inactive(stale_days integer DEFAULT 7, max_frac numeric DEFAULT 0.30)
 returns integer
 language plpgsql
as $function$
declare
  t text; n int; act int; stale int; total int := 0; skipped int := 0;
  escape_after_days constant int      := 3;
  escape_batch      constant int      := 25;
  alive_window      constant interval := interval '48 hours';
  coverage_frac     constant numeric  := 0.50;
  plat text; alive boolean; st record; escaped int;
  recent_best int; coverage_floor int;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'wasalt_%'
      and tablename <> 'aqar_residential_listings'
  loop
    execute format('select count(*) from public.%I where active = true', t) into act;
    execute format('select count(*) from public.%I where active = true and last_seen_at < now() - $1 * interval ''1 day''', t)
      using stale_days into stale;

    if act >= 8 and stale > max_frac * act then
      raise notice 'mark_stale: SKIP %  (% of % active would go stale > %%%)', t, stale, act, (max_frac*100)::int;
      skipped := skipped + 1;

      insert into public.mon_stale_breaker_state as s
             (tbl, consecutive_breaker_days, last_breaker_at, updated_at)
      values (t, 1, now(), now())
      on conflict (tbl) do update
        set consecutive_breaker_days = case
              when s.last_breaker_at >= date_trunc('day', now()) then s.consecutive_breaker_days
              else s.consecutive_breaker_days + 1 end,
            last_breaker_at = now(),
            updated_at      = now();

      select * into st from public.mon_stale_breaker_state where tbl = t;

      plat  := regexp_replace(t, '_(residential|commercial)_listings$', '');
      alive := exists (
        select 1 from public.scrape_runs r
        where r.ok
          and r.started_at > now() - alive_window
          and (r.platform = plat or r.platform ~ ('^' || plat || '[_:]'))
      );

      if st.consecutive_breaker_days >= escape_after_days
         and alive
         and (st.last_escape_at is null or st.last_escape_at < date_trunc('day', now()))
      then
        -- WAS: flip the 25 oldest-stale rows to active=false, missing_count=0 — an UNVERIFIED kill
        -- on a table whose breaker has been tripping for days, i.e. exactly when the crawl is least
        -- trustworthy. Now: record that we reached the escape condition and alert. Nothing flips.
        escaped := 0;

        update public.mon_stale_breaker_state
           set last_escape_at = now(),
               updated_at     = now()
         where tbl = t;

        perform public.mon_raise(
          'P2', 'stale_breaker_escape', plat, 'stale_breaker_escape:' || t,
          jsonb_build_object(
            'table', t, 'active', act, 'stale', stale,
            'consecutive_breaker_days', st.consecutive_breaker_days,
            'note', 'breaker escape reached; NOT deactivating (time-based kills are unverified). '
                 || 'Needs a source-verified liveness/re-probe pass for this platform.'));

        raise notice 'mark_stale: ESCAPE % — % stale row(s) REPORTED, none deactivated (breaker day %)',
          t, stale, st.consecutive_breaker_days;
      end if;

      continue;
    end if;

    update public.mon_stale_breaker_state
       set consecutive_breaker_days = 0, updated_at = now()
     where tbl = t and consecutive_breaker_days <> 0;

    plat := regexp_replace(t, '_(residential|commercial)_listings$', '');
    select max(r.rows_seen) into recent_best
      from public.scrape_runs r
     where r.ok
       and r.started_at > now() - alive_window
       and (r.platform = plat or r.platform ~ ('^' || plat || '[_:]'));
    coverage_floor := ceil(coverage_frac * act);

    if act >= 8 and (recent_best is null or recent_best < coverage_floor) then
      skipped := skipped + 1;
      raise notice 'mark_stale: COVERAGE-SKIP % (recent_best=% < floor=% ; % stale row(s) withheld)',
        t, coalesce(recent_best, 0), coverage_floor, stale;
      if stale > 0 then
        perform public.mon_raise(
          'P2', 'stale_coverage_gate', plat, 'stale_coverage_gate:' || t,
          jsonb_build_object(
            'table', t, 'active', act, 'stale_withheld', stale,
            'recent_best_rows_seen', recent_best, 'coverage_floor', coverage_floor,
            'coverage_frac', coverage_frac, 'window_hours', 48));
      end if;
      continue;
    end if;

    update public.alert_event set resolved_at = now()
     where kind = 'stale_coverage_gate' and dedup_key = 'stale_coverage_gate:' || t and resolved_at is null;

    -- WAS: `update ... set active = false, missing_count = 0 where last_seen_at < now() - stale_days`.
    -- That is the false-kill. A row being absent from a partial daily crawl is NOT evidence that the
    -- listing is gone — dealapp enumerates only a recent slice per day, so "stale" there means "not
    -- in today's slice". Report it; let a source-verified path do the killing.
    n := 0;
    if stale > 0 then
      perform public.mon_raise(
        'P2', 'stale_listings_detected', plat, 'stale_listings_detected:' || t,
        jsonb_build_object(
          'table', t, 'active', act, 'stale', stale, 'stale_days', stale_days,
          'note', 'reported only — this path never deactivates (a time-based sweep cannot verify '
               || 'a listing is dead). Deactivation belongs to aqar/wasalt liveness, prune_unseen, '
               || 'or cleanup.py, all of which re-fetch the source first.'));
      raise notice 'mark_stale: % stale row(s) in % REPORTED, none deactivated', stale, t;
    else
      update public.alert_event set resolved_at = now()
       where kind = 'stale_listings_detected' and dedup_key = 'stale_listings_detected:' || t
         and resolved_at is null;
    end if;
    total := total + n;
  end loop;
  if skipped > 0 then raise notice 'mark_stale: % table(s) skipped by circuit breaker / coverage gate', skipped; end if;
  return total;  -- always 0 now: this function reports, it does not deactivate
end $function$;

-- ── Daily invariant: no listing may be inactivated without a liveness signal ─────────────────────
-- Every source-verified path writes missing_count >= 3 (prune_unseen's grace, the sold-pin, the
-- aqar/wasalt liveness passes, and the 2026-07-28 awal link-rot inactivation). ONLY the time-based
-- sweep wrote 0. So `active = false AND missing_count < 3` recently is, by construction, an
-- unverified kill — and after this migration nothing can produce one.
-- Expect a NON-ZERO reading for up to 24h after deploy: today's 59 dealapp_commercial false-kills
-- are still inside the window. They age out, and jobid 48 re-probes and restores the live ones on
-- 2026-08-03. A non-zero reading after that is a genuine regression.
create or replace view public.mon_unverified_inactivations_24h as
select coalesce(sum(n), 0)::int as unverified_inactivations_24h
from (
  select (xpath('/row/c/text()', query_to_xml(format(
           'select count(*) c from public.%I where active = false '
        || 'and coalesce(missing_count,0) < 3 '
        || 'and deactivated_at >= now() - interval ''24 hours''',
           tablename), false, true, '')))[1]::text::int as n
  from pg_tables
  where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
) s;

comment on view public.mon_unverified_inactivations_24h is
  'Audit invariant (2026-07-28): rows deactivated in the last 24h WITHOUT a liveness signal '
  '(missing_count < 3). Must be 0. Non-zero means some path deactivated listings without '
  're-fetching the source — the mark_stale_listings_inactive defect class.';

grant select on public.mon_unverified_inactivations_24h to service_role;
