-- Senior run #32b. Barrier for the city identity/label contract, after repairing 13 searchable
-- listings that carried a valid city_id and no city_ar (card showed no city while the listing was
-- still reachable by that city's filter).
--
-- FOUR ARMS. Each was measured on live production before wiring, and each reads 0:
--   (a) searchable row has a city identity but no label            -> the defect just fixed (was 13)
--   (b) row has a label that resolves UNIQUELY to one canonical city, yet carries no city_id --
--       the information to identify it is already in the database and is being thrown away
--       (the run #26/#30 class). Today: of the 71 label-without-identity rows, 65 resolve to no
--       catalog city and 6 are ambiguous, so 0 are recoverable and NONE is production_ready.
--   (c) searchable row whose label resolves to canonical cities that do NOT include its own city_id
--       -- a genuine mis-assignment: the card names one city, the filter files it under another
--   (d) searchable row whose city_id belongs to a different region than the row's region_id
--
-- WHY ARM (c) IS IDENTITY-BASED, NOT STRING EQUALITY. The naive predicate "city_ar must equal
-- loc_catalog_city.city_ar for city_id" reads 4,190 rows -- and every sample is a CORRECT
-- assignment wearing the platform's own wording: «الدمام و سيهات»->الدمام (777), «الاحساء و الهفوف»
-- ->الهفوف (322), «مدينه الجبيل الصناعيه»->الجبيل, «محافظة المذنب»->المذنب, «محائل»->محايل,
-- «أبوعريش»->ابو عريش. After normalize_ar and the alias table, 1,167 remain -- all of them labels
-- that resolve to NO catalog city at all, i.e. source variants and compounds, not mis-assignments.
-- Firing on those would be a permanent false alarm, and "fixing" them by overwriting the source's
-- own label with the catalog's would destroy source fidelity for 1,167 listings to satisfy a
-- barrier. So (c) fires only when the label positively resolves SOMEWHERE ELSE: 0 rows today, out of
-- 194,500 whose label agrees. It never infers a city where no valid identity exists.

create or replace function public.mon_detect_city_identity_contract()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; a_missing_label bigint; b_recoverable bigint; c_mismatch bigint; d_region bigint;
        v_sample jsonb;
begin
  -- (a) identity without a label, on a searchable row
  select count(*) into a_missing_label
    from public.search_listings_ar s
   where s.production_ready and s.city_id is not null and s.city_ar is null;

  -- (b) label without identity, where the label unambiguously names exactly one canonical city
  select count(*) into b_recoverable
    from public.search_listings_ar s
   where s.city_ar is not null and s.city_id is null
     and 1 = (select count(distinct x.city_id) from (
                select c2.city_id from public.loc_catalog_city c2 where c2.city_norm = normalize_ar(s.city_ar)
                union
                select a2.city_id from public.loc_catalog_city_alias a2 where a2.alias_norm = normalize_ar(s.city_ar)) x);

  -- (c) label positively names a DIFFERENT canonical city than the row's own identity
  select count(*) into c_mismatch
    from public.search_listings_ar s
   where s.production_ready and s.city_ar is not null and s.city_id is not null
     and exists (select 1 from (
                select c2.city_id from public.loc_catalog_city c2 where c2.city_norm = normalize_ar(s.city_ar)
                union
                select a2.city_id from public.loc_catalog_city_alias a2 where a2.alias_norm = normalize_ar(s.city_ar)) x)
     and not exists (select 1 from (
                select c2.city_id from public.loc_catalog_city c2 where c2.city_norm = normalize_ar(s.city_ar)
                union
                select a2.city_id from public.loc_catalog_city_alias a2 where a2.alias_norm = normalize_ar(s.city_ar)) y
                where y.city_id = s.city_id);

  -- (d) the row's region disagrees with the region its own city belongs to
  select count(*) into d_region
    from public.search_listings_ar s join public.loc_catalog_city c on c.city_id = s.city_id
   where s.production_ready and c.region_id is distinct from s.region_id;

  if a_missing_label = 0 and b_recoverable = 0 and c_mismatch = 0 and d_region = 0 then
    perform public.mon_resolve_key('city_identity_contract','city_identity_contract');
    return 0;
  end if;

  select jsonb_agg(t) into v_sample from (
    select s.source_table, s.listing_id, s.platform, s.city_id, s.city_ar, s.region_id
      from public.search_listings_ar s
     where (s.production_ready and s.city_id is not null and s.city_ar is null)
        or (s.city_ar is not null and s.city_id is null
            and 1 = (select count(distinct x.city_id) from (
                     select c2.city_id from public.loc_catalog_city c2 where c2.city_norm = normalize_ar(s.city_ar)
                     union
                     select a2.city_id from public.loc_catalog_city_alias a2 where a2.alias_norm = normalize_ar(s.city_ar)) x))
     limit 5) t;

  n := public.mon_raise('P1','city_identity_contract','all','city_identity_contract',
    jsonb_build_object(
      'identity_without_label', a_missing_label,
      'recoverable_label_without_identity', b_recoverable,
      'label_names_a_different_city', c_mismatch,
      'city_region_disagreement', d_region,
      'sample', v_sample,
      'why','A searchable listing''s city identity (city_id, what every Filter, count and Trending '
         || 'surface uses) and its city label (what the card shows) must agree, and neither may exist '
         || 'without the other when the database can supply it.',
      'adjudicate','Resolve the LABEL from loc_catalog_city by the row''s own city_id -- never infer a '
         || 'city from text, and never assign one where no valid identity exists. A label that simply '
         || 'does not match the catalog string is NOT this alert: source variants like «الدمام و سيهات» '
         || 'or «محافظة المذنب» are correct assignments in the platform''s own wording and must be left '
         || 'alone. Arm (c) fires only when the label positively names a different canonical city.'));
  return n;
end $function$;

comment on function public.mon_detect_city_identity_contract() is
  'P1. Four arms: identity-without-label, recoverable-label-without-identity, label-names-a-different-city, '
  'city/region disagreement. Identity-based, not string equality, so source label variants stay quiet. Senior run #32b.';

do $$
declare v_def text; v_new text; v_anchor text; n_anchor int; n_before int; n_after int;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='mon_run_all_detectors';
  if position('mon_detect_city_identity_contract' in v_def) > 0 then raise notice 'already wired'; return; end if;

  v_anchor := '    ''mon_detect_fabricated_unpublished_amenity'',
';
  n_anchor := (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  if n_anchor <> 1 then raise exception 'REFUSED: roster anchor not found exactly once (found %)', n_anchor; end if;

  n_before := (length(v_def)-length(replace(v_def,'''mon_detect_','')))/length('''mon_detect_');
  v_new := replace(v_def, v_anchor, v_anchor || '    ''mon_detect_city_identity_contract'',
');
  n_after := (length(v_new)-length(replace(v_new,'''mon_detect_','')))/length('''mon_detect_');
  if n_after <> n_before + 1 then raise exception 'REFUSED: roster count moved % -> % (expected +1)', n_before, n_after; end if;
  execute v_new;
end $$;
