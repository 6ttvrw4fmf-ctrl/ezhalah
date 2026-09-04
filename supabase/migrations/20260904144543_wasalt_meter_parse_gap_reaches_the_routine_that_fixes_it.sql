-- AN ALERT THAT ASKS ROUTINE #1 TO FIX A PARSER MUST LAND IN ROUTINE #1'S QUEUE.
--
-- 20260904143531 shipped mon_detect_wasalt_meter_parse_gap() raising kind 'repair_guarantee'.
-- That kind is semantically right for the registry but WRONG for the destination:
-- scripts/lib/alertRouting.ts routes /^(registry_orphans|repair_guarantee|loc_rel_|rls_)/ to
-- routine 7, so the GitHub issue would have been labelled `routine-7-seam` — filed to the routine
-- that FOUND it, never to the routine that can FIX it. The alert body says, in as many words,
-- "fix the wasalt enrichment/parse", which is routine #1's surface, and #1 would never have seen it.
--
-- Measured with the real router before changing anything:
--   repair_guarantee              -> routine 7  routine-7-seam
--   wasalt_meter_parse_gap        -> routine 2  routine-2-production   (kind is not the dedup key)
--   wasalt_enrich_meter_parse_gap -> routine 1  routine-1-scraping     <- the owner of the fix
--
-- Detection stays mine: the registry row still points at this detector and #7's rotation still
-- re-verifies the invariant. Only the DESTINATION changes.
--
-- WHY THE OLD KEY IS RESOLVED HERE, IN THE SAME MIGRATION. mon_raise() returns 0 for an already
-- open dedup_key, so leaving alert 1411 open under kind 'repair_guarantee' would do two bad things
-- at once: the re-raise under the new kind would be suppressed entirely, and 1411 would sit open
-- forever under a kind nothing re-affirms — an unresolvable ratchet, which is precisely the defect
-- class this run found four standing examples of (unresolvable_alert_kind:*). Resolving it first
-- means the next sweep raises cleanly with the correct owner label. 1411 was still UNDELIVERED at
-- the time of this migration, so no GitHub issue carries the wrong label either.
create or replace function public.mon_detect_wasalt_meter_parse_gap()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gap        bigint;
  v_after      bigint;
  n            int := 0;
begin
  select count(*),
         count(*) filter (where w.scraped_at >= timestamptz '2026-08-09')
    into v_gap, v_after
    from public.wasalt_residential_listings w
   where w.active
     and jsonb_typeof(w.additional_info) = 'array'
     and (
       ((select elem->>'value' from jsonb_array_elements(w.additional_info) elem
          where elem->>'key' = 'waterMeter' limit 1) in ('Yes','No')
        and w.separate_water_meter is null)
       or
       ((select elem->>'value' from jsonb_array_elements(w.additional_info) elem
          where elem->>'key' = 'electricityMeter' limit 1) in ('Yes','No')
        and w.separate_electricity_meter is null));

  if v_gap > 0 then
    -- kind routes to routine-1-scraping, which owns the wasalt enrichment/parse this asks for.
    n := n + public.mon_raise('P2', 'wasalt_enrich_meter_parse_gap', 'wasalt',
      'wasalt_meter_parse_gap',
      jsonb_build_object(
        'active_rows_with_gap', v_gap,
        'scraped_since_the_repair', v_after,
        'repair', '20260809151000_wasalt_meters_repaired_from_source',
        'found_by', 'routine #7 repair-guarantee rotation 2026-09-04',
        'why', 'wasalt publishes waterMeter/electricityMeter as Yes/No inside additional_info on '
            || 'these ACTIVE rows, but separate_water_meter / separate_electricity_meter are NULL. '
            || 'Migration 20260809151000 repaired exactly this for the rows that existed on '
            || '2026-08-09; the producing path was never changed, so every crawl since has '
            || 're-created the defect. Measured: 0 of the gap rows were scraped before the repair '
            || 'and all 8,284 after. A one-shot repair with no forward fix is a guarantee that '
            || 'decays by design.',
        'action', 'Fix the wasalt enrichment/parse so newly written rows carry these columns from '
            || 'the same additional_info keys the repair read. Then, and only then, backfill the '
            || 'standing rows from THEIR OWN payload.',
        'do_not', 'Do NOT clear this with another one-shot UPDATE and no producing-path fix — that '
            || 'is what created this alert. Do NOT infer a value the payload does not publish: '
            || 'only Yes/No are read, anything else stays NULL.'));
  else
    perform public.mon_resolve_key('wasalt_enrich_meter_parse_gap', 'wasalt_meter_parse_gap');
  end if;
  return n;
end
$function$;

comment on function public.mon_detect_wasalt_meter_parse_gap() is
'Raises while ACTIVE wasalt rows publish waterMeter/electricityMeter (Yes/No) in additional_info but '
'the parsed separate_*_meter column is NULL — i.e. the invariant repaired by 20260809151000 is being '
're-broken by the producing path. Found by routine #7''s repair-guarantee rotation 2026-09-04: 8,284 '
'rows, ALL scraped after the repair and none before. Kind is wasalt_enrich_meter_parse_gap so the '
'issue is filed to routine-1-scraping, which owns the parser the alert asks to be fixed; detection '
'and re-verification stay with routine #7 via ops_repair_guarantee_registry. Never writes a listing row.';

-- Release the superseded key so the re-raise is not suppressed and 1411 is not left as a ratchet.
update public.alert_event
   set resolved_at = now()
 where dedup_key = 'wasalt_meter_parse_gap'
   and kind = 'repair_guarantee'
   and resolved_at is null;

do $assert$
declare v_raised int; v_kind text; v_open_old int;
begin
  -- the superseded row must be closed BEFORE the re-raise, or mon_raise() returns 0
  select count(*) into v_open_old from public.alert_event
   where dedup_key = 'wasalt_meter_parse_gap' and kind = 'repair_guarantee' and resolved_at is null;
  if v_open_old <> 0 then
    raise exception 'the superseded repair_guarantee row is still open - the re-raise would be suppressed';
  end if;

  -- EXECUTED proof: it raises, and under the routing kind rather than the old one
  select public.mon_detect_wasalt_meter_parse_gap() into v_raised;
  if v_raised < 1 then
    raise exception 'detector did not raise on a state measured to contain 8,218 active gap rows';
  end if;

  select kind into v_kind from public.alert_event
   where dedup_key = 'wasalt_meter_parse_gap' and resolved_at is null
   order by created_at desc limit 1;
  if v_kind is distinct from 'wasalt_enrich_meter_parse_gap' then
    raise exception 'open alert carries kind % - it would be filed to the wrong routine', v_kind;
  end if;
end
$assert$;
