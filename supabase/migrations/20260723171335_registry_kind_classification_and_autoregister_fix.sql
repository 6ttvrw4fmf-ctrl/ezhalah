-- Separate production listing sources from internal workflow/recovery/enrichment arms.
-- Root cause of the dealapp_recover false-positive: trg_auto_register_platform inserted
-- every new scrape_runs label as status='active', with no notion that some labels are
-- internal arms whose rows land under a parent source (0 rows in search_listings_ar).

ALTER TABLE public.platform_registry
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'source';

COMMENT ON COLUMN public.platform_registry.kind IS
  'Classification orthogonal to status. source = production listing source that appears in search_listings_ar under its own name. internal = workflow/recovery/enrichment/sub-sweep arm whose rows land under a parent source (or that produces 0 index rows by design). Every monitor / completeness check / report that means "is a production source" MUST filter kind=''source''. New arms are auto-classified by mon_auto_register_platform() via naming convention (_commercial/_residential/_recover/_enrich).';

-- Backfill the 5 known internal arms (all have 0 rows in search_listings_ar; all emit
-- scrape_runs under their own label but write listings under aqar/wasalt/dealapp).
UPDATE public.platform_registry
SET kind = 'internal'
WHERE platform IN ('aqar_commercial','aqar_residential',
                   'wasalt_enrich_ar_commercial','wasalt_enrich_ar_residential','dealapp_recover');

-- Vocabulary guard (typo protection); all rows are source/internal after backfill.
ALTER TABLE public.platform_registry DROP CONSTRAINT IF EXISTS platform_registry_kind_chk;
ALTER TABLE public.platform_registry
  ADD CONSTRAINT platform_registry_kind_chk CHECK (kind IN ('source','internal'));

-- Root-cause fix: auto-register classifies new arms as kind='internal' by naming convention,
-- so no future recovery/workflow/enrichment job is ever treated as a production source.
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
    -- rows land under a parent source (or are 0 by design). Convention covers the 5 existing arms
    -- (aqar_commercial/aqar_residential sub-sweeps, wasalt_enrich_ar_* enrichers, dealapp_recover)
    -- and any future job following the same naming.
    v_kind := case when new.platform ~ '(_commercial|_residential|_recover|_enrich)'
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
