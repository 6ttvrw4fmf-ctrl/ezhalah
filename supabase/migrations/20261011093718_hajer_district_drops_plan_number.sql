-- 🔬 AF engineer 2026-10-11, backlog 184/247. OUR DISTRICT NEVER CARRIES A NUMBER (owner rule 2026-09-14,
-- 20260914204035): match on our name, keep the source's number on the card. hajer wrote its subdivision plan
-- number into district_ar («الورود (1100/4)», «مخطط الرياض (474/19)»), norm_district_tok() kept it, so no
-- district option reached these 25 Al-Ahsa listings and a customer who picked the district never saw them
-- (journey FAIL hajer_residential_listings:584515). Only the «n/m» plan number goes; every word stays, and
-- `neighborhood` still holds the source's whole string, which is what the card prints. The scraper writes the
-- same value from now on (scrapers/hajer/run.py _district_without_plan_number), so a crawl cannot undo this.
update public.hajer_residential_listings
   set district_ar = btrim(regexp_replace(regexp_replace(district_ar,
         '[\s\-–]*[(\[]?\s*[0-9٠-٩]+\s*/\s*[0-9٠-٩]+\s*[)\]]?', ' ', 'g'), '\s{2,}', ' ', 'g'), ' -–')
 where district_ar ~ '[0-9٠-٩]+\s*/\s*[0-9٠-٩]+';
update public.hajer_commercial_listings
   set district_ar = btrim(regexp_replace(regexp_replace(district_ar,
         '[\s\-–]*[(\[]?\s*[0-9٠-٩]+\s*/\s*[0-9٠-٩]+\s*[)\]]?', ' ', 'g'), '\s{2,}', ' ', 'g'), ' -–')
 where district_ar ~ '[0-9٠-٩]+\s*/\s*[0-9٠-٩]+';

-- The standing watch, fleet-wide: a served district that still carries an «n/m» plan number is a listing no
-- district option can reach.
create or replace function public.mon_detect_district_plan_number_stranded()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n bigint; v_by jsonb; v_seen bigint; n int := 0;
begin
  select count(*) into v_seen from public.search_listings_ar where production_ready and district_ar is not null;
  if v_seen = 0 then
    n := public.mon_raise('P2', 'district_plan_number_stranded', 'search_index', 'district_plan_number_stranded:BLIND',
      jsonb_build_object('blind', true, 'why', 'No served listing has a district, so this detector proves nothing.'));
    perform public.mon_resolve_stale_keys('district_plan_number_stranded', array['district_plan_number_stranded:BLIND']);
    return n;
  end if;
  select count(*), jsonb_object_agg(platform, c) into v_n, v_by
    from (select platform, count(*) c from public.search_listings_ar
           where production_ready and district_ar ~ '[0-9٠-٩]+\s*/\s*[0-9٠-٩]+' group by 1) x;
  if coalesce(v_n, 0) = 0 then
    perform public.mon_resolve_stale_keys('district_plan_number_stranded', array[]::text[]);
    return 0;
  end if;
  n := public.mon_raise('P2', 'district_plan_number_stranded', 'search_index', 'district_plan_number_stranded:stranded',
    jsonb_build_object('rows', v_n, 'by_platform', v_by,
      'why', 'A served district carries a subdivision plan number such as (1100/4). norm_district_tok() keeps it, '
          || 'so no district option reaches these listings: a customer who picks the district never sees them.',
      'action', 'Drop only the plan number from district_ar in the platform''s parser and repair the rows as '
          || '20261011 hajer did; neighborhood keeps the verbatim string for the card (owner rule 2026-09-14).'));
  perform public.mon_resolve_stale_keys('district_plan_number_stranded', array['district_plan_number_stranded:stranded']);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_district_plan_number_stranded' in src) > 0 then
    raise notice 'mon_detect_district_plan_number_stranded already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aldarim_saas_unfilled_block_false'',',
    E'    ''mon_detect_aldarim_saas_unfilled_block_false'',\n    ''mon_detect_district_plan_number_stranded'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;
