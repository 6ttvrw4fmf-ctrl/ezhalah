-- The results RPC packs af_canon for the PAGE, not for every matched row (af-live-truth-check red, alert 11763).
--
-- Measured 2026-11-04 on production: location_search_candidates_ar(p_deal=>'بيع', p_street_width_min=>20, p_limit=>24)
-- took 22 s (72,628 matches) — past anon's 20 s statement_timeout, so the user got an error instead of results,
-- and verify-strict-filter-parity-live.ts died with 57014. The same RPC with a non-AF filter over 159,328 matches
-- took 1.5 s. Cause: the `matched` CTE built the ~180-key af_canon jsonb for EVERY matched row whenever any
-- Advanced-Filter answer was set, and that wide value rode through the count(*) over() / row_number() sorts
-- before the LIMIT threw all but one page away. The template comment's own premise («an AF-narrowed search pays
-- it on a set the answer has already shrunk») is false for a nationwide street-width / amenity search.
--
-- Fix (template + rebuild, never a hand edit): `matched` carries null::jsonb as af_canon, and the outer SELECT
-- packs the SAME expression (same gate, same keys, same order) from search_listings_ar by primary key for the
-- returned rows only. Output is unchanged: proven on four searches (AF, AF+per-platform+price sort, no-AF with
-- offset, amenities+per-platform) — row-for-row jsonb equal, old vs new — and the 22 s search answered in 0.8 s.
do $$
declare
  tpl text; expr text; new_tpl text; occ int; fdef text; parity int;
  final_old constant text := E'u.bedrooms, u.af_canon\n  from (';
  probe_old text; probe_new text;
begin
  select template into tpl from public.af_rpc_templates where fn_name = 'location_search_candidates_ar' for update;
  if tpl is null then raise exception 'ABORT: af_rpc_templates has no location_search_candidates_ar row'; end if;
  if position('listing_id = u.listing_id) as af_canon' in tpl) > 0 then
    raise exception 'ABORT: template already packs af_canon after the limit — nothing to do, refusing to double-apply';
  end if;

  expr := substring(tpl from '\n\s*(case when \(p_bath_min is not null[^\n]*end) as af_canon');
  if expr is null then raise exception 'ABORT: af_canon expression anchor not found in the template'; end if;
  occ := (length(tpl) - length(replace(tpl, expr || ' as af_canon', ''))) / length(expr || ' as af_canon');
  if occ <> 1 then raise exception 'ABORT: af_canon expression occurs % times', occ; end if;
  occ := (length(tpl) - length(replace(tpl, final_old, ''))) / length(final_old);
  if occ <> 1 then raise exception 'ABORT: outer-select anchor occurs % times', occ; end if;
  if expr <> substring(pg_get_functiondef('public.location_search_candidates_ar'::regproc)
                       from '\n\s*(case when \(p_bath_min is not null[^\n]*end) as af_canon') then
    raise exception 'ABORT: the live function and the template disagree on the af_canon expression';
  end if;

  new_tpl := replace(tpl, expr || ' as af_canon', 'null::jsonb as af_canon');
  new_tpl := replace(new_tpl, final_old,
    'u.bedrooms, (select ' || expr || E' from public.search_listings_ar s where s.source_table = u.source_table and s.listing_id = u.listing_id) as af_canon\n  from (');
  update public.af_rpc_templates set template = new_tpl where fn_name = 'location_search_candidates_ar';

  perform * from public.rebuild_af_filter_rpcs();

  fdef := pg_get_functiondef('public.location_search_candidates_ar'::regproc);
  if position('null::jsonb as af_canon' in fdef) = 0
     or position('listing_id = u.listing_id) as af_canon' in fdef) = 0
     or position('end as af_canon' in fdef) > 0 then
    raise exception 'ABORT: the rebuilt location_search_candidates_ar still packs af_canon before the limit';
  end if;

  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;

  -- the card still receives its evidence on an AF search, and still nothing on a plain one
  select (x.af_canon ? 'furnished')::text into probe_new
    from public.location_search_candidates_ar(p_deal => 'إيجار', p_furnished => true, p_limit => 1) x;
  if probe_new is distinct from 'true' then raise exception 'ABORT: an AF search no longer carries af_canon (%)', probe_new; end if;
  select coalesce(x.af_canon::text, 'NULL') into probe_old
    from public.location_search_candidates_ar(p_deal => 'بيع', p_limit => 1) x;
  if probe_old <> 'NULL' then raise exception 'ABORT: a no-AF search now carries af_canon'; end if;
end $$;
