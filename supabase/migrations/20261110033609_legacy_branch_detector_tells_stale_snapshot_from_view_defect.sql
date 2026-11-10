-- legacy_branch_region_scope raised a P1 every night for an hour and closed itself: 18 alerts since 2026-10-18,
-- 9 reopens in the last 7 days (repeat_bug:legacy_branch_region_scope). None of them was the defect it names.
--
-- Measured over all 97 sampled rows of those 18 alerts: in 97 of 97 the city the snapshot held has a DIFFERENT NAME
-- from the city listings_arabic_locations holds now (خليص > رابغ, حريملاء > الرياض, الاحساء > الهفوف ...). The legacy
-- branch can only ever return a catalog city whose name equals the name it read, so a different name means one
-- thing: listing_native_location_v1 is an hourly snapshot (:16), and the row in listings_arabic_locations was
-- rewritten after the snapshot was taken (a new dealapp / muktamel ad gets its Arabic city a few minutes after it
-- arrives). The next refresh clears it. The real defect (run #33: the region-scoped lookup dropped, so a name that
-- exists in two regions is resolved to the wrong region) always keeps the SAME name. Standing state today: 19,080
-- legacy rows on dealapp + muktamel, 0 disagree.
--
-- So the detector now tells the two apart, with one predicate that is also executed against fixed cases on every
-- run. Nothing is silenced: a same-name wrong-region row still raises, a NULL city with an unchanged name still
-- raises, and a self-test that stops passing raises too.

create or replace function public.mon_legacy_branch_verdict(
  p_view_city_id integer, p_view_city_ar text, p_lal_city_ar text, p_lal_region_ar text)
returns text
language sql
stable
set search_path to 'public'
as $function$
  select case
           when k.n is distinct from 1 then 'not_judgeable'
           when p_view_city_id is not distinct from k.cid then 'ok'
           when normalize_ar(p_view_city_ar) is distinct from normalize_ar(p_lal_city_ar) then 'stale_snapshot'
           else 'view_defect'
         end
  from (
    select min(c2.city_id) as cid, count(distinct c2.city_id) as n
    from public.loc_catalog_city c2
    join public.loc_catalog_region rl on rl.region_id = c2.region_id
    where c2.city_norm = normalize_ar(p_lal_city_ar)
      and normalize_ar(rl.region_ar) = normalize_ar(p_lal_region_ar)) k
$function$;

comment on function public.mon_legacy_branch_verdict(integer, text, text, text) is
  'One row of listing_native_location_v1 (legacy branch) against listings_arabic_locations: ok | view_defect | '
  'stale_snapshot | not_judgeable. stale_snapshot = the snapshot read a different city NAME than the row holds now, '
  'so the row changed after the hourly refresh; view_defect = same name, wrong city (run #33).';

create or replace function public.mon_legacy_branch_verdict_selftest()
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare f record; got text; bad text := '';
begin
  -- A name that is exactly one city in region A and exactly one city in region B, plus a different single-city name in A.
  select a.city_id as a_id, a.city_ar as n_ar, ra.region_ar as a_region, b.city_id as b_id, m.city_id as m_id, m.city_ar as m_ar
    into f
  from public.loc_catalog_city a
  join public.loc_catalog_city b on b.city_norm = a.city_norm and b.region_id <> a.region_id
  join public.loc_catalog_region ra on ra.region_id = a.region_id
  join public.loc_catalog_city m on m.region_id = a.region_id and m.city_norm <> a.city_norm
  where a.city_norm = normalize_ar(a.city_ar) and m.city_norm = normalize_ar(m.city_ar)
    and (select count(*) from public.loc_catalog_city x where x.city_norm = a.city_norm and x.region_id = a.region_id) = 1
    and (select count(*) from public.loc_catalog_city x where x.city_norm = a.city_norm) = 2
    and (select count(*) from public.loc_catalog_city x where x.city_norm = m.city_norm) = 1
  order by a.city_id, m.city_id
  limit 1;
  if not found then return 'no_fixture: the catalog holds no city name that lives in exactly two regions'; end if;

  got := public.mon_legacy_branch_verdict(f.a_id, f.n_ar, f.n_ar, f.a_region);
  if got is distinct from 'ok' then bad := bad || format('right city read as %s; ', got); end if;
  got := public.mon_legacy_branch_verdict(f.b_id, f.n_ar, f.n_ar, f.a_region);
  if got is distinct from 'view_defect' then bad := bad || format('same name in the wrong region (run #33) read as %s; ', got); end if;
  got := public.mon_legacy_branch_verdict(null, f.n_ar, f.n_ar, f.a_region);
  if got is distinct from 'view_defect' then bad := bad || format('no city for an unchanged name read as %s; ', got); end if;
  got := public.mon_legacy_branch_verdict(f.m_id, f.m_ar, f.n_ar, f.a_region);
  if got is distinct from 'stale_snapshot' then bad := bad || format('row renamed after the snapshot read as %s; ', got); end if;
  got := public.mon_legacy_branch_verdict(f.a_id, f.n_ar, f.n_ar, 'منطقة لا وجود لها');
  if got is distinct from 'not_judgeable' then bad := bad || format('unknown region read as %s; ', got); end if;

  return case when bad = '' then 'ok' else bad end;
end
$function$;

create or replace function public.mon_detect_legacy_branch_region_scope()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; total int := 0; sample jsonb := '[]'::jsonb; selftest text;
begin
  selftest := public.mon_legacy_branch_verdict_selftest();

  -- Candidates first, set-based (the pre-2026-11-10 predicate, ~2 s over 106,000 legacy rows): the legacy city is not
  -- the single in-region city. The verdict function then judges only those few rows, so it is the one place the
  -- decision is made and the sweep costs what it did before.
  with cand as materialized (
    select v.platform, v.source_table, v.listing_id, v.city_id, v.city_ar as view_city_ar,
           l.city_ar, l.region_ar, k.cid
    from public.listing_native_location_v1 v
    join public.listings_arabic_locations l
      on l.platform = v.platform and l.listing_id = v.listing_id
    join public.loc_catalog_region rl
      on normalize_ar(rl.region_ar) = normalize_ar(l.region_ar)
    cross join lateral (
      select min(c2.city_id) as cid, count(distinct c2.city_id) as n
      from public.loc_catalog_city c2
      where c2.city_norm = normalize_ar(l.city_ar) and c2.region_id = rl.region_id) k
    where v.source_method = 'legacy_derived'
      and l.matched and l.city_ar is not null and l.region_ar is not null
      and k.n = 1
      and v.city_id is distinct from k.cid
  )
  select count(*), coalesce(jsonb_agg(x order by x->>'listing_id'), '[]'::jsonb)
    into total, sample
  from (
    select jsonb_build_object(
             'platform', c.platform, 'source_table', c.source_table, 'listing_id', c.listing_id,
             'city_ar', c.city_ar, 'published_region', c.region_ar,
             'resolved_city_id', c.city_id, 'expected_city_id', c.cid) as x
    from cand c
    where public.mon_legacy_branch_verdict(c.city_id, c.view_city_ar, c.city_ar, c.region_ar) = 'view_defect'
    limit 25
  ) s;

  if total > 0 or selftest <> 'ok' then
    n := public.mon_raise('P1', 'legacy_branch_region_scope', 'all', 'legacy_branch_region_scope',
      jsonb_build_object(
        'count', total,
        'sample', sample,
        'selftest', selftest,
        'why', 'listing_native_location_v1''s legacy branch returned a city OTHER than the single '
               'catalog city that exists inside the region listings_arabic_locations already matched, '
               'for a city NAME the snapshot and the row agree on. That is the run #33 defect returning: '
               'the region-scoped lateral (lsc) has been dropped, reordered behind the unscoped fallback '
               '(lgc), or the COALESCE precedence was inverted. (selftest other than ok = the verdict '
               'function itself stopped telling the cases apart.)',
        'do_not', 'Do NOT repair rows to make this green, and do NOT relax count(distinct city_id)=1. '
                  'The defect is in the view; the rows are its output. A name ambiguous even inside its '
                  'own published region must keep falling through to the deterministic fallback.'));
  else
    perform public.mon_resolve_key('legacy_branch_region_scope', 'legacy_branch_region_scope');
  end if;

  return n;
end
$function$;

do $$
declare st text := public.mon_legacy_branch_verdict_selftest();
begin
  if st <> 'ok' then raise exception 'mon_legacy_branch_verdict self-test failed: %', st; end if;
end $$;
