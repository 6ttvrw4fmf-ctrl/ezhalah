-- mon_auto_register_platform's internal-arm allowlist lacked the enumeration verbs, so the wasalt
-- enumeration JOB labels registered themselves as websites: wasalt_enum_shard (10-09) and
-- wasalt_enum_rollup_refused (10-13, raising a P0 silent_scraper_death on itself). Each inflated the
-- website count and read as a broken site (⚡ backlog 337/535). Adding _enum/_rollup so the next such
-- label is internal on its first run; body otherwise verbatim from the live function. The enumeration
-- stays watched by mon_detect_liveness_job_silent, which keys on the run label, not on kind.
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
    -- source; _prune/_backfill/_repair added 2026-08-06 after gathern_prune did the same; _enum/_rollup added
    -- 2026-10-17 after wasalt_enum_shard and wasalt_enum_rollup_refused did the same (backlog 337/535).
    -- Production sources are bare brand names (aqar, wasalt, gathern, ...), never verb-suffixed.
    v_kind := case when new.platform ~ '(_commercial|_residential|_recover|_enrich|_liveness|_sweep|_cleanup|_prune|_backfill|_repair|_enum|_rollup)'
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

-- correct the two rows the old classifier already mis-registered (the trigger never updates existing rows)
UPDATE public.platform_registry
SET kind = 'internal', notes = coalesce(notes,'') || ' [kind corrected 2026-10-17: wasalt enumeration job label, not a listing source]'
WHERE platform IN ('wasalt_enum_shard', 'wasalt_enum_rollup_refused') AND kind = 'source';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.platform_registry
              WHERE platform IN ('wasalt_enum_shard','wasalt_enum_rollup_refused') AND kind <> 'internal') THEN
    RAISE EXCEPTION 'wasalt enumeration labels still registered as sources';
  END IF;
  IF pg_get_functiondef('public.mon_auto_register_platform()'::regprocedure) !~ '_enum\|_rollup' THEN
    RAISE EXCEPTION 'classifier did not gain _enum/_rollup';
  END IF;
END $$;