-- district_contradicts_source: re-read the SOURCE before raising, so a stale oracle snapshot never pages (🆕 2026-11-10).
--
-- repeat_bug:district_contradicts_source (alert 14121, P1, «come back 3 times in 7 days») for
-- district_contradicts_source:gathern_residential_listings. Measured 2026-11-10 07:2x UTC: all three reopens were ONE
-- gathern unit each, raised at 05:59 and resolved at 06:59 (alerts 13180 11-05, 13811 11-08, 14118 11-10), each a
-- different unit (22099539, 9195068, 15344788). The cause is timing, not a wrong district:
--   * the oracle listing_source_district_ar_fleet is a snapshot refreshed every 3 h (cron jobid 148 '20 */3 * * *':
--     03:20, 06:20 …);
--   * gathern's daily crawl (gh-gathern-daily 04:08) rewrites additional_info.district_ar ~04:34 when the site
--     re-files a unit, and the 05:22 sync serves the new value;
--   * the 05:59 sweep then compares that fresh served value with the 03:20 snapshot, raises, and the 06:20 refresh
--     clears it. 15344788 today: snapshot «حي الملقا» (03:20), source + served «حي الحمراء» (its pin 24.7787, 46.7742
--     is in الحمراء), oracle «حي الحمراء» again at 06:20:51.
-- Fix (the check, not the threshold): the detector evaluates the view ONCE into a temp table, re-reads the CURRENT
-- source value for just those candidates (the same expression refresh_listing_source_district_ar_fleet uses: Arabic
-- additional_info.district_ar, else district_ar, else neighborhood; active rows only), writes it into the oracle, and
-- drops from THIS sweep only the candidates whose oracle reading changed on that re-read (they are judged by the next
-- sweep against what the source says now). A candidate whose oracle already held the current source value is a real
-- contradiction and raises exactly as before. Nothing else in the detector changes. Cron schedules are untouched.
create or replace function public.mon_detect_district_contradicts_source()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  t record;
  k int;
  seen text[] := array[]::text[];
  ar constant text := 'case when %1$s ~ ''[؀-ۿ]'' and %1$s !~ ''[A-Za-z]'' then nullif(btrim(%1$s, '' :-،.''), '''') end';
  expr text;
begin
  drop table if exists pg_temp._dcs_candidates;
  create temp table _dcs_candidates on commit drop as
    select source_table, listing_id, platform, source_says, we_display
      from public.mon_district_contradicts_source;

  -- Repair before raising: re-read each candidate's own source row now (🆕 2026-11-10, alert 14121).
  for t in
    select distinct c.source_table, cl.oid as rel
      from _dcs_candidates c
      join pg_class cl on cl.relname = c.source_table and cl.relnamespace = 'public'::regnamespace and cl.relkind = 'r'
  loop
    expr := concat_ws(', ',
              format(ar, '(x.additional_info->>''district_ar'')'),
              case when exists (select 1 from pg_attribute a where a.attrelid = t.rel and a.attname = 'district_ar'
                                   and not a.attisdropped)
                   then format(ar, 'x.district_ar') end,
              format(ar, 'x.neighborhood'));
    execute format(
      'with cur as (select x.id, coalesce(%1$s) as v from public.%2$I x
                     where x.active and x.id in (select listing_id from _dcs_candidates where source_table = %3$L)),
            upd as (update public.listing_source_district_ar_fleet f
                       set source_district_ar = cur.v, refreshed_at = now()
                      from cur
                     where f.source_table = %3$L and f.listing_id = cur.id
                       and cur.v is not null and cur.v is distinct from f.source_district_ar
                 returning f.listing_id),
            del as (delete from public.listing_source_district_ar_fleet f
                     where f.source_table = %3$L
                       and f.listing_id in (select listing_id from _dcs_candidates where source_table = %3$L)
                       and not exists (select 1 from cur where cur.id = f.listing_id and cur.v is not null)
                 returning f.listing_id)
       delete from _dcs_candidates d
        where d.source_table = %3$L
          and d.listing_id in (select listing_id from upd union select listing_id from del)',
      expr, t.source_table, t.source_table);
    get diagnostics k = row_count;
  end loop;

  for r in
    select source_table, platform, count(*)::bigint as rows_affected,
           (array_agg(listing_id order by listing_id))[1:5] as sample_ids,
           (array_agg(source_says || ' -> ' || we_display order by listing_id))[1:3] as sample_pairs
      from _dcs_candidates
     group by source_table, platform
     order by count(*) desc
  loop
    seen := seen || r.source_table;
    n := n + public.mon_raise(
      'P1', 'district_contradicts_source', r.platform,
      'district_contradicts_source:' || r.source_table,
      jsonb_build_object(
        'source_table', r.source_table,
        'rows_affected', r.rows_affected,
        'sample_listing_ids', to_jsonb(r.sample_ids),
        'sample_source_to_displayed', to_jsonb(r.sample_pairs),
        'why', r.rows_affected || ' listing(s) are SERVED a district the source never published. '
               'The comparison is against listing_source_district_ar — what the source itself '
               'published — and is normalisation-aware, so a spelling variant is not a finding: '
               'these genuinely name a different neighbourhood. A user filtering by the real '
               'district cannot find the listing, and a user filtering by the displayed one finds a '
               'property that is not there. Known cause (2026-08-31): listings_arabic_locations is '
               'a frozen snapshot with no refresh job, and listing_native_location_v1 falls back to '
               'it for district_ar whenever the upstream arm yields NULL. REPAIR: copy the source '
               'row''s own neighborhood + additional_info.district_ar into that table for the '
               'contradicting listings, refresh listing_native_location_v1, then '
               'sync_search_listings_ar. Verify each row''s two source fields agree with each other '
               'first; where they do not, resolve to NULL rather than guessing (§6). The source value '
               'was re-read at this sweep (2026-11-10), so a stale oracle snapshot is not what raised this.'));
  end loop;

  -- Self-heal: a table that no longer contradicts its source resolves on the next sweep.
  perform public.mon_resolve_key('district_contradicts_source',
                                 'district_contradicts_source:' || t2.relname)
    from pg_class t2 join pg_namespace ns on ns.oid = t2.relnamespace
   where ns.nspname = 'public' and t2.relkind = 'r'
     and t2.relname ~ '_(residential|commercial)_listings$'
     and not (t2.relname = any(seen));

  return n;
end $function$;

-- Check block: EXECUTE the detector in both directions on planted rows, then roll each back.
--  (a) the ORACLE holds an old district the source no longer says → re-read, not a candidate, oracle repaired;
--  (b) the SERVED district is wrong while the oracle is current → still a candidate (the alarm still fires).
do $chk$
declare
  st text; lid bigint; real_v text; after_v text;
begin
  select f.source_table, f.listing_id, f.source_district_ar into st, lid, real_v
    from public.listing_source_district_ar_fleet f
    join public.search_listings_ar s on s.source_table = f.source_table and s.listing_id = f.listing_id
   where f.source_table = 'gathern_residential_listings'
     and norm_district_tok(s.district_ar) = norm_district_tok(f.source_district_ar)
     and not exists (select 1 from public.district_recovery d where d.source_table = f.source_table
                        and d.listing_id = f.listing_id)
   limit 1;
  if st is null then
    raise exception 'check: no agreeing gathern row to plant on';
  end if;

  begin  -- (a) stale oracle
    update public.listing_source_district_ar_fleet set source_district_ar = 'حي فحص قديم زائف'
     where source_table = st and listing_id = lid;
    if not exists (select 1 from public.mon_district_contradicts_source where source_table = st and listing_id = lid) then
      raise exception 'check (a): the planted stale reading did not reach the view (test is blind)';
    end if;
    perform public.mon_detect_district_contradicts_source();
    select source_district_ar into after_v from public.listing_source_district_ar_fleet
     where source_table = st and listing_id = lid;
    if after_v is distinct from real_v then
      raise exception 'check (a): the detector did not re-read the source (oracle %, source %)', after_v, real_v;
    end if;
    if exists (select 1 from _dcs_candidates where source_table = st and listing_id = lid) then
      raise exception 'check (a): a stale oracle reading is still raised for %', lid;
    end if;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then raise; end if;
  end;

  begin  -- (b) a real contradiction
    update public.search_listings_ar set district_ar = 'حي فحص خاطئ زائف'
     where source_table = st and listing_id = lid;
    perform public.mon_detect_district_contradicts_source();
    if not exists (select 1 from _dcs_candidates where source_table = st and listing_id = lid) then
      raise exception 'check (b): a wrong served district was dropped — the alarm is blind';
    end if;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm <> 'ROLLBACK_OK' then raise; end if;
  end;
end $chk$;
