-- Classify liveness/sweep/cleanup arms as kind='internal' in mon_auto_register_platform().
--
-- 2026-07-28 nightly audit: the platform-completeness check (active AND kind='source' platforms
-- missing from search_listings_ar) reported `gathern_liveness` as a production source that had
-- dropped out of the index. It is not a source: it is gathern's liveness arm, auto-registered
-- 2026-07-27 12:23 with 5 runs and ZERO rows of its own — its rows land under parent `gathern`.
--
-- Root cause: the classifier matched only (_commercial|_residential|_recover|_enrich). aqar's
-- liveness arms are ':'-namespaced ("aqar_liveness:aqar_residential_listings:3/16") so the
-- pre-existing `platform !~ ':'` guard skipped them entirely and the gap stayed invisible. The
-- gathern arm registers a BARE name, so it fell through to 'source' and became a permanent
-- nightly false-positive.
--
-- Fix the pattern at the source so every future arm following the convention self-classifies,
-- then correct the one row already written. ON CONFLICT DO NOTHING means the trigger can never
-- repair an existing row itself — a misclassified name stays wrong until updated explicitly.

create or replace function public.mon_auto_register_platform()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- gathern_liveness) and any future job following the same naming. _liveness/_sweep/_cleanup
    -- added 2026-07-28 after gathern_liveness registered itself as a source.
    v_kind := case when new.platform ~ '(_commercial|_residential|_recover|_enrich|_liveness|_sweep|_cleanup)'
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

-- Correct the row the old pattern already mis-wrote. Scoped by name AND by the evidence that made
-- it internal (no rows of its own in the search index), so this can never reclassify a real source.
update public.platform_registry r
   set kind = 'internal', updated_at = now()
 where r.platform = 'gathern_liveness'
   and r.kind = 'source'
   and not exists (select 1 from public.search_listings_ar s where s.platform = r.platform);
