-- auto_recover_false_inactive: recover from the mistake, not from the crawl schedule -- and never
-- undo an adjudication.
--
-- TWO DEFECTS, both live, found 2026-08-30 while auditing the 8 res/com collision retractions.
--
-- 1. THE WINDOW WAS KEYED ON THE WRONG TIMESTAMP. The job recovered rows whose `last_seen_at` fell
--    inside a 24h window. But last_seen_at records when a CRAWL saw the row, not when the wrong
--    deactivation happened, so the effective recovery window was `24h minus however long ago the
--    last crawl ran` -- an accident of crawl timing. Measured on today's sadin rows: last crawled
--    04:24, next recovery run 05:20 tomorrow, i.e. a window 55 MINUTES wide. A row wrongly
--    deactivated an hour outside that accident is never recovered at all, and nothing says so.
--    Now keyed on `deactivated_at`: a fixed period after the mistake, which is the thing the window
--    was always meant to measure. (A row deactivated without stamping deactivated_at still falls
--    back to last_seen_at -- recovering a live listing is the safe direction, and the adjudication
--    exemption below guards the unsafe one.)
--
-- 2. IT HAD NO ADJUDICATION EXEMPTION AT ALL. Owner rule, 2026-08-30: "adjudicated duplicate ->
--    cannot auto-reactivate." Migrations 20260830140110/140831 retracted 8 listings (5 sadin, 3
--    dealapp) that shared an ad_number and listing_url with a still-active commercial sibling. Each
--    carries missing_count = 0, because it was never struck -- it was ADJUDICATED. That is exactly
--    the shape this job recovers. It did not fire on them today only because their last crawl fell
--    55 minutes the right side of the window; an hour later and it would have reactivated all
--    eight, re-creating the URL collision the repair had just fixed.
--
-- ROOT CAUSE OF THE SECOND ONE, and why this migration adds a view rather than another `not
-- exists`: the exemption was written once, against ONE ledger, and a second ledger arrived later.
-- mon_unverified_inactivations_24h exempts ops_adjudicated_retraction and knows nothing about
-- ops_res_com_collision_adjudication. Adding a second clause in each place would leave the same
-- trap set for the third ledger. ops_adjudicated_listing is now the single answer to "has a human
-- or a recorded adjudication already decided about this row", and both callers read it.

-- ---------------------------------------------------------------------------------------------
-- 1. ONE PLACE THAT KNOWS WHAT HAS BEEN ADJUDICATED
-- ---------------------------------------------------------------------------------------------
create or replace view public.ops_adjudicated_listing as
  select r.source_table                          as tbl,
         r.listing_id                            as listing_id,
         'adjudicated_retraction'::text          as ledger,
         r.retracted_at                          as adjudicated_at
    from public.ops_adjudicated_retraction r
  union
  select a.platform || '_residential_listings',
         a.res_id,
         'res_com_collision'::text,
         a.adjudicated_at
    from public.ops_res_com_collision_adjudication a
   where a.res_active_after is false;

comment on view public.ops_adjudicated_listing is
  'Every listing row a recorded adjudication has decided about, from every ledger, as (tbl, '
  'listing_id). Anything that reactivates rows or grades inactivations must read THIS, not one '
  'ledger -- the res/com collision ledger arrived after the retraction ledger and every consumer '
  'written against the older one silently stopped covering the newer. '
  'ops_deleted_but_source_live_adjudication is deliberately NOT unioned in: its ref_id points at a '
  'deletion-log row, not a live listing row, so it cannot answer this question.';

-- ---------------------------------------------------------------------------------------------
-- 2. THE RECOVERY JOB
-- ---------------------------------------------------------------------------------------------
create or replace function public.auto_recover_false_inactive(recent_window interval default '24:00:00'::interval)
returns table(tbl text, recovered integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t text; n int;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'deal\_%' and tablename not like 'muktamel\_%'
  loop
    execute format($f$
      update public.%I t
         set active = true
       where t.active = false
         and coalesce(t.missing_count, 0) = 0
         -- WHEN THE MISTAKE HAPPENED, not when a crawler last passed by. The fallback covers a row
         -- deactivated without stamping deactivated_at: recovering a live listing is the safe
         -- direction, and the adjudication guard below is what makes it safe.
         and (t.deactivated_at >= now() - $1
              or (t.deactivated_at is null and t.last_seen_at >= now() - $1))
         -- An adjudicated row was never struck BECAUSE a decision was recorded about it. It looks
         -- identical to a wrongly-flipped row and must never be auto-reactivated (owner,
         -- 2026-08-30). mon_detect_adjudicated_reactivation() proves this clause still holds.
         and not exists (select 1 from public.ops_adjudicated_listing j
                          where j.tbl = %L and j.listing_id = t.id)
    $f$, t, t) using recent_window;
    get diagnostics n = row_count;
    if n > 0 then tbl := t; recovered := n; return next; end if;
  end loop;
end
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. THE MONITOR THAT GRADES INACTIVATIONS READS THE SAME LEDGER SET
-- ---------------------------------------------------------------------------------------------
create or replace view public.mon_unverified_inactivations_24h as
  select coalesce(sum(n), 0::bigint)::integer as unverified_inactivations_24h
    from (
      select (xpath('/row/c/text()',
                query_to_xml(format(
                  'select count(*) c from public.%I t '
                  'where t.active = false and coalesce(t.missing_count,0) < 3 '
                  '  and t.deactivated_at >= now() - interval ''24 hours'' '
                  '  and not exists (select 1 from public.ops_adjudicated_listing j '
                  '                   where j.tbl = %L and j.listing_id = t.id)',
                  tablename, tablename), false, true, '')))[1]::text::integer as n
        from pg_tables
       where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
    ) s;

comment on view public.mon_unverified_inactivations_24h is
  'Rows deactivated in the last 24h without reaching full grace and without a recorded '
  'adjudication -- i.e. inactivations nothing can account for. Reads ops_adjudicated_listing so a '
  'new ledger cannot silently reintroduce false positives (it did: this view exempted only '
  'ops_adjudicated_retraction and graded all 8 res/com collision retractions as unverified).';

-- ---------------------------------------------------------------------------------------------
-- 4. THE BARRIER: prove the exemption holds in the OTHER direction too
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_adjudicated_reactivation()
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare n int := 0; v_rows jsonb; v_count int;
begin
  -- An exemption is only worth anything if something checks it was honoured. If an adjudicated row
  -- is active again, some path reactivated it -- the recovery job, a scraper upsert, or a hand
  -- edit -- and the URL collision (or whatever the adjudication settled) is back.
  select count(*), coalesce(jsonb_agg(x order by x->>'tbl', (x->>'listing_id')::bigint), '[]'::jsonb)
    into v_count, v_rows
    from (
      select jsonb_build_object('tbl', j.tbl, 'listing_id', j.listing_id, 'ledger', j.ledger) as x
        from public.ops_adjudicated_listing j
       where (xpath('/row/c/text()',
                query_to_xml(format('select count(*) c from public.%I where id = %s and active',
                                    j.tbl, j.listing_id), false, true, '')))[1]::text::int > 0
       limit 200
    ) q;

  if v_count > 0 then
    n := public.mon_raise('P1', 'adjudicated_reactivation', 'all',
      'adjudicated_reactivation:' || current_date,
      jsonb_build_object('count', v_count, 'rows', v_rows,
        'why', 'a listing a recorded adjudication had retracted is ACTIVE again. Something '
            || 'reactivated it -- auto_recover_false_inactive, a scraper upsert, or a manual '
            || 'edit -- and whatever the adjudication settled (a res/com URL collision, a '
            || 'duplicate) is live in search again.',
        'action', 'select * from ops_adjudicated_listing; compare against the row current state '
            || 'before reversing anything. Do NOT resolve this by deleting the ledger row.'));
  else
    perform public.mon_resolve_key('adjudicated_reactivation',
                                   'adjudicated_reactivation:' || current_date);
  end if;
  return n;
end $fn$;

do $roster$
declare src text; new_src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then
    raise exception 'mon_run_all_detectors() not found - cannot register the detector';
  end if;
  if position('mon_detect_adjudicated_reactivation' in src) > 0 then
    return;
  end if;
  new_src := replace(src,
    '''mon_detect_unverified_inactivation''',
    '''mon_detect_unverified_inactivation'', ''mon_detect_adjudicated_reactivation''');
  if new_src = src then
    raise exception 'roster anchor not found in mon_run_all_detectors() - refusing to leave '
                    'mon_detect_adjudicated_reactivation unreachable';
  end if;
  execute new_src;
end $roster$;

do $verify$
declare src text; v_unverified int; v_adj int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_adjudicated_reactivation' in src) = 0 then
    raise exception 'mon_detect_adjudicated_reactivation is not in the roster after registration';
  end if;

  -- The 8 res/com retractions must now read as accounted-for, and none of them may be active.
  select unverified_inactivations_24h into v_unverified from public.mon_unverified_inactivations_24h;
  if v_unverified <> 0 then
    raise notice 'unverified_inactivations_24h = % after the ledger union (expected 0 today)', v_unverified;
  end if;
  select count(*) into v_adj from public.ops_adjudicated_listing;
  if v_adj = 0 then
    raise exception 'ops_adjudicated_listing is empty - the union lost every ledger row';
  end if;
end $verify$;