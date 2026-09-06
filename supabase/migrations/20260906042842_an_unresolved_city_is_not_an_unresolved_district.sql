-- An UNRESOLVED CITY is not an UNRESOLVED DISTRICT — incident #53.
--
-- What was live. Four aqarmonthly rows (762041, 762272, 762483, 1097370) carried the city name
-- still glued onto district_ar — «حي الامير نايف المجمعة» — and the P2 alert
-- aqarmonthly_district_city_suffix had been open since 2026-08-23 with detail {"sample": null,
-- "failures":[{"kind":"index_rows_recorrupted","rows":3}]}: an alert firing for 13 days with no
-- example of what was wrong, because the sample was drawn from a limb that reported zero.
--
-- Root cause, in the PARSER. resolve_slug() answered two different questions with one variable.
-- «المجمعة» is a same-name catalog twin (city_ids 24/1343/1494/1761 across regions 1/2/6/6) and
-- «القرى» likewise (474/1173/1400/1465 across 3/2/12/12), so the city PICK correctly failed —
-- and because it failed, strip_city_suffix() was never called at all. WHICH city this is is
-- genuinely unknowable; WHETHER the trailing tokens spell a city NAME is answered by the catalog
-- regardless. The parser fix (scrapers/common/arabic_location.py) keeps the city NULL — no guess —
-- and un-glues the district from the same rightmost catalog match, pinned by
-- scrapers/common/tests/test_aqarmonthly_resolve_slug_district_suffix.py.
--
-- Why the repair below is SOURCE, not inference. aqarmonthly publishes a comma-delimited `address`
-- alongside the delimiter-less slug, and it separates exactly what the slug runs together:
--   762041  «شارع بديل ابن ورقاء ابن عبدالعزى ، حي الامير نايف ، المجمعة ، المجمعة»
--   762272  «طريق الامير سلطان ، حي الملك عبدالعزيز ، المجمعة ، المجمعة»
--   762483  «شارع ابن المطوق ، حي المجد ، القرى ، القري»
--   1097370 «شارع الجزائر ، حي الاندلس ، المجمعة ، المجمعة»
-- The rule below reproduces those four district segments exactly. It only ever REMOVES tokens the
-- source glued on: no city is filled in, no district renamed, nothing invented.
--
-- And the DETECTOR was blind to the very cohort its own intent covers. Both limbs required
-- `city_ar is not null`, so a raw row whose city is an unresolvable twin could carry a glued
-- district and be counted by neither. Row 762483 proves it: city NULL in raw AND in the index, so
-- it was invisible on both sides while the alert stood open for the other three. Dropping the
-- predicate alone is a no-op — strip_district_city_suffix(d, NULL) returns d by design — so the
-- null-city limb needs the catalog name the district's own tail spells, which is what
-- district_trailing_catalog_city_norm() below answers.

-- ── 1. the missing half of the question: are these trailing tokens a city NAME at all? ───────────
create or replace function public.district_trailing_catalog_city_norm(p_district_ar text)
returns text language sql stable as $fn$
  -- The catalog city_norm that the district's TRAILING 1-3 tokens spell (longest window wins),
  -- else NULL. Deliberately id-free: it answers "is this a city name", never "which city is this",
  -- so it can be right about a same-name twin that _pick_candidate() must refuse to resolve.
  -- Mirrors the rightmost-then-longest match in resolve_slug()'s _scan()
  -- (scrapers/common/arabic_location.py); parity pinned by
  -- scripts/verify-aqarmonthly-district-suffix-guard.ts.
  with t as (select regexp_split_to_array(btrim(coalesce(p_district_ar, '')), '\s+') as a)
  select w.k
    from t,
         lateral (
           select 3 as sz,
                  public.normalize_ar(a[array_length(a,1)-2]) || ' ' ||
                  public.normalize_ar(a[array_length(a,1)-1]) || ' ' ||
                  public.normalize_ar(a[array_length(a,1)]) as k
             where array_length(a,1) >= 3
           union all
           select 2, public.normalize_ar(a[array_length(a,1)-1]) || ' ' ||
                     public.normalize_ar(a[array_length(a,1)])
             where array_length(a,1) >= 2
           union all
           select 1, public.normalize_ar(a[array_length(a,1)])
             where array_length(a,1) >= 1
         ) w
   where exists (select 1 from public.loc_catalog_city c where c.city_norm = w.k)
   order by w.sz desc
   limit 1;
$fn$;

comment on function public.district_trailing_catalog_city_norm(text) is
  'Catalog city_norm spelled by a district''s trailing 1-3 tokens, else NULL. The id-free half of '
  'the location question: WHETHER these tokens are a city name, never WHICH city. Lets the '
  'district←city suffix rule reach rows whose city is an unresolvable same-name twin (incident #53).';

-- ── 2. the bounded repair — the same rule, over the cohort the old limbs could not see ───────────
do $mig$
declare n_raw int; n_idx int;
begin
  update aqarmonthly_residential_listings r
     set district_ar = public.strip_district_city_suffix(
                         r.district_ar, public.district_trailing_catalog_city_norm(r.district_ar))
   where r.district_ar is not null and r.city_ar is null
     and r.district_ar <> public.strip_district_city_suffix(
                            r.district_ar, public.district_trailing_catalog_city_norm(r.district_ar));
  get diagnostics n_raw = row_count;

  update search_listings_ar s
     set district_ar = public.strip_district_city_suffix(
                         s.district_ar, public.district_trailing_catalog_city_norm(s.district_ar))
   where s.platform = 'aqarmonthly' and s.district_ar is not null and s.city_ar is null
     and s.district_ar <> public.strip_district_city_suffix(
                            s.district_ar, public.district_trailing_catalog_city_norm(s.district_ar));
  get diagnostics n_idx = row_count;

  -- Fail closed. The cohort was measured at exactly 4 raw + 1 index row before this ran, each one
  -- checked against the source's own `address`. A run that suddenly touches many more is not a
  -- bigger cleanup, it is a rule behaving differently than the one that was verified — roll back
  -- and let a person look rather than rewrite districts in bulk on an unproven predicate.
  if n_raw > 25 or n_idx > 25 then
    raise exception 'district un-glue repair touched %/% rows (raw/index); expected 4/1. Rolled back.',
      n_raw, n_idx;
  end if;
  raise notice 'unresolved-city districts un-glued — source rows: %, index rows: %', n_raw, n_idx;

  -- 2b. …and re-run the ALREADY-canonical city-known rule, unchanged, over both sides. The index
  -- copies of 762041/762272/1097370 resolve a city the raw rows could not, so they are the three
  -- "index_rows_recorrupted" the alert has been counting since 2026-08-23; the raw fix above only
  -- reaches them on the next sync. loc_display_district_ar(24, «حي الامير نايف») is the identity
  -- here, so this writes exactly what that sync would.
  update aqarmonthly_residential_listings r
     set district_ar = public.strip_district_city_suffix(r.district_ar, r.city_ar)
   where r.district_ar is not null and r.city_ar is not null
     and r.district_ar <> public.strip_district_city_suffix(r.district_ar, r.city_ar);
  get diagnostics n_raw = row_count;

  update search_listings_ar s
     set district_ar = public.strip_district_city_suffix(s.district_ar, s.city_ar)
   where s.platform = 'aqarmonthly' and s.district_ar is not null and s.city_ar is not null
     and s.district_ar <> public.strip_district_city_suffix(s.district_ar, s.city_ar);
  get diagnostics n_idx = row_count;
  raise notice 'city-known rule re-run — source rows: %, index rows: %', n_raw, n_idx;
end $mig$;

-- ── 3. the detector learns to see the cohort, and to always carry an example ─────────────────────
create or replace function public.mon_detect_aqarmonthly_district_city_suffix()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_raw bigint; v_idx bigint; v_raw_nc bigint; v_idx_nc bigint;
  n int := 0; bad jsonb := '[]'::jsonb; sample jsonb;
begin
  -- A row is dirty iff the canonical rule would still change it. That makes this detector both the
  -- re-corruption alarm AND the idempotence proof: if the backfill were not a fixed point, it would
  -- report a non-zero count the moment it finished.
  --
  -- FOUR limbs, not two (incident #53). A row whose city is an unresolvable same-name twin stores
  -- city_ar NULL, so the two city-known limbs skipped exactly the cohort that produced the glued
  -- districts in the first place — and strip_district_city_suffix(d, NULL) returns d, so simply
  -- relaxing the predicate would have kept them invisible. The null-city limbs ask the catalog what
  -- the district's own trailing tokens spell instead.
  select count(*) into v_raw from aqarmonthly_residential_listings
   where district_ar is not null and city_ar is not null
     and district_ar <> public.strip_district_city_suffix(district_ar, city_ar);

  select count(*) into v_idx from search_listings_ar
   where platform = 'aqarmonthly' and district_ar is not null and city_ar is not null
     and district_ar <> public.strip_district_city_suffix(district_ar, city_ar);

  select count(*) into v_raw_nc from aqarmonthly_residential_listings
   where district_ar is not null and city_ar is null
     and district_ar <> public.strip_district_city_suffix(
                          district_ar, public.district_trailing_catalog_city_norm(district_ar));

  select count(*) into v_idx_nc from search_listings_ar
   where platform = 'aqarmonthly' and district_ar is not null and city_ar is null
     and district_ar <> public.strip_district_city_suffix(
                          district_ar, public.district_trailing_catalog_city_norm(district_ar));

  if v_raw    > 0 then bad := bad || jsonb_build_object('kind','source_rows_recorrupted','rows',v_raw); end if;
  if v_idx    > 0 then bad := bad || jsonb_build_object('kind','index_rows_recorrupted','rows',v_idx); end if;
  if v_raw_nc > 0 then bad := bad || jsonb_build_object('kind','source_rows_recorrupted_city_unresolved','rows',v_raw_nc); end if;
  if v_idx_nc > 0 then bad := bad || jsonb_build_object('kind','index_rows_recorrupted_city_unresolved','rows',v_idx_nc); end if;

  if jsonb_array_length(bad) > 0 then
    -- The sample must come from EVERY limb. It used to be selected from the source-with-city limb
    -- only, so the 2026-08-23 alert stood open for 13 days reading "sample": null while three index
    -- rows were dirty — an alert with a count and no example is a page nobody can act on.
    -- Each branch is parenthesised so its own LIMIT 5 applies to that branch, not to the union.
    select jsonb_agg(s) into sample from (
      (select jsonb_build_object('where','source','district',district_ar,'city',city_ar,
                'would_become', public.strip_district_city_suffix(district_ar, city_ar)) as s
         from aqarmonthly_residential_listings
        where district_ar is not null and city_ar is not null
          and district_ar <> public.strip_district_city_suffix(district_ar, city_ar)
        limit 5)
      union all
      (select jsonb_build_object('where','index','district',district_ar,'city',city_ar,
                'would_become', public.strip_district_city_suffix(district_ar, city_ar))
         from search_listings_ar
        where platform = 'aqarmonthly' and district_ar is not null and city_ar is not null
          and district_ar <> public.strip_district_city_suffix(district_ar, city_ar)
        limit 5)
      union all
      (select jsonb_build_object('where','source_city_unresolved','district',district_ar,'city',null,
                'would_become', public.strip_district_city_suffix(
                                  district_ar, public.district_trailing_catalog_city_norm(district_ar)))
         from aqarmonthly_residential_listings
        where district_ar is not null and city_ar is null
          and district_ar <> public.strip_district_city_suffix(
                               district_ar, public.district_trailing_catalog_city_norm(district_ar))
        limit 5)
      union all
      (select jsonb_build_object('where','index_city_unresolved','district',district_ar,'city',null,
                'would_become', public.strip_district_city_suffix(
                                  district_ar, public.district_trailing_catalog_city_norm(district_ar)))
         from search_listings_ar
        where platform = 'aqarmonthly' and district_ar is not null and city_ar is null
          and district_ar <> public.strip_district_city_suffix(
                               district_ar, public.district_trailing_catalog_city_norm(district_ar))
        limit 5)
    ) all_limbs;

    n := public.mon_raise('P2','aqarmonthly_district_city_suffix','aqarmonthly',
      'aqarmonthly_district_city_suffix',
      jsonb_build_object('failures', bad, 'sample', sample,
        'why','aqarmonthly''s slug glues the city name onto the district with no delimiter. The '
           || 'parser guard strip_city_suffix() in scrapers/common/arabic_location.py is supposed to '
           || 'remove it at ingestion — including when the city itself is an unresolvable same-name '
           || 'twin, where the city stays NULL but the district is still un-glued. Rows dirty again '
           || 'means that guard regressed or a new slug shape slipped past it — fix the PARSER, then '
           || 're-run the canonical rule. Never edit the district text by hand.'));
  else
    perform public.mon_resolve_key('aqarmonthly_district_city_suffix','aqarmonthly_district_city_suffix');
  end if;
  return n;
end $$;