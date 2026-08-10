-- Tripwire for the price-magnitude gate (2026-08-09).
-- It was removed once today and re-added by a concurrent session within ~2h, which also nulled 220
-- raw prices. Offline pytest guards cover the SCRAPERS; nothing watched the DB trigger, and the
-- DB is where the revert happened. This detector closes that hole.
--
-- Two independent signals, so a revert cannot be silent:
--   1. the trigger body contains a magnitude comparison against price_total again, or
--   2. Buy rows carrying a source-published sub-1000 price disappear from search_listings_ar while
--      the raw tables still hold them (the exact shape of the incident).
CREATE OR REPLACE FUNCTION public.mon_detect_price_magnitude_gate()
 RETURNS TABLE(signal text, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare body text; searchable bigint; raw_ct bigint;
begin
  body := pg_get_functiondef('public.enforce_price_size_sanity'::regproc);
  if body ~ 'price_total\s*<\s*[0-9]' or body ~ 'price_annual\s*<\s*[0-9]' then
    signal := 'trigger_gate_returned';
    detail := 'enforce_price_size_sanity() compares a price against a magnitude again. '
           || 'A source-published price is stored and searchable at ANY magnitude '
           || '(owner rule 2026-08-03; 204/204 live sub-1000 Buy rows matched their source page '
           || 'on 2026-08-09). Restore the removal or get an explicit owner decision.';
    return next;
  end if;

  select count(*) into searchable
  from public.search_listings_ar
  where deal_ar = 'بيع' and price_total between 1 and 999;

  select count(*) into raw_ct from public.ops_sub1000_raw_restore_20260809;

  if raw_ct > 0 and searchable < raw_ct / 2 then
    signal := 'sub1000_prices_vanished';
    detail := format('only %s of %s known source-published sub-1000 Buy prices are searchable; '
                  || 'evidence: scripts/ops/evidence/, restore: '
                  || 'scripts/ops/repair_sub1000_price_restore_2026-08-09.sql', searchable, raw_ct);
    return next;
  end if;
end $function$;

select cron.schedule(
  'mon-price-magnitude-gate',
  '35 6 * * *',
  $$select public.mon_detect_price_magnitude_gate();$$
);
