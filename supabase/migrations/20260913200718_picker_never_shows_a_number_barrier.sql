-- Owner rule 2026-09-13, absolute: our OWN district picker must never show a number. A number the
-- source published still shows on the property CARD (neighborhood = their text, untouched) — but
-- never in our list. "Cities and districts, that's extremely important. Never, ever."
--
-- Barrier 1 of 4 (filter): live-sourced district values containing any digit (ASCII or Arabic-Indic)
-- are excluded from the picker catalog outright. Legitimate numbered districts reach the picker
-- through the 'catalog' branch instead — those ARE our own official list (e.g. الليث's "حي رقم 1"
-- .."حي رقم 10", where the number IS the name), which the owner explicitly chose to keep.
-- Numbered live values that are merely a variant of a real district are already folded onto their
-- parent upstream by refresh_loc_display_district_canon(), so they arrive here clean and keep their
-- listings reachable; anything still numbered here is unmatched scraped text, which belongs on the
-- card only.
--
-- Barrier 2 of 4 (self-check): the refresh refuses to publish a catalog that contains even one
-- numbered live row — the whole refresh fails loudly rather than silently leaking a number.
CREATE OR REPLACE FUNCTION public.refresh_loc_canonical_district()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare n bigint; v_bogus_live int; v_numbered_live int;
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
      and district_ar !~ '[0-9٠-٩]'
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

  -- SELF-CHECK (see header): can only fire if a future edit weakens the WHERE clause above while
  -- district_ar_looks_bogus() itself stays intact. Fails the WHOLE refresh loudly rather than
  -- silently reintroducing internal codes into the dropdown.
  select count(*) into v_bogus_live
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar);
  if v_bogus_live > 0 then
    raise exception 'refresh_loc_canonical_district: % bogus-shaped ''live'' row(s) survived the '
      'district_ar_looks_bogus() exclusion — the WHERE clause was weakened. Refusing to publish a '
      'catalog that re-leaks internal plan/parcel codes (see migration 20260911201716).', v_bogus_live;
  end if;

  -- SELF-CHECK for the owner's no-number rule: same fail-closed shape. A numbered live row here
  -- means the digit filter above was weakened or removed.
  select count(*) into v_numbered_live
    from public.loc_canonical_district
   where source = 'live' and canonical_district_ar ~ '[0-9٠-٩]';
  if v_numbered_live > 0 then
    raise exception 'refresh_loc_canonical_district: % numbered ''live'' row(s) reached the district '
      'picker. Our own city/district lists must NEVER show a number (owner rule 2026-09-13); a '
      'source-published number belongs on the property card only. Refusing to publish.', v_numbered_live;
  end if;

  return n;
end;
$function$;

-- Republish the picker through the new filter BEFORE the structural barrier is attached, so the
-- constraint is validated against already-clean data.
select public.refresh_loc_canonical_district();

-- Barrier 3 of 4 (structural): even if both the filter and the self-check were removed, the table
-- itself refuses to store a numbered live row. This can only be bypassed by explicitly dropping a
-- named constraint, which is a deliberate act, not an accident.
alter table public.loc_canonical_district
  drop constraint if exists loc_canonical_district_live_never_numbered;
alter table public.loc_canonical_district
  add constraint loc_canonical_district_live_never_numbered
  check (source <> 'live' or canonical_district_ar !~ '[0-9٠-٩]');

do $verify$
declare v_leak int;
begin
  select count(*) into v_leak from public.loc_canonical_district
   where source = 'live' and canonical_district_ar ~ '[0-9٠-٩]';
  if v_leak > 0 then
    raise exception 'no-number barrier failed its own verification: % numbered live row(s)', v_leak;
  end if;
end $verify$;