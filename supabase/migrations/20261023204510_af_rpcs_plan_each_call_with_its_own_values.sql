-- P1 SPEED (owner 2026-10-23 19:58 UTC, on an iPhone: «it takes so so long to load»).
--
-- WHAT WAS SLOW. The six AF RPCs (location_search_candidates_ar = the results + every count probe,
-- top_cities_by_deal_ar, district_options_ar, af_eligible_count, apartment_guided_counts_ar,
-- property_age_option_counts_ar) were LANGUAGE sql. PostgREST calls them with arguments read from
-- json_to_record(), so Postgres 17 plans the body ONCE with unknown values: every
-- «p_cities is null or …», «p_districts is null or …» branch stays in the plan, no index can be used,
-- and every call — a one-district count included — seq-scans all of search_listings_ar
-- (~24,600 blocks, 405k rows, normalize_ar() per row). pg_stat_statements: ~23,100 blocks hit per
-- call on every shape. location_search_candidates_ar alone: 459,896 calls, mean 1,305 ms.
--
-- THE FIX. Same body, run as plpgsql with plan_cache_mode = force_custom_plan: each call is planned
-- with its own values, the null branches fold away, and the city / district / type indexes are used.
-- Nothing in the SQL changes — the template header and the last line are the only edits:
--   LANGUAGE sql  →  LANGUAGE plpgsql + SET plan_cache_mode TO 'force_custom_plan'
--   body          →  begin return query <same body>; end      (af_eligible_count: return (<body>); )
-- #variable_conflict use_column keeps every name resolving exactly as it did in SQL (a column always
-- wins over a RETURNS TABLE name, which SQL functions never exposed as variables).
--
-- PROOF BEFORE APPLY (pg_temp copies of all six, rendered by this exact transform, called side by side
-- with the live ones on production data, 2026-10-23): 240 location_search_candidates_ar argument sets
-- (24 cities incl. English names, 48 city+district pairs, regions, nationwide; buy / rent / both;
-- 4 rent periods; 3 categories; 8 type sets; table scopes incl. tables2/types2; all 7 sorts;
-- per-platform; limit/offset pages; rotation seeds; 10 AF predicate families) — 240/240 identical
-- rows in identical order. 30+ shapes for each of the other five plus 12 nationwide hot shapes —
-- all identical; top_cities_by_deal_ar identical except the order WITHIN equal listing_count ties,
-- which its own ORDER BY never fixed (same counts in the same sequence). Measured in the same runs:
-- location_search_candidates_ar mean 820-925 ms → 48-118 ms; broad Riyadh page 9.7 s → 0.9 s.
--
-- Goes through the template + rebuild_af_filter_rpcs() (never hand-edit the AF RPCs). Fails closed:
-- each template must carry exactly one LANGUAGE sql header and the expected last line; a rebuild that
-- would revert a live edit is refused; after the rebuild every RPC must be plpgsql + force_custom_plan
-- and seven probes over all six RPCs must return what they returned before the rebuild, in this same transaction.
--
-- Rollback: apply the reverse transform to af_rpc_templates (plpgsql header → LANGUAGE sql, drop the
-- begin/return query/end wrapper) and perform rebuild_af_filter_rpcs().
do $mig$
declare
  hdr_old constant text := E' LANGUAGE sql\n STABLE\nAS $function$';
  hdr_new constant text := E' LANGUAGE plpgsql\n STABLE\n SET plan_cache_mode TO ''force_custom_plan''\nAS $function$\n#variable_conflict use_column\nbegin\n';
  t record;
  tpl text;
  n int;
  jed int;
  before_probe text;
  after_probe text;
  probe constant text := $p$
    select md5(concat_ws('|',
      (select string_agg(r::text, ',' order by o) from public.location_search_candidates_ar(p_deal => 'إيجار', p_cities => array['جدة'], p_category => 'Residential', p_limit => 20, p_offset => 0, p_rotation_seed => 'mig') with ordinality r(a,b,c,d,e,f,g,h,i,j,k,l,o)),
      (select string_agg(r::text, ',' order by o) from public.location_search_candidates_ar(p_deal => 'بيع', p_cities => array['الرياض'], p_types => array['فيلا'], p_sort_by => 'price_asc', p_limit => 20, p_offset => 20) with ordinality r(a,b,c,d,e,f,g,h,i,j,k,l,o)),
      public.af_eligible_count(p_deal => 'إيجار', p_cities => array['جدة']),
      (select string_agg(r::text, ',' order by r::text) from public.top_cities_by_deal_ar(p_deal => 'بيع', p_category => 'Commercial') r),
      (select string_agg(r::text, ',' order by o) from public.district_options_ar(%s, p_deal => 'إيجار') with ordinality r(a,b,c,d,o)),
      (select r::text from public.property_age_option_counts_ar(p_deal => 'بيع', p_cities => array['جدة']) r),
      (select r::text from public.apartment_guided_counts_ar(p_deal => 'إيجار', p_cities => array['جدة']) r)))
  $p$;
begin
  if exists (select 1 from public.af_rebuild_would_revert()) then
    raise exception 'af_rpcs_plan_each_call: a rebuild would revert a live edit — refusing';
  end if;

  select c.city_id into strict jed from public.loc_catalog_city c where c.city_norm = public.normalize_ar('جدة');
  execute format(probe, jed) into before_probe;

  for t in select fn_name, template from public.af_rpc_templates order by fn_name loop
    n := (length(t.template) - length(replace(t.template, hdr_old, ''))) / length(hdr_old);
    if n <> 1 then
      raise exception '%: expected exactly one LANGUAGE sql header in the template, found %', t.fn_name, n;
    end if;
    if t.fn_name = 'af_eligible_count' then
      if right(t.template, 11) <> E'\n$function$' then raise exception '%: unexpected template ending', t.fn_name; end if;
      tpl := replace(t.template, hdr_old, hdr_new || 'return (');
      tpl := left(tpl, length(tpl) - 11) || E'\n);\nend\n$function$';
    else
      if right(t.template, 13) <> E';\n$function$\n' then raise exception '%: unexpected template ending', t.fn_name; end if;
      tpl := replace(t.template, hdr_old, hdr_new || 'return query');
      tpl := left(tpl, length(tpl) - 13) || E';\nend\n$function$\n';
    end if;
    update public.af_rpc_templates set template = tpl where fn_name = t.fn_name;
  end loop;

  -- THE BARRIER LIVES IN THE TABLE: a template that drops the per-call planning header can no longer
  -- be saved, so no later migration can quietly put the seq-scan-every-call plan back.
  alter table public.af_rpc_templates add constraint af_rpc_templates_plan_each_call
    check (position(E' LANGUAGE plpgsql\n STABLE\n SET plan_cache_mode TO ''force_custom_plan''\nAS $function$\n#variable_conflict use_column\nbegin\n' in template) > 0);

  perform public.rebuild_af_filter_rpcs();

  select count(*) into n
    from public.af_rpc_templates x
    join pg_proc p on p.proname = x.fn_name and p.pronamespace = 'public'::regnamespace
    join pg_language l on l.oid = p.prolang
   where l.lanname = 'plpgsql' and p.proconfig @> array['plan_cache_mode=force_custom_plan'];
  if n <> (select count(*) from public.af_rpc_templates) then
    raise exception 'af_rpcs_plan_each_call: only % of the AF RPCs are plpgsql + force_custom_plan after the rebuild', n;
  end if;

  execute format(probe, jed) into after_probe;
  if after_probe is distinct from before_probe then
    raise exception 'af_rpcs_plan_each_call: the probes changed across the rebuild (% → %) — rolling back', before_probe, after_probe;
  end if;
end
$mig$;
