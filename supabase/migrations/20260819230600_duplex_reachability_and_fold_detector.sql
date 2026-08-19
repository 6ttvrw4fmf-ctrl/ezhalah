-- DUPLEX reachability detector (owner report 2026-08-19).
--
-- Investigation result: everything below ingestion was already exact — raw active Duplex 67 == indexed
-- 67, zero sync drift. The loss was entirely at the scraper layer: 19 scrapers carried stale local maps
-- folding a source-published دوبلكس into Villa, so the type was destroyed at write time. Those are fixed
-- in the repo; this detector is what stops it recurring silently, because a repo test cannot see the
-- DATA. Two independent assertions:
--
--   1. DRIFT — every active Duplex row in a platform table must be present in search_listings_ar.
--   2. FOLD — the fleet's Duplex population must not collapse to zero (that is a mapping regression,
--      which otherwise reads as "we simply have no duplexes").
--
-- Deliberately NOT asserted: any relationship between Duplex and villas whose free text mentions
-- دوبلكس. Aqar publishes no duplex category at all, so those rows are villas with a duplex LAYOUT.
create or replace function public.mon_detect_duplex_reachability()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  raw_duplex bigint := 0; idx_duplex bigint; n int := 0; t text; c bigint;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
  loop
    execute format('select count(*) from public.%I where active and property_type = ''Duplex''', t) into c;
    raw_duplex := raw_duplex + c;
  end loop;

  select count(*) into idx_duplex from public.search_listings_ar where type_ar = 'دوبلكس';

  if raw_duplex > idx_duplex then
    n := n + public.mon_raise('P2', 'duplex_index_drift', 'search', 'duplex_index_drift',
      jsonb_build_object('raw_active_duplex', raw_duplex, 'indexed_duplex', idx_duplex,
        'missing', raw_duplex - idx_duplex,
        'note', 'Duplex rows exist in platform tables but are absent from search_listings_ar — '
             || 'unreachable by every user-facing path.'));
  else
    update public.alert_event set resolved_at = now()
     where kind = 'duplex_index_drift' and resolved_at is null;
  end if;

  if idx_duplex = 0 then
    n := n + public.mon_raise('P1', 'duplex_type_folded', 'search', 'duplex_type_folded',
      jsonb_build_object('indexed_duplex', 0,
        'note', 'Zero searchable Duplex fleet-wide. A scraper mapping has almost certainly re-folded '
             || 'دوبلكس into Villa/Apartment (the 2026-08-19 defect). Check scrapers/*/run.py against '
             || 'scripts/verify-duplex-source-truth.ts.'));
  else
    update public.alert_event set resolved_at = now()
     where kind = 'duplex_type_folded' and resolved_at is null;
  end if;

  return n;
end $fn$;

do $roster$
declare src text;
begin
  select prosrc into src from pg_proc where proname='mon_run_all_detectors' and pronamespace='public'::regnamespace;
  if src like '%mon_detect_duplex_reachability%' then
    raise notice 'already rostered';
  else
    execute replace(pg_get_functiondef('public.mon_run_all_detectors'::regproc),
      '''mon_detect_rent_period_unreachable''',
      '''mon_detect_duplex_reachability'',''mon_detect_rent_period_unreachable''');
    raise notice 'rostered mon_detect_duplex_reachability';
  end if;
end $roster$;

notify pgrst, 'reload schema';
