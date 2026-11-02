-- 🔬 AF engineer 2026-10-23 (backlog 762): «شرفة» read out of «مشرفة» on every OTHER site goes back to unknown.
--
-- 20261020104914 fixed the shared prose reader (normalize._EMBEDDED_IN_NAME) and repaired muhaysini and dwelleo
-- residential only, and its detector watched only those two tables. The same reader feeds haraj, tuba, shomou, vmksa,
-- abralosol, dealapp, reinvest and muhaysini commercial, and their rows written before the fix still said
-- balcony = yes: an upsert that drops None never clears a True the fixed reader no longer produces.
-- Measured 2026-10-23 before this migration: 113 rows (82 active) with balcony_terrace = true whose title or
-- description holds «مشرفة / مشرفه» and whose title, description, additional_info and capture name no balcony
-- anywhere — dealapp residential 73, haraj 18, tuba 6, shomou 3, muhaysini commercial 3, dwelleo commercial 2,
-- muhaysini residential 2, aqarcity 2, vmksa 1, dealapp commercial 1, reinvest 1, abralosol 1. Served today:
-- balcony = yes on 19 of them in the district مشرفة (dealapp residential balcony is not served, its rows are
-- repaired so they are right the day it is).
-- The current reader returns no balcony for every one of those texts (checked on the branch, 2026-10-23).
-- Only a True with no balcony word goes to NULL (never to false: the ad is silent).
-- wasalt is left out on purpose: its balcony comes from the site's structured featureAmenities list
-- (scrapers/wasalt/run.py has("balcony")), which the row does not store, so a missing word proves nothing there.

create or replace function public.mon_detect_district_name_read_as_balcony()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
  r        record;
  v_act    int := 0;
  v_bad    int := 0;
  k_bad    int;
  k_sample jsonb;
  v_sample jsonb := '[]'::jsonb;
begin
  -- Exposure, read from the served index: a 0 means nothing named مشرفة is searchable, so silence proves nothing.
  -- (Scanning every table's text for the name took 8 s; the per-table scan below reads only balcony = yes rows.)
  select count(*) into v_act from public.search_listings_ar where district_ar ~ 'مشرف';
  for r in
    select distinct s.source_table t
      from public.search_listings_ar s
     where s.source_table not like 'wasalt%'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = s.source_table and c.column_name = 'balcony_terrace')
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = s.source_table and c.column_name = 'source_capture')
  loop
    execute format($q$
      with t as (
        select id,
               coalesce(title,'')||' '||coalesce(description,'') own,
               coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(additional_info::text,'')||' '||coalesce(source_capture::text,'') txt
          from public.%I where active and balcony_terrace)
      select count(*) filter (where own ~ 'مشرف[ةه]' and txt !~ '(بلكون|تراس|شرفات|(^|[^م])شرف[ةه])' and txt !~* 'balcon|terrace'),
             jsonb_agg(jsonb_build_object('t', %L, 'id', id))
               filter (where own ~ 'مشرف[ةه]' and txt !~ '(بلكون|تراس|شرفات|(^|[^م])شرف[ةه])' and txt !~* 'balcon|terrace')
        from t$q$, r.t, r.t)
      into k_bad, k_sample;
    v_bad := v_bad + coalesce(k_bad, 0);
    if k_sample is not null then v_sample := v_sample || k_sample; end if;
  end loop;

  if v_act = 0 then
    live := live || 'district_name_read_as_balcony:BLIND'::text;
    n := n + public.mon_raise('P2', 'district_name_read_as_balcony', 'fleet', 'district_name_read_as_balcony:BLIND',
      jsonb_build_object('blind', true, 'why', 'No served ad is in a district named مشرفة, so a 0 here proves nothing.'));
    perform public.mon_resolve_stale_keys('district_name_read_as_balcony', live);
    return n;
  end if;

  if v_bad > 0 then
    live := live || 'district_name_read_as_balcony:yes'::text;
    n := n + public.mon_raise('P2', 'district_name_read_as_balcony', 'fleet', 'district_name_read_as_balcony:yes',
      jsonb_build_object('rows', v_bad, 'of', v_act,
        'sample', (select jsonb_agg(x) from (select x from jsonb_array_elements(v_sample) x limit 10) z),
        'why', 'balcony = yes on an ad whose text names مشرفة and no balcony: «شرفة» was read out of the place name.',
        'action', 'scrapers/common/normalize.py _EMBEDDED_IN_NAME must keep refusing «شرفه» after «م»; find the writer.'));
  end if;

  perform public.mon_resolve_stale_keys('district_name_read_as_balcony', live);
  return n;
end
$function$;

-- The detector must SEE the rows before the repair (a detector that reads 0 here is blind).
do $c$
declare k int;
begin
  perform public.mon_detect_district_name_read_as_balcony();
  select count(*) into k from public.alert_event
   where kind = 'district_name_read_as_balcony' and resolved_at is null and dedup_key = 'district_name_read_as_balcony:yes';
  if k = 0 then raise exception 'detector raised nothing while district-name balcony rows exist'; end if;
end $c$;

-- The repair: True to NULL only, on exactly the rows the detector names, every table, active or not; the same ids
-- in the served index.
do $r$
declare r record; ids bigint[]; total int := 0; served int := 0; k int;
begin
  for r in
    select distinct s.source_table t
      from public.search_listings_ar s
     where s.source_table not like 'wasalt%'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = s.source_table and c.column_name = 'balcony_terrace')
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = s.source_table and c.column_name = 'source_capture')
  loop
    execute format($q$
      with u as (
        update public.%I set balcony_terrace = null
         where balcony_terrace
           and coalesce(title,'')||' '||coalesce(description,'') ~ 'مشرف[ةه]'
           and coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(additional_info::text,'')||' '||coalesce(source_capture::text,'') !~ '(بلكون|تراس|شرفات|(^|[^م])شرف[ةه])'
           and coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(additional_info::text,'')||' '||coalesce(source_capture::text,'') !~* 'balcon|terrace'
        returning id)
      select coalesce(array_agg(id), '{}') from u$q$, r.t)
      into ids;
    if cardinality(ids) > 0 then
      total := total + cardinality(ids);
      update public.search_listings_ar set balcony = null
       where source_table = r.t and listing_id = any(ids) and balcony;
      get diagnostics k = row_count;
      served := served + k;
      raise notice '% : % rows to NULL, % served', r.t, cardinality(ids), k;
    end if;
  end loop;
  if total > 120 then
    raise exception 'repair touched more rows than measured (113): %', total;
  end if;
  raise notice 'district-name balcony to NULL: % rows, % served', total, served;
end $r$;

-- Check: the detector now resolves its own alert.
do $c2$
declare k int;
begin
  perform public.mon_detect_district_name_read_as_balcony();
  select count(*) into k from public.alert_event
   where kind = 'district_name_read_as_balcony' and resolved_at is null and dedup_key = 'district_name_read_as_balcony:yes';
  if k <> 0 then raise exception 'detector still reports district-name balcony rows after the repair'; end if;
end $c2$;
