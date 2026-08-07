-- mon_auto_register_platform classified internal arms by a naming allowlist that was missing
-- '_prune', so gathern_prune registered as kind='source' (2026-08-05) and tripped the nightly
-- platform-completeness check as a phantom P1 -- the same failure gathern_liveness caused on
-- 2026-07-28. Adding the remaining internal-arm verbs (_prune/_backfill/_repair) so a new arm
-- does not have to be hand-corrected a third time. Body is otherwise verbatim from the live fn.
CREATE OR REPLACE FUNCTION public.mon_auto_register_platform()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_kind text;
begin
  -- Skip ':'-namespaced pseudo-runs (liveness/cleanup sub-runs) — same convention already used
  -- by mon_detect_silent_scraper_death's "platform !~ ':'" filter; these aren't real platforms
  -- and shouldn't get their own platform_registry row.
  if new.platform is not null and new.platform !~ ':' then
    -- Classify workflow/recovery/enrichment/sub-sweep arms as kind='internal' so NO source-oriented
    -- monitor, completeness check, or report ever treats them as a production listing source. Their
    -- rows land under a parent source (or are 0 by design). Convention covers the existing arms
    -- (aqar_commercial/aqar_residential sub-sweeps, wasalt_enrich_ar_* enrichers, dealapp_recover,
    -- gathern_liveness, gathern_prune) and any future job following the same naming.
    -- _liveness/_sweep/_cleanup added 2026-07-28 after gathern_liveness registered itself as a
    -- source; _prune/_backfill/_repair added 2026-08-06 after gathern_prune did the same.
    -- Production sources are bare brand names (aqar, wasalt, gathern, ...), never verb-suffixed.
    v_kind := case when new.platform ~ '(_commercial|_residential|_recover|_enrich|_liveness|_sweep|_cleanup|_prune|_backfill|_repair)'
                   then 'internal' else 'source' end;
    -- ON CONFLICT DO NOTHING is the whole safety contract: if the platform already has a registry
    -- row — 'active', 'dormant', 'retired', source or internal — this insert is a complete no-op.
    -- It NEVER updates status, expected_cadence_hours, notes, or kind on an existing row, so a stray
    -- begin_run() for a retired platform can not resurrect it. Only a first-ever name gets a row.
    insert into public.platform_registry (platform, status, expected_cadence_hours, kind)
    values (new.platform, 'active', 24, v_kind)
    on conflict (platform) do nothing;
  end if;
  return new;
end $function$;

-- correct the row the old classifier already mis-registered (the trigger never updates existing rows)
UPDATE public.platform_registry
SET kind = 'internal', notes = coalesce(notes,'') || ' [kind corrected 2026-08-06: prune arm, not a listing source]'
WHERE platform = 'gathern_prune' AND kind = 'source';
