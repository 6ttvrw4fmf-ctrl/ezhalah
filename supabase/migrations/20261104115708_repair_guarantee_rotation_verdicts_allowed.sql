-- The rotation's two verdicts are allowed by the registry's own check (follow-up to 20261104115418).
--
-- 20261104115418 added ops_repair_guarantee_rotate(); its first call raised repair_guarantee_rotation_failed
-- («violates check constraint ops_repair_guarantee_registry_last_verdict_check») because the check allowed only
-- holds / violated / detector_missing / undetermined. The failure path did exactly what it was built for — it
-- raised instead of going quiet. 'detector_clean' and 'detector_raising' are added (a strict superset, so every
-- existing row still passes); 'holds' stays the verdict only a per-invariant evidence re-check earns.
do $mig$
begin
  if pg_get_constraintdef((select oid from pg_constraint
                            where conrelid = 'public.ops_repair_guarantee_registry'::regclass
                              and conname = 'ops_repair_guarantee_registry_last_verdict_check'))
     <> 'CHECK ((last_verdict = ANY (ARRAY[''holds''::text, ''violated''::text, ''detector_missing''::text, ''undetermined''::text])))' then
    raise exception 'ops_repair_guarantee_registry_last_verdict_check is not the measured four-verdict check — re-read it';
  end if;
end
$mig$;

alter table public.ops_repair_guarantee_registry
  drop constraint ops_repair_guarantee_registry_last_verdict_check,
  add constraint ops_repair_guarantee_registry_last_verdict_check
    check (last_verdict = any (array['holds', 'violated', 'detector_missing', 'undetermined',
                                     'detector_clean', 'detector_raising']));

select public.mon_detect_repair_guarantee_stale();
