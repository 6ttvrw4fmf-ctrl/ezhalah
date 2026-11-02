-- 🔬 AF engineer 2026-10-20 (backlog 761): «شرفة» read out of the district name «مشرفة» goes back to unknown.
--
-- The shared prose reader (scrapers/common/normalize.py amenities_from_text) matched «شرفة / شرفه» anywhere in the
-- text, and it is the tail of Jeddah's district «مشرفة». muhaysini and dwelleo run their description through it, and
-- their descriptions say «في حي مشرفة», so the ads there were served balcony = yes. Measured before this migration
-- (search_listings_ar): balcony true in مشرفة on muhaysini 112 of 167 and dwelleo 36 of 38. Of the active rows, 101
-- (muhaysini) and 26 (dwelleo) carry no balcony word anywhere: not in title, description, the structured amenity
-- tags (additional_info) or the capture. A customer asking the Advanced Filter for a balcony got them.
-- The reader is fixed in the same change (normalize._EMBEDDED_IN_NAME, PR 7863).
-- Only a True with no balcony word goes to NULL (never to false: the ad is silent); a row whose text names a balcony
-- («بلكونة», «تراس», «شرفات», a «شرفة» not inside «مشرفة», English balcony / terrace) is never touched.

create or replace function public.mon_detect_district_name_read_as_balcony()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n       int := 0;
  live    text[] := '{}';
  v_act   int;
  v_bad   int;
  v_sample jsonb;
begin
  with t as (
    select 'muhaysini_residential_listings' tbl, id, balcony_terrace b, coalesce(district_ar, neighborhood, '') dist,
           coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(additional_info::text,'')||' '||coalesce(source_capture::text,'') txt
      from public.muhaysini_residential_listings where active
    union all
    select 'dwelleo_residential_listings', id, balcony_terrace, coalesce(district_ar, neighborhood, ''),
           coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(additional_info::text,'')||' '||coalesce(source_capture::text,'')
      from public.dwelleo_residential_listings where active)
  select count(*) filter (where dist ~ 'مشرف'),
         count(*) filter (where b and dist ~ 'مشرف' and txt !~ '(بلكون|تراس|شرفات|(^|[^م])شرف[ةه])' and txt !~* 'balcon|terrace'),
         jsonb_agg(jsonb_build_object('t', tbl, 'id', id))
           filter (where b and dist ~ 'مشرف' and txt !~ '(بلكون|تراس|شرفات|(^|[^م])شرف[ةه])' and txt !~* 'balcon|terrace')
    into v_act, v_bad, v_sample
    from t;

  if v_act = 0 then
    live := live || 'district_name_read_as_balcony:BLIND'::text;
    n := n + public.mon_raise('P2', 'district_name_read_as_balcony', 'muhaysini', 'district_name_read_as_balcony:BLIND',
      jsonb_build_object('blind', true, 'why', 'No active muhaysini or dwelleo ad in مشرفة, so a 0 here proves nothing.'));
    perform public.mon_resolve_stale_keys('district_name_read_as_balcony', live);
    return n;
  end if;

  if v_bad > 0 then
    live := live || 'district_name_read_as_balcony:yes'::text;
    n := n + public.mon_raise('P2', 'district_name_read_as_balcony', 'muhaysini', 'district_name_read_as_balcony:yes',
      jsonb_build_object('rows', v_bad, 'of', v_act,
        'sample', (select jsonb_agg(x) from (select x from jsonb_array_elements(v_sample) x limit 10) z),
        'why', 'balcony = yes on an ad in مشرفة whose text names no balcony: «شرفة» was read out of the district name.',
        'action', 'scrapers/common/normalize.py _EMBEDDED_IN_NAME must keep refusing «شرفه» after «م»; find the writer.'));
  end if;

  perform public.mon_resolve_stale_keys('district_name_read_as_balcony', live);
  return n;
end
$function$;

-- Roster entry in the same change (AGENTS.md): a detector nothing reaches is decoration.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_district_name_read_as_balcony' in src) > 0 then
    raise notice 'mon_detect_district_name_read_as_balcony already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_gathern_manufactured_no'',',
    E'    ''mon_detect_gathern_manufactured_no'',\n    ''mon_detect_district_name_read_as_balcony'',');
  if out_def = src then
    raise exception 'roster anchor not found, refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- The detector must SEE the rows before the repair (a detector that reads 0 here is blind).
do $c$
declare k int;
begin
  perform public.mon_detect_district_name_read_as_balcony();
  select count(*) into k from public.alert_event
   where kind = 'district_name_read_as_balcony' and resolved_at is null and dedup_key = 'district_name_read_as_balcony:yes';
  if k = 0 then raise exception 'detector raised nothing while district-name balcony rows exist'; end if;
end $c$;

-- The repair: True to NULL only, on exactly the rows the detector names, source and the same ids in the served index.
do $r$
declare mi bigint[]; di bigint[]; s1 int; s2 int;
begin
  with u as (
    update public.muhaysini_residential_listings set balcony_terrace = null
     where active and balcony_terrace and coalesce(district_ar, neighborhood, '') ~ 'مشرف'
     and coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(additional_info::text,'')||' '||coalesce(source_capture::text,'') !~ '(بلكون|تراس|شرفات|(^|[^م])شرف[ةه])'
     and coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(additional_info::text,'')||' '||coalesce(source_capture::text,'') !~* 'balcon|terrace'
    returning id)
  select coalesce(array_agg(id), '{}') into mi from u;
  with u as (
    update public.dwelleo_residential_listings set balcony_terrace = null
     where active and balcony_terrace and coalesce(district_ar, neighborhood, '') ~ 'مشرف'
     and coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(additional_info::text,'')||' '||coalesce(source_capture::text,'') !~ '(بلكون|تراس|شرفات|(^|[^م])شرف[ةه])'
     and coalesce(title,'')||' '||coalesce(description,'')||' '||coalesce(additional_info::text,'')||' '||coalesce(source_capture::text,'') !~* 'balcon|terrace'
    returning id)
  select coalesce(array_agg(id), '{}') into di from u;
  if cardinality(mi) > 110 or cardinality(di) > 30 then
    raise exception 'repair touched more rows than measured, muhaysini % dwelleo %', cardinality(mi), cardinality(di);
  end if;
  update public.search_listings_ar set balcony = null
   where source_table = 'muhaysini_residential_listings' and listing_id = any(mi) and balcony;
  get diagnostics s1 = row_count;
  update public.search_listings_ar set balcony = null
   where source_table = 'dwelleo_residential_listings' and listing_id = any(di) and balcony;
  get diagnostics s2 = row_count;
  raise notice 'district-name balcony to NULL: muhaysini %, dwelleo %, served % and %', cardinality(mi), cardinality(di), s1, s2;
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