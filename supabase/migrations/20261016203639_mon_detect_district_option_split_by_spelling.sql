-- 🦅 Falcon, 2026-10-16: the robot for 20261016203502 — one district must never be offered as two options.
--
-- 20261016203502 made district_options_ar fold spellings that differ only by a space, a hamza form, ى/ي or ة/ه,
-- merging ten split districts (الرياض «حي الملك عبدالعزيز» 158 + «حي الملك عبد العزيز» 14, …). Nothing watched that:
-- a template rebuild from an older text, a revert, or a new spelling arriving from a crawl would split a district
-- again and every count check would stay green (each half's count equals its own results). This detector asks the
-- REAL district_options_ar, for every city whose catalog holds two spellings of one name, whether two OPTIONS fold
-- to one district, twice an hour; it raises P2 with the pairs and clears when the list is whole. Rostered in the
-- same change (an unrostered detector is decoration).

create or replace function public.mon_district_option_split_rows()
 returns table(city_id integer, district_key text, options text[], counts integer[])
 language sql
 stable
 set search_path to 'public'
as $function$
  with k as (
    select c.city_id, regexp_replace(regexp_replace(translate(c.district_norm, 'أإآٱىة', 'اااايه'), '\s+', '', 'g'), 'ء$', '') key,
           c.district_norm
    from public.loc_canonical_district c
  ), cities as (
    select k.city_id from k group by k.city_id, k.key having count(distinct k.district_norm) > 1
  ), opts as (
    select ci.city_id, o.district_ar, o.listing_count,
           regexp_replace(regexp_replace(translate(public.norm_district_tok(o.district_ar), 'أإآٱىة', 'اااايه'), '\s+', '', 'g'), 'ء$', '') key
    from (select distinct city_id from cities) ci, public.district_options_ar(ci.city_id) o
  )
  select o.city_id, o.key, array_agg(o.district_ar order by o.district_ar), array_agg(o.listing_count order by o.district_ar)
  from opts o group by o.city_id, o.key having count(*) > 1;
$function$;

create or replace function public.mon_detect_district_option_split_by_spelling()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n int := 0; sample jsonb;
begin
  select count(*), jsonb_agg(jsonb_build_object('city_id', s.city_id, 'options', s.options, 'counts', s.counts))
    into v_n, sample
    from (select * from public.mon_district_option_split_rows() limit 10) s;
  if v_n > 0 then
    perform public.mon_raise('P2', 'district_option_split_by_spelling', 'search', 'district_option_split_by_spelling',
      jsonb_build_object('count', v_n, 'sample', sample,
        'why', 'The district list offers one district as two options that differ only by a space, a hamza form, ى/ي or '
            || 'ة/ه. Each option counts and returns only its own spelling, so a customer who picks one silently misses '
            || 'the other half (2026-10-16: الرياض «حي الملك عبدالعزيز» 158 + «حي الملك عبد العزيز» 14).',
        'fix', 'district_options_ar groups by `fold`; it must be the space/hamza fold of 20261016203502 in BOTH the live '
            || 'body and af_rpc_templates. If both still carry it, a new spelling class reached the catalog: widen the fold '
            || 'in both with one needle migration, never by renaming listings.'));
  else
    perform public.mon_resolve_key('district_option_split_by_spelling', 'district_option_split_by_spelling');
  end if;
  return v_n;
end
$function$;

do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_district_option_split_by_spelling''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_district_option_split_by_spelling'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_district_option_split_by_spelling''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF at apply, both directions. The reverted fold lives in a sub-transaction that is always rolled back.
do $proof$
declare r int; d text;
begin
  r := (select count(*) from public.mon_district_option_split_rows());
  if r <> 0 then raise exception 'PROOF: the district list still splits % district(s) after 20261016203502', r; end if;
  begin
    d := pg_get_functiondef('public.district_options_ar'::regproc);
    execute replace(d, $n$regexp_replace(regexp_replace(translate(c.district_norm, 'أإآٱىة', 'اااايه'), '\s+', '', 'g'), 'ء$', '') AS fold$n$,
                       $n$regexp_replace(c.district_norm, 'ء$', '') AS fold$n$);
    r := (select count(*) from public.mon_district_option_split_rows());
    if r < 10 then raise exception 'PROOF: with the old fold restored the detector saw only % split(s), want 10', r; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  r := (select count(*) from public.mon_district_option_split_rows());
  if r <> 0 then raise exception 'PROOF: the revert survived the rollback'; end if;
  r := (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_district_option_split_by_spelling');
  if r <> 0 then raise exception 'PROOF: the new detector reads as orphaned'; end if;
  raise notice 'PROOF OK: whole list → 0; old fold restored → caught; rostered, not orphaned';
end
$proof$;
