-- 🔬 2026-11-03 (alert 12568, P1 since 2026-11-01 11:54): the Monthly freeze guard in mon_check_filter_parity_legacy()
-- still allowed only the 2026-08-18 certified شهري set (شقة/غرفة/فيلا). Two reviewed, committed migrations then
-- certified more short-stays cohorts on the owner's handoff: 20261101110658 (استوديو, ستوديو, «شقَّة صغيرة (استوديو)»,
-- owner handoff 2026-10-31) and 20261102101415 (استراحة, شاليه, مخيم, «owner lists 2026-11-01»). The guard's own
-- comment says certification happens in a reviewed migration — those two are it — so the certified set is updated
-- here, to exactly those 9 types. Any OTHER شهري row still pages P1, unchanged. Nothing else in the function moves.
create or replace function public.mon_check_filter_parity_legacy()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare total int := 0; r record;
begin
  for r in select * from public.mon_filter_parity_barrier() where n > 0 loop
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('filter_parity_legacy_' || r.check_name, r.n, left(coalesce(r.detail, r.check_name), 400));
  end loop;
  -- registry freeze-guards (2026-08-15): Monthly stays FROZEN and the certified set can only
  -- shrink via a reviewed migration. Floor = 18 enabled rows; RAISE it when adding cohorts.
  -- Monthly UNFROZEN by owner order 2026-08-18 ("Start building the Monthly Advanced Filter
  -- now") — the freeze is replaced, not removed: only the CERTIFIED Monthly set may exist, and any
  -- other شهري row still pages P1. Certification happens in a reviewed migration, nowhere else.
  -- Certified set 2026-11-03: + studio short stays (20261101110658) + rest house / chalet / camp (20261102101415).
  if exists (select 1 from public.af_cohort_registry
              where rent_period_ar = 'شهري'
                and type_ar not in ('شقة','غرفة','فيلا',
                                    'استوديو','ستوديو','شقَّة صغيرة (استوديو)',
                                    'استراحة','شاليه','مخيم')) then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('af_registry_monthly_uncertified', 1,
            'an UNCERTIFIED شهري cohort row appeared in af_cohort_registry — Monthly cohorts are added only by reviewed migration (certified set 2026-11-03: شقة/غرفة/فيلا/استوديو/ستوديو/شقَّة صغيرة (استوديو)/استراحة/شاليه/مخيم).');
    perform public.mon_raise('P1', 'af_registry_monthly_uncertified', 'search_index',
      'af_registry_monthly_uncertified', jsonb_build_object('why',
        'A شهري cohort outside the certified set was inserted without certification.'));
  else
    perform public.mon_resolve_key('af_registry_monthly_uncertified', 'af_registry_monthly_uncertified');
  end if;
  perform public.mon_resolve_key('af_registry_monthly_unfrozen', 'af_registry_monthly_unfrozen');
  if (select count(*) from public.af_cohort_registry where enabled) < 59 then
    total := total + 1;
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
    values ('af_registry_shrunk', (select count(*) from public.af_cohort_registry where enabled),
            'enabled af_cohort_registry rows fell below the certified floor of 59 — a cohort silently lost barrier protection.');
    perform public.mon_raise('P1', 'af_registry_shrunk', 'search_index',
      'af_registry_shrunk', jsonb_build_object('enabled_rows', (select count(*) from public.af_cohort_registry where enabled), 'floor', 59));
  else
    perform public.mon_resolve_key('af_registry_shrunk', 'af_registry_shrunk');
  end if;
  if total > 0 then
    perform public.mon_raise('P1', 'filter_parity_legacy', 'search_index',
      'filter_parity_legacy', jsonb_build_object('issues', total,
      'why', 'Filter parity barrier detected divergence between served filters and source truth.'));
  else
    perform public.mon_resolve_key('filter_parity_legacy', 'filter_parity_legacy');
  end if;
  return total;
end
$function$;
