-- routine-3 DATA INTEGRITY, 2026-09-24.
--
-- THE DEFECT. scrapers/ialqarawi/run.py shares ONE numeric-token reader between prices and areas.
-- In that reader a dot/comma followed by exactly three digits is a thousands SEPARATOR, which is
-- correct and measured for this office's price cells («3850.000» is 3,850,000). Applied to an
-- AREA it silently multiplies by 1000 the one shape a surveyed land area actually takes: metre²
-- to the mm². ialqarawi_commercial_listings 12595094 (QRW3566, «للبيع أرض زراعية بحي شمال عنيزة»)
-- carries the source string «361788.431م» in additional_info.area_raw and was stored — and
-- indexed — as 361,788,431 m²: 362 km², larger than عنيزة governorate. The listing's own
-- description gives its frontages as 316.64 m / 245.70 m / 698.97 m / 504 m.
--
-- WHY NULL AND NOT 361788. Both readings are grammatically available and differ by 1000x, and
-- ialqarawi rows carry an `auto.v1-fallback` source_capture with no raw HTML, so NOTHING on record
-- can settle which the office meant. Honest NULL beats a guess (owner rule). The exact source
-- string stays in additional_info.area_raw, so a future live probe can still resolve it and no
-- published figure is lost.
--
-- SCOPE. Heads of 1-4 digits are unambiguous and untouched: measured over the complete ialqarawi
-- vocabulary (2,568 rows, 150 separator strings) they are 149 correct rows. A head of 5+ digits
-- has exactly one instance in the whole platform — the row repaired here.

-- ---------------------------------------------------------------------------
-- 1. The permanent barrier, for the CLASS and not for ialqarawi.
--    It discovers tables by shape from platform_registry, so a platform activated tomorrow that
--    reuses a price grammar on an area is caught without anyone remembering to extend a list.
--    It compares the STORED area against the row's OWN captured source string, so it measures the
--    real production value rather than pinning a line of source text.
-- ---------------------------------------------------------------------------
create or replace function public.mon_detect_area_contradicts_area_raw()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; v_n bigint; v_rows jsonb; n int := 0; offenders jsonb := '[]'::jsonb; total bigint := 0;
begin
  for rec in
    select t.table_name tn
      from information_schema.tables t
     where t.table_schema = 'public' and t.table_name like '%\_listings'
       and exists (select 1 from information_schema.columns c
                    where c.table_name = t.table_name and c.column_name = 'additional_info')
       and exists (select 1 from information_schema.columns c
                    where c.table_name = t.table_name and c.column_name = 'area_m2')
     order by t.table_name
  loop
    begin
      execute format($f$
        select count(*),
               coalesce(jsonb_agg(jsonb_build_object('id', id, 'area_m2', area_m2,
                                                     'area_raw', additional_info->>'area_raw')), '[]'::jsonb)
          from public.%I
         where active
           and area_m2 is not null
           and additional_info->>'area_raw' ~ '\d{5,}[.,]\d{3}'
           and area_m2::text = regexp_replace(
                 (regexp_match(additional_info->>'area_raw', '\d{5,}[.,]\d{3}'))[1], '[.,]', '', 'g')
      $f$, rec.tn) into v_n, v_rows;
    exception when others then continue;
    end;

    if v_n > 0 then
      total := total + v_n;
      offenders := offenders || jsonb_build_object('table', rec.tn, 'rows', v_n, 'sample', v_rows);
    end if;
  end loop;

  if total > 0 then
    n := public.mon_raise('P2', 'area_contradicts_area_raw', 'all', 'area_contradicts_area_raw',
      jsonb_build_object(
        'offending_rows', total,
        'tables', offenders,
        'why', 'The stored area_m2 is this row''s own captured area string with a dot/comma '
               'STRIPPED, on a token whose head is 5+ digits. At that length the separator reads '
               'equally as a thousands group and as a decimal point, and the two readings differ '
               'by 1000x — a surveyed land area «361788.431م» becomes 362 km². Do NOT pick a '
               'reading and do NOT round: fix the scraper to abstain (area_skip_reason = '
               '''ambiguous_thousands_or_decimal'') and leave area_m2 NULL, keeping the exact '
               'string in additional_info.area_raw. A head of 1-4 digits is unambiguous grouping '
               'and is deliberately NOT flagged.'));
  else
    perform public.mon_resolve_key('area_contradicts_area_raw', 'area_contradicts_area_raw');
  end if;

  return n;
end $function$;

comment on function public.mon_detect_area_contradicts_area_raw() is
  'routine-3 2026-09-24: a served area must never be the separator-stripped reading of an ambiguous '
  '5+ digit-head token. Measures stored area against the row''s own captured area_raw, across every '
  'listing table discovered by shape.';

-- ---------------------------------------------------------------------------
-- 2. Wire it into the roster IN THE SAME MIGRATION. A detector nothing calls is decoration, and
--    mon_detect_orphaned_detectors() fires on any detector nothing reaches.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text; v_before text;
  fn constant text := 'mon_detect_area_contradicts_area_raw';
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;

  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;

  if v_def = v_before then
    raise notice 'roster already lists % — nothing to do', fn;
    return;
  end if;
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------
-- 3. WATCH THE BARRIER CATCH THE REAL DEFECT, before repairing it. A barrier that has never been
--    seen to go red on the bug it exists for is an untested barrier (§G.9).
-- ---------------------------------------------------------------------------
do $$
declare v_n bigint;
begin
  select count(*) into v_n
    from public.ialqarawi_commercial_listings
   where active and area_m2 is not null
     and additional_info->>'area_raw' ~ '\d{5,}[.,]\d{3}'
     and area_m2::text = regexp_replace(
           (regexp_match(additional_info->>'area_raw', '\d{5,}[.,]\d{3}'))[1], '[.,]', '', 'g');
  if v_n <> 1 then
    raise exception 'expected the barrier to see exactly 1 offending row before repair, saw %', v_n;
  end if;
  raise notice 'RED confirmed: barrier sees the defect (1 row)';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Repair the one proven row. The area is ABSTAINED, never guessed; the source string is kept.
-- ---------------------------------------------------------------------------
update public.ialqarawi_commercial_listings
   set area_m2 = null,
       additional_info = coalesce(additional_info, '{}'::jsonb)
                         || jsonb_build_object(
                              'area_skip_reason', 'ambiguous_thousands_or_decimal',
                              'area_repair_2026_09_24', jsonb_build_object(
                                'was', 361788431,
                                'source_string', additional_info->>'area_raw',
                                'by', 'routine-3-data-integrity',
                                'why', 'stored value was the source string with its separator stripped; '
                                       'both readings differ by 1000x and no stored capture can settle it'))
 where id = 12595094
   and area_m2 = 361788431;

-- ---------------------------------------------------------------------------
-- 5. GREEN proof: the same predicate, now clean, and the detector runs and resolves its key.
-- ---------------------------------------------------------------------------
do $$
declare v_n bigint; v_raw text; v_area int;
begin
  select area_m2, additional_info->>'area_raw'
    into v_area, v_raw
    from public.ialqarawi_commercial_listings where id = 12595094;
  if v_area is not null then
    raise exception 'repair did not land: area_m2 is still %', v_area;
  end if;
  if v_raw is distinct from '361788.431م' then
    raise exception 'the source string was not preserved: %', v_raw;
  end if;

  select count(*) into v_n
    from public.ialqarawi_commercial_listings
   where active and area_m2 is not null
     and additional_info->>'area_raw' ~ '\d{5,}[.,]\d{3}'
     and area_m2::text = regexp_replace(
           (regexp_match(additional_info->>'area_raw', '\d{5,}[.,]\d{3}'))[1], '[.,]', '', 'g');
  if v_n <> 0 then
    raise exception 'still % offending rows after repair', v_n;
  end if;
  raise notice 'GREEN confirmed: area NULL, source string preserved, 0 offending rows';
end $$;

do $$
declare body text := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
begin
  if position('mon_detect_area_contradicts_area_raw' in body) = 0 then
    raise exception 'mon_detect_area_contradicts_area_raw was not wired into the roster';
  end if;
  perform public.mon_detect_area_contradicts_area_raw();
  raise notice 'area/area_raw barrier wired and executing';
end $$;
