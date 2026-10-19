-- REVERT of 20260913200311 (fold), 20260913200718 (digit filter + constraint) and the
-- picker_number_leak detector, applied 2026-09-13 minutes earlier in the same session.
--
-- WHY: scripts/lib/districtCatalog.ts documents an evidence-backed invariant from the 2026-09-11
-- investigation — جازان's "المحمدية 1/2/3" and "الرحاب 1/2" are GENUINELY DIFFERENT officially
-- numbered neighbourhoods, asserted positively as EXPECTED_DISTINCT, with the explicit warning that
-- "it would be trivial, and wrong, to fix this by stripping every digit from every district name -
-- that silently merges genuinely different, officially-numbered places". Both changes did exactly
-- that: the fold merged المحمدية 1/2/3 onto a bare parent, and the digit filter then removed every
-- numbered live district from the picker entirely — so those real neighbourhoods became
-- unselectable. That barrier only runs in a scheduled live workflow, not npm test, so nothing
-- failed locally; it was caught by reading it.
--
-- The owner's rule ("our own list must never show a number") and this invariant ("these numbered
-- districts are real and must stay selectable") cannot both hold for جازان. That is an owner
-- decision, not one to settle inside a migration, so production is restored to the previously
-- verified behaviour until it is made.
CREATE OR REPLACE FUNCTION public.refresh_loc_display_district_canon()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare v_n bigint;
begin
  with src as (
    select s.city_id, norm_district_tok(s.district_ar) tok, s.district_ar label, count(*) n
      from public.search_listings_ar s
     where s.production_ready and s.district_ar is not null and s.city_id is not null
     group by 1,2,3),
  best as (
    select distinct on (city_id, tok) city_id, tok, label
      from src
     order by city_id, tok, n desc, (label like 'حي %') desc, length(label) desc, label
  ),
  merged as (
    select b.city_id, b.tok,
           coalesce(d.district_ar, b.label) as display_ar,
           (d.district_ar is not null)      as from_catalog
      from best b
      left join public.loc_catalog_district d
        on d.city_id = b.city_id and d.district_norm = b.tok
  )
  insert into public.loc_display_district_canon (city_id, district_norm, display_ar, from_catalog, refreshed_at)
  select city_id, tok, display_ar, from_catalog, now() from merged
  where norm_district_tok(display_ar) = tok
  on conflict (city_id, district_norm) do update
    set display_ar = excluded.display_ar,
        from_catalog = excluded.from_catalog,
        refreshed_at = excluded.refreshed_at;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

alter table public.loc_canonical_district
  drop constraint if exists loc_canonical_district_live_never_numbered;

CREATE OR REPLACE FUNCTION public.refresh_loc_canonical_district()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare n bigint; v_bogus_live int;
begin
  truncate public.loc_canonical_district;
  insert into public.loc_canonical_district (city_id, district_norm, canonical_district_ar, source, refreshed_at)
  with cat as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 0 as pref, 1::bigint cnt
    from public.loc_catalog_district
    where district_ar is not null and btrim(district_ar) <> ''
  ),
  liv as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 1 as pref, count(*)::bigint cnt
    from public.search_listings_ar
    where production_ready and district_ar is not null and btrim(district_ar) <> ''
      and district_ar not in ('غير محدد','اخرى','أخرى')
      and not public.district_ar_looks_bogus(district_ar)
    group by 1,2,3
  ),
  allrows as (select * from cat union all select * from liv),
  ranked as (
    select city_id, k, sp, pref,
      row_number() over (partition by city_id, k order by pref asc, cnt desc, length(sp) asc, sp asc) rn
    from allrows
    where k is not null and k <> ''
  )
  select city_id, k, sp, case when pref = 0 then 'catalog' else 'live' end, now()
  from ranked where rn = 1;
  get diagnostics n = row_count;

  select count(*) into v_bogus_live
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar);
  if v_bogus_live > 0 then
    raise exception 'refresh_loc_canonical_district: % bogus-shaped ''live'' row(s) survived the '
      'district_ar_looks_bogus() exclusion — the WHERE clause was weakened. Refusing to publish a '
      'catalog that re-leaks internal plan/parcel codes (see migration 20260911201716).', v_bogus_live;
  end if;

  return n;
end;
$function$;

-- The detector asserted the rule that is now under review; drop it and unroster it so it cannot
-- raise P1 noise for a contract the owner has not settled.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  if position('mon_detect_picker_number_leak' in src) > 0 then
    execute replace(src, ',
    ''mon_detect_picker_number_leak''
  ];', '
  ];');
  end if;
end $$;
drop function if exists public.mon_detect_picker_number_leak();

do $verify$
declare v_rostered boolean;
begin
  select position('mon_detect_picker_number_leak' in
                  pg_get_functiondef('public.mon_run_all_detectors'::regproc)) > 0 into v_rostered;
  if v_rostered then
    raise exception 'revert incomplete: picker_number_leak detector still rostered';
  end if;
end $verify$;