-- af_canon packs majlis (2026-10-26, same change as 20261026011638 majlis_advanced_filter_amenity). The result card proves
-- every Advanced Filter answer field by field from af_canon (owner rule §12A), so the location_search_candidates_ar
-- template must pack s.majlis or a «مجلس» chip the user earned would be silently dropped
-- (scripts/verify-af-card-evidence.ts T6 holds sql/mirrors/af_canon_select.sql and afEvidence.ts to each other).
-- Needle-edit on the LIVE template row (exactly one occurrence or ABORT), then rebuild_af_filter_rpcs(); parity 0.
do $do$
declare
  tpl text; occ int; parity int;
  pack_old text := $x$'separate_water_meter', s.separate_water_meter) end as af_canon$x$;
  pack_new text := $x$'separate_water_meter', s.separate_water_meter, 'majlis', s.majlis) end as af_canon$x$;
begin
  select template into tpl from af_rpc_templates where fn_name = 'location_search_candidates_ar';
  if tpl is null then raise exception 'ABORT: af_rpc_templates has no location_search_candidates_ar row'; end if;
  if position($x$'majlis', s.majlis$x$ in tpl) > 0 then
    raise notice 'location_search_candidates_ar template already packs majlis — step skipped';
  else
    occ := (length(tpl) - length(replace(tpl, pack_old, ''))) / length(pack_old);
    if occ <> 1 then raise exception 'ABORT: af_canon packing needle occurs %', occ; end if;
    update af_rpc_templates set template = replace(tpl, pack_old, pack_new) where fn_name = 'location_search_candidates_ar';
  end if;
  perform * from rebuild_af_filter_rpcs();
  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;
  if position('''majlis'', s.majlis' in pg_get_functiondef('public.location_search_candidates_ar'::regproc)) = 0 then
    raise exception 'ABORT: the rebuilt location_search_candidates_ar does not pack majlis';
  end if;
end $do$;
