-- SILENT-ALARM FIX (2026-08-15 backend audit): mon_af_predicate_parity, mon_check_normal_filter_barrier
-- and mon_check_filter_parity_legacy detected but never PAGED — they insert location_pipeline_alerts,
-- a channel alert-dispatch.yml does not read, and never call mon_raise. A real parity break would sit
-- on the dashboard unseen. Fix: each raises P1 into the dispatched channel on total>0 and resolves on 0.
-- Plus two registry freeze-guards in the hourly parity wrapper: Monthly must stay frozen (0 شهري rows)
-- and the certified set can only shrink via a reviewed migration (floor 18 — RAISE the floor in the
-- same migration that adds cohorts). Plus mon_detect_orphaned_detectors gains an explicit
-- must-be-scheduled list for the AF barrier fleet (its mon_detect_% prefix rule cannot see them).
-- All edits are live-def needle-edits (never a pasted stale body). These fns are standalone monitors:
-- not template-driven, not replay-tracked.
do $do$
declare def text; occ int;
  fn text; needle text; repl text;
begin
  -- 1. mon_af_predicate_parity: page on breakage
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname='mon_af_predicate_parity' and p.pronamespace='public'::regnamespace;
  needle := E'\n\n  return total;\nend\n$function$';
  occ := (length(def) - length(replace(def, needle, ''))) / length(needle);
  if occ <> 1 then raise exception 'ABORT: parity tail needle occurs %', occ; end if;
  repl := E'\n\n  if total > 0 then\n    perform public.mon_raise(''P1'', ''af_parity_empirical'', ''search_index'',\n      ''af_parity_empirical'', jsonb_build_object(''issues'', total,\n      ''why'', ''AF predicate/count/referee parity broken — counts shown to users may not match results.''));\n  else\n    perform public.mon_resolve_key(''af_parity_empirical'', ''af_parity_empirical'');\n  end if;\n  return total;\nend\n$function$';
  execute replace(def, needle, repl);

  -- 2. mon_check_normal_filter_barrier: page on breakage
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname='mon_check_normal_filter_barrier' and p.pronamespace='public'::regnamespace;
  needle := E'\n  return total;\nend $function$';
  occ := (length(def) - length(replace(def, needle, ''))) / length(needle);
  if occ <> 1 then raise exception 'ABORT: normal-barrier tail needle occurs %', occ; end if;
  repl := E'\n  if total > 0 then\n    perform public.mon_raise(''P1'', ''normal_filter_barrier'', ''search_index'',\n      ''normal_filter_barrier'', jsonb_build_object(''issues'', total,\n      ''why'', ''Normal Filter barrier regression — an Ezhalah-side mistake is corrupting base search fields.''));\n  else\n    perform public.mon_resolve_key(''normal_filter_barrier'', ''normal_filter_barrier'');\n  end if;\n  return total;\nend $function$';
  execute replace(def, needle, repl);

  -- 3. mon_check_filter_parity_legacy: page on breakage + registry freeze-guards
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname='mon_check_filter_parity_legacy' and p.pronamespace='public'::regnamespace;
  needle := E'\n  return total;\nend\n$function$';
  occ := (length(def) - length(replace(def, needle, ''))) / length(needle);
  if occ <> 1 then raise exception 'ABORT: legacy tail needle occurs %', occ; end if;
  repl := E'\n  -- registry freeze-guards (2026-08-15): Monthly stays FROZEN and the certified set can only\n  -- shrink via a reviewed migration. Floor = 18 enabled rows; RAISE it when adding cohorts.\n  if (select count(*) from public.af_cohort_registry where rent_period_ar = ''شهري'') > 0 then\n    total := total + 1;\n    insert into public.location_pipeline_alerts(alert_type, metric, detail)\n    values (''af_registry_monthly_unfrozen'', 1, ''a شهري row appeared in af_cohort_registry — Monthly is owner-FROZEN; no session may enable it.'');\n    perform public.mon_raise(''P1'', ''af_registry_monthly_unfrozen'', ''search_index'',\n      ''af_registry_monthly_unfrozen'', jsonb_build_object(''why'', ''Monthly Rent is frozen by owner order; a شهري cohort row was inserted.''));\n  else\n    perform public.mon_resolve_key(''af_registry_monthly_unfrozen'', ''af_registry_monthly_unfrozen'');\n  end if;\n  if (select count(*) from public.af_cohort_registry where enabled) < 18 then\n    total := total + 1;\n    insert into public.location_pipeline_alerts(alert_type, metric, detail)\n    values (''af_registry_shrunk'', (select count(*) from public.af_cohort_registry where enabled),\n            ''enabled af_cohort_registry rows fell below the certified floor of 18 — a cohort silently lost barrier protection.'');\n    perform public.mon_raise(''P1'', ''af_registry_shrunk'', ''search_index'',\n      ''af_registry_shrunk'', jsonb_build_object(''enabled_rows'', (select count(*) from public.af_cohort_registry where enabled), ''floor'', 18));\n  else\n    perform public.mon_resolve_key(''af_registry_shrunk'', ''af_registry_shrunk'');\n  end if;\n  if total > 0 then\n    perform public.mon_raise(''P1'', ''filter_parity_legacy'', ''search_index'',\n      ''filter_parity_legacy'', jsonb_build_object(''issues'', total,\n      ''why'', ''Filter parity barrier detected divergence between served filters and source truth.''));\n  else\n    perform public.mon_resolve_key(''filter_parity_legacy'', ''filter_parity_legacy'');\n  end if;\n  return total;\nend\n$function$';
  execute replace(def, needle, repl);

  -- 4. mon_detect_orphaned_detectors: explicit must-be-scheduled list for the AF barrier fleet
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname='mon_detect_orphaned_detectors' and p.pronamespace='public'::regnamespace;
  needle := $x$  if cardinality(orphans) > 0 then$x$;
  occ := (length(def) - length(replace(def, needle, ''))) / length(needle);
  if occ <> 1 then raise exception 'ABORT: orphan needle occurs %', occ; end if;
  repl := $x$  -- 2026-08-15: the mon_detect_% prefix rule cannot see the first-class AF barriers; each of
  -- these must own an active cron entry (they are not roster members by design).
  orphans := orphans || (
    select coalesce(array_agg(m order by m), '{}')
      from unnest(array['mon_af_predicate_parity','mon_check_normal_filter_barrier',
                        'mon_check_filter_parity_legacy','mon_rich_attrs_barrier',
                        'mon_af_new_listing_readiness']) m
     where not exists (select 1 from cron.job j where j.active and position(m in j.command) > 0));

  if cardinality(orphans) > 0 then$x$;
  execute replace(def, needle, repl);

  -- all four must run clean right now
  if public.mon_af_predicate_parity() <> 0 then raise exception 'ABORT: parity dirty after edit'; end if;
  if public.mon_check_normal_filter_barrier() <> 0 then raise exception 'ABORT: normal barrier dirty after edit'; end if;
  if public.mon_check_filter_parity_legacy() <> 0 then raise exception 'ABORT: legacy parity dirty after edit'; end if;
  if public.mon_detect_orphaned_detectors() <> 0 then raise exception 'ABORT: orphan detector dirty after edit'; end if;
  raise notice 'SUCCESS: 3 barriers now page on detection; registry freeze-guards live; orphan guard covers the AF fleet';
end $do$;