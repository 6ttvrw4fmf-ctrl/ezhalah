-- Liveness rotation strand detector (routine-3-data-integrity, 2026-09-21).
--
-- THE GAP THIS CLOSES. mark_stale_listings_inactive() — the only path that reports a table's
-- stale-active backlog (stale_listings_detected / stale_active / stale_breaker_escape) — excludes
-- three tables BY NAME:
--
--     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
--       and tablename not like 'wasalt_%'
--       and tablename <> 'aqar_residential_listings'
--
-- The exclusion is correct in intent: those tables have their own DIRECT_REVISIT sweep
-- (scrapers/aqar/liveness.py), which is a better oracle than a time-based sweep. But nothing
-- anywhere checks that the substitute mechanism actually REACHES EVERY ROW. That is the
-- "a pointer reads as coverage" shape (AGENTS.md, PART 1.11): the exclusion points at another
-- mechanism and no barrier measures whether the other mechanism arrived.
--
-- It was live. Measured 2026-09-21: 169 aqar_residential_listings rows are active with
-- missing_count = 0 and last_seen_at frozen in 2026-07-25..28 — 55 days, on a platform whose
-- declared SLA is 48h. They carry no liveness evidence of any kind and, because missing_count
-- never increments, they can never reach the 3-strike grace either, so served_after_source_gone
-- and prune_unseen can never see them. Every existing liveness-health barrier is a PLATFORM-LEVEL
-- FRACTION (169/93,030 = 0.18%), so all of them read aqar as 99.4% healthy. A direct probe of 25
-- of the 169 against sa.aqar.fm, using the repo's own looks_dead() predicate lifted out of
-- scrapers/aqar/liveness.py, returned LIVE 25/25 — so nothing wrong is being SERVED today. The
-- defect is that if these rows die at source, no mechanism in the system will ever notice.
--
-- WHAT THIS DETECTOR ASSERTS. For every listing table that mark_stale_listings_inactive() excludes
-- by name: zero active rows may sit past 3x their platform's declared SLA with no strike against
-- them. The exclusion list is PARSED OUT OF THE LIVE FUNCTION SOURCE, never hardcoded here, so a
-- table exempted tomorrow is watched from that moment without anyone remembering to update a list.
--
-- WHAT IT IS NOT. It does not duplicate stale_listings_detected/stale_active/refresh_coverage:
-- those cover every table this one ignores, and this one covers only the tables they are switched
-- off for. It never deactivates or repairs anything — a stranded row is UNKNOWN, not dead
-- (docs/ops/LISTING_LIVENESS.md), and the repair is to get the sweep to reach it, never to kill it.

create or replace function public.ops_stale_sweep_excluded_tables()
returns table (tbl text, platform text, sla_hours int)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  src   text;
  excl  text[] := '{}';
  m     text[];
begin
  -- Read the live definition of the stale sweep and lift its by-name exclusions out of it. Both
  -- shapes it uses are recognised:  tablename <> 'x'   and   tablename not like 'pat%'.
  -- Parsing the source (rather than restating the list) is the whole point: this detector must
  -- not be able to disagree with the function it is covering for.
  src := pg_get_functiondef('public.mark_stale_listings_inactive(integer, numeric)'::regprocedure);

  for m in select regexp_matches(src, 'tablename\s*<>\s*''([^'']+)''', 'g') loop
    excl := excl || ('=' || m[1]);
  end loop;
  for m in select regexp_matches(src, 'tablename\s+not\s+like\s+''([^'']+)''', 'g') loop
    excl := excl || ('~' || m[1]);
  end loop;

  if array_length(excl, 1) is null then
    -- Zero exclusions is a legitimate state (someone removed them) but it is also exactly what a
    -- silently-broken parse looks like, so say so instead of returning an empty, reassuring set.
    raise notice 'ops_stale_sweep_excluded_tables: no by-name exclusions found in mark_stale_listings_inactive';
    return;
  end if;

  return query
  select t.tablename::text,
         regexp_replace(t.tablename, '_(residential|commercial)_listings$', '')::text,
         g.sla_hours
    from pg_tables t
    left join public.ops_liveness_registry g
      on g.platform = regexp_replace(t.tablename, '_(residential|commercial)_listings$', '')
   where t.schemaname = 'public'
     and t.tablename ~ '_(residential|commercial)_listings$'
     and exists (
       select 1 from unnest(excl) e
        where (left(e, 1) = '=' and t.tablename = substr(e, 2))
           or (left(e, 1) = '~' and t.tablename like substr(e, 2))
     );
end
$function$;

comment on function public.ops_stale_sweep_excluded_tables() is
  'The listing tables mark_stale_listings_inactive() skips by name, read out of its live source. '
  'Used by mon_detect_liveness_rotation_stranded() so the watcher can never disagree with the '
  'function it covers for.';


create or replace function public.mon_detect_liveness_rotation_stranded()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n          int := 0;
  live       text[] := '{}';
  r          record;
  v_active   bigint;
  v_stranded bigint;
  v_oldest   timestamptz;
  v_sample   text;
begin
  for r in select * from public.ops_stale_sweep_excluded_tables() loop

    if r.sla_hours is null then
      -- An excluded table with no declared SLA cannot be judged in either direction. That is a
      -- finding, not a reason to skip it: the stale sweep is off for this table and nothing knows
      -- how fresh it is supposed to be.
      live := live || ('liveness_rotation_stranded:' || r.tbl);
      n := n + public.mon_raise('P2', 'liveness_rotation_stranded', r.platform,
        'liveness_rotation_stranded:' || r.tbl,
        jsonb_build_object(
          'source_table', r.tbl,
          'why', 'mark_stale_listings_inactive() excludes this table by name, so no stale-active '
              || 'barrier watches it, and ops_liveness_registry declares no SLA for its platform '
              || '— so nothing can say how stale is too stale. Register the platform in '
              || 'ops_liveness_registry (and scrapers/common/liveness_policies.py + '
              || 'sql/mirrors/liveness_registry.json, same change) or stop excluding the table.'));
      continue;
    end if;

    execute format($q$
      select count(*) filter (where active),
             count(*) filter (where active and coalesce(missing_count,0) = 0
                                and last_seen_at < now() - interval '%s hours'),
             min(last_seen_at) filter (where active and coalesce(missing_count,0) = 0
                                and last_seen_at < now() - interval '%s hours'),
             (array_agg(id order by last_seen_at) filter (where active
                                and coalesce(missing_count,0) = 0
                                and last_seen_at < now() - interval '%s hours'))[1:5]::text
        from public.%I
    $q$, r.sla_hours * 3, r.sla_hours * 3, r.sla_hours * 3, r.tbl)
      into v_active, v_stranded, v_oldest, v_sample;

    if coalesce(v_stranded, 0) > 0 then
      live := live || ('liveness_rotation_stranded:' || r.tbl);
      n := n + public.mon_raise('P2', 'liveness_rotation_stranded', r.platform,
        'liveness_rotation_stranded:' || r.tbl,
        jsonb_build_object(
          'source_table', r.tbl,
          'active_rows', v_active,
          'stranded_rows', v_stranded,
          'sla_hours', r.sla_hours,
          'threshold_hours', r.sla_hours * 3,
          'oldest_last_seen_at', v_oldest,
          'sample_ids', v_sample,
          'why', 'These rows are active, carry NO strike (missing_count = 0) and have not been '
              || 'seen by any mechanism in more than 3x this platform''s declared SLA. This table '
              || 'is excluded BY NAME from mark_stale_listings_inactive(), on the understanding '
              || 'that its own DIRECT_REVISIT sweep covers it instead — these rows are the ones '
              || 'that sweep is not reaching. Because missing_count never increments for them they '
              || 'can never reach the strike grace either, so served_after_source_gone and '
              || 'prune_unseen are structurally blind to them, and every platform-level coverage '
              || 'percentage reads healthy while they sit there.',
          'action', 'Find why the platform''s own liveness sweep skips these ids and fix the '
              || 'sweep. Re-probe them by DIRECT fetch of each listing''s own URL and let the real '
              || 'oracle write the verdict.',
          'do_not', 'Do NOT deactivate or delete them and do NOT backdate last_seen_at to clear '
              || 'this alert. A row nothing has looked at is UNKNOWN, never dead '
              || '(docs/ops/LISTING_LIVENESS.md), and writing a freshness we did not observe is '
              || 'the forged-freshness class this repo already has an incident for. Only a real '
              || 'source observation may move last_seen_at.'));
    end if;
  end loop;

  perform public.mon_resolve_stale_keys('liveness_rotation_stranded', live);
  return n;
end
$function$;

comment on function public.mon_detect_liveness_rotation_stranded() is
  'Rows that no liveness mechanism reaches, on the tables the stale sweep is switched off for. '
  'Absolute count, not a fraction: 169 stranded aqar rows were 0.18% of the platform and invisible '
  'to every percentage-based barrier for 55 days (routine-3, 2026-09-21).';


-- Roster registration, in the SAME migration as the detector (AGENTS.md: a detector nothing
-- reaches is decoration, and mon_detect_orphaned_detectors() fires on it). The roster is a text[]
-- literal inside mon_run_all_detectors(); this edits that literal in place rather than restating
-- a ~200-entry function body, which would be its own drift risk.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_liveness_rotation_stranded' in src) > 0 then
    raise notice 'mon_detect_liveness_rotation_stranded already on the roster';
  else
    src := replace(src,
      '''mon_detect_loc_rel_cycle_budget'',',
      '''mon_detect_loc_rel_cycle_budget'',' || chr(10) ||
      '    ''mon_detect_liveness_rotation_stranded'',');
    if position('mon_detect_liveness_rotation_stranded' in src) = 0 then
      raise exception 'roster anchor not found — refusing to register a detector nothing runs';
    end if;
    execute src;
  end if;
end $$;
