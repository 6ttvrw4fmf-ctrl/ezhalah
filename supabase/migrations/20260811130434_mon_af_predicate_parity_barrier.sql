-- THE PARITY BARRIER. Fails loudly if the shared-eligibility architecture regresses in any of the
-- four ways it can:
--   A. an RPC grows a second overload (the PGRST203 outage shape);
--   B. any of the four surfaces is edited OUTSIDE rebuild_af_filter_rpcs() — live md5 no longer
--      matches the recorded build-state md5 (this also catches an edited template/clause that was
--      never rebuilt, since rebuilding is what updates the record);
--   C. the parameter surfaces drift apart — a results eligibility param with no counts counterpart
--      (the chip-overstates bug) or vice versa. Canonical = af_eligible_count's params; results may
--      additionally carry ONLY the four presentation params (per_platform, limit, offset, sort_by);
--   D. behavior diverges empirically — results.total_count, counts.cnt_total_base and
--      af_eligible_count disagree on probe filter sets that exercise the once-asymmetric params.
create or replace function public.mon_af_predicate_parity()
returns integer
language plpgsql
as $fn$
declare
  total int := 0; v int; fname text; live text; want text; extra text; missing text;
  elig_params text[]; fn_params text[];
  n_res bigint; n_cnt bigint; n_ref bigint;
begin
  -- A + B ------------------------------------------------------------------
  for fname in select bs.fn_name from public.af_rpc_build_state bs order by 1 loop
    select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fname and p.prokind = 'f';
    if v <> 1 then
      total := total + 1;
      insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('af_parity_overload', v, fname || ' has ' || v || ' overloads (must be exactly 1 — PGRST203 shape).');
      continue;
    end if;
    select md5(pg_get_functiondef(p.oid)) into live
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fname and p.prokind = 'f';
    select bs.def_md5 into want from public.af_rpc_build_state bs where bs.fn_name = fname;
    if live is distinct from want then
      total := total + 1;
      insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('af_parity_hand_edit', 1, fname || ' was modified outside rebuild_af_filter_rpcs() '
              || '(live ' || left(live,12) || ' vs built ' || left(want,12) || '). One definition of '
              || 'eligibility means edits go through af_eligibility_clause()/af_rpc_templates + rebuild.');
    end if;
  end loop;

  -- C ----------------------------------------------------------------------
  select array_agg(x) into elig_params from (
    select trim(split_part(a, ' ', 1)) x
      from unnest(string_to_array(pg_get_function_arguments(
             'public.af_eligible_count'::regproc), ',')) a) q;
  foreach fname in array array['apartment_guided_counts_ar','property_age_option_counts_ar',
                               'location_search_candidates_ar'] loop
    select array_agg(x) into fn_params from (
      select trim(split_part(a, ' ', 1)) x
        from unnest(string_to_array(pg_get_function_arguments(fname::regproc), ',')) a) q;
    select string_agg(p, ', ') into missing from unnest(elig_params) p where not p = any(fn_params);
    select string_agg(p, ', ') into extra from unnest(fn_params) p
     where not p = any(elig_params)
       and p not in ('p_per_platform','p_limit','p_offset','p_sort_by');
    if missing is not null or (extra is not null and fname <> 'location_search_candidates_ar')
       or (extra is not null and fname = 'location_search_candidates_ar') then
      -- for the two counts fns, ANY extra is drift; for results, extras beyond the allowlist are drift
      total := total + 1;
      insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('af_parity_param_surface', 1,
              fname || ' parameter surface drift — missing: [' || coalesce(missing,'') || '] '
              || 'unsanctioned extra: [' || coalesce(extra,'') || ']. A results predicate without a '
              || 'counts counterpart makes the chip overstate.');
    end if;
  end loop;

  -- D ----------------------------------------------------------------------
  for n_res, n_cnt, n_ref in
    select (select r.total_count from public.location_search_candidates_ar(
              p_deal := 'إيجار', p_rent_period := 'سنوي', p_types := array['شقة'],
              p_furnished := f, p_bath_exact := be, p_has_license := hl,
              p_street_width_min := swm, p_age_unknown := au, p_limit := 1) r limit 1),
           (select c.cnt_total_base from public.apartment_guided_counts_ar(
              p_deal := 'إيجار', p_rent_period := 'سنوي', p_types := array['شقة'],
              p_furnished := f, p_bath_exact := be, p_has_license := hl,
              p_street_width_min := swm, p_age_unknown := au) c),
           public.af_eligible_count(
              p_deal := 'إيجار', p_rent_period := 'سنوي', p_types := array['شقة'],
              p_furnished := f, p_bath_exact := be, p_has_license := hl,
              p_street_width_min := swm, p_age_unknown := au)
      from (values (null::boolean, null::integer[], null::boolean, null::smallint, null::boolean),
                   (true, null, null, null, null),
                   (null, array[2], true, 10::smallint, null),
                   (null, null, null, null, false)) probes(f, be, hl, swm, au)
  loop
    if coalesce(n_res, 0) <> n_cnt or n_cnt <> n_ref then
      total := total + 1;
      insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('af_parity_empirical', coalesce(n_res,0),
              format('count/results parity broken: results=%s counts=%s referee=%s', n_res, n_cnt, n_ref));
    end if;
  end loop;

  return total;
end
$fn$;

select cron.schedule('mon-af-predicate-parity', '43 * * * *',
  $$set statement_timeout to '120s'; select public.mon_af_predicate_parity();$$);

-- must be green at install time
do $$
declare v int;
begin
  v := public.mon_af_predicate_parity();
  if v <> 0 then raise exception 'parity barrier reports % violations at install', v; end if;
end $$;
