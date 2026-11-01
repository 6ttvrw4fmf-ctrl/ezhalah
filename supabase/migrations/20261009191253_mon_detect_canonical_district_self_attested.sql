-- 🔧 QA 2026-10-09: canonical_district_self_attested — barrier for 20261009172709.
-- A 'live' canonical district name whose ONLY served attestation is districts we recovered by RENAMING the ad's text is our own
-- output vouching for itself (the loop that kept 559 المبرز-name rows on 10-08). Measured before the
-- fix: 5 names / 17 listings. 358 ms.
create or replace function public.mon_detect_canonical_district_self_attested()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; v_bad int; v_ex jsonb;
begin
  select count(*), coalesce(jsonb_agg(jsonb_build_object('city_id', q.city_id, 'district', q.canonical_district_ar)) filter (where q.rn <= 10), '[]'::jsonb)
    into v_bad, v_ex
  from (
    select c.city_id, c.canonical_district_ar, row_number() over (order by c.city_id) rn
    from public.loc_canonical_district c
    where c.source = 'live'
      and exists (select 1 from public.search_listings_ar s
                  where s.city_id = c.city_id and s.district_norm_tok = c.district_norm and s.production_ready)
      and not exists (select 1 from public.search_listings_ar s
                      where s.city_id = c.city_id and s.district_norm_tok = c.district_norm and s.production_ready
                        and not exists (select 1 from public.district_recovery dr
                                        where dr.source_table = s.source_table and dr.listing_id = s.listing_id
                                          and dr.verbatim is false))
  ) q;

  if v_bad > 0 then
    live := live || 'canonical_district_self_attested:fleet'::text;
    n := n + public.mon_raise('P2', 'canonical_district_self_attested', 'fleet', 'canonical_district_self_attested:fleet',
      jsonb_build_object('names', v_bad, 'examples', v_ex,
        'why', 'A canonical district name is attested only by districts we recovered by renaming the ad''s text: our own output vouches for itself and can never fall out.',
        'action', 'refresh_loc_canonical_district() must exclude district_recovery rows with verbatim = false from its live attestation (20261009172709).'));
  end if;
  perform public.mon_resolve_stale_keys('canonical_district_self_attested', live);
  return n;
end
$function$;
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_canonical_district_self_attested' in src) > 0 then
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_index_first_seen_unstamped'',',
    E'    ''mon_detect_index_first_seen_unstamped'',\n    ''mon_detect_canonical_district_self_attested'',');
  if out_def = src then
    raise exception 'roster anchor not found';
  end if;
  execute out_def;
end $$;