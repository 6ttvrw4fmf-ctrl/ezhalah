-- mon_detect_adjudicated_reactivation(): TWO defects, both measured on the four standing sadin rows.
-- Senior Production Engineer (routine #2), 2026-09-11.
--
-- 1. THE PAYLOAD ASSERTED A DUPLICATE THAT IS NOT THERE.
--    The body told every reader the res/com URL collision "is live in search again" for EVERY row.
--    Measured today: the four sadin rows (5695607, 5695608, 5695635, 5695658) have exactly ONE side
--    in search_listings_ar -- the residential one. Their commercial twins (2116989, 2116990, 599000,
--    599004) were deactivated 2026-09-02 and are NOT served. Nothing is duplicated. What is actually
--    true is different and still P1: the ad is served under the category the 2026-08-30 adjudication
--    REJECTED. That needs a different check (re-probe the source), so the two shapes are now
--    separated and counted:
--      COLLISION_RESTORED     - the survivor is active too: two cards for one source ad.
--      SUPERSEDED_BY_REROUTE  - the survivor has since been retired: ONE card, rejected category.
--      UNKNOWN_SIBLING        - no pair row to compare against; treated as unclassified, never benign.
--    Severity is UNCHANGED (P1) for all shapes. No signal is dropped and nothing is silenced -- the
--    detector is made to distinguish cases, not to go quiet.
--
-- 2. THE DEDUP KEY RATCHETED.
--    The key is day-scoped ('adjudicated_reactivation:'||current_date) and the else-branch resolved
--    only TODAY's key, so every previous day's alert stayed open forever: 11 open P1 rows for ONE
--    standing condition (2026-09-01 .. 2026-09-11), growing by one per day. This kind is NOT
--    registered in ops_alert_kind_autoresolve, so the ratchet was never a designed exemption -- it
--    is the exact bug mon_detect_stuck_open_alert() describes, and this is the remedy that detector
--    itself prescribes: call mon_resolve_stale_keys(kind, live_keys) on the EVALUATED path, passing
--    the keys this run re-raised. Never from an early return.
create or replace function public.mon_detect_adjudicated_reactivation()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  v_rows jsonb;
  v_count int;
  v_collision int := 0;
  v_reroute int := 0;
  v_key text := 'adjudicated_reactivation:' || current_date;
begin
  -- An exemption is only worth anything if something checks it was honoured. If an adjudicated row
  -- is active again, some path reactivated it -- the recovery job, a scraper upsert, or a hand edit.
  with adj as (
    select j.tbl, j.listing_id, j.ledger, c.com_id, c.platform
      from public.ops_adjudicated_listing j
      left join public.ops_res_com_collision_adjudication c
             on j.ledger = 'res_com_collision'
            and c.res_id = j.listing_id
            and j.tbl    = c.platform || '_residential_listings'
  ), act as (
    select a.*,
           (xpath('/row/c/text()',
              query_to_xml(format('select count(*) c from public.%I where id = %s and active',
                                  a.tbl, a.listing_id), false, true, '')))[1]::text::int > 0 as is_active
      from adj a
  ), sib as (
    select a.*,
           case when a.com_id is null then null
                else (xpath('/row/c/text()',
                       query_to_xml(format('select count(*) c from public.%I where id = %s and active',
                                           a.platform || '_commercial_listings', a.com_id),
                                    false, true, '')))[1]::text::int > 0
           end as sibling_active
      from act a
     where a.is_active
  ), shaped as (
    select s.tbl, s.listing_id, s.ledger, s.com_id,
           case when s.sibling_active is true  then 'COLLISION_RESTORED'
                when s.sibling_active is false then 'SUPERSEDED_BY_REROUTE'
                else 'UNKNOWN_SIBLING' end as shape
      from sib s
     limit 200
  )
  select count(*),
         count(*) filter (where shape = 'COLLISION_RESTORED'),
         count(*) filter (where shape = 'SUPERSEDED_BY_REROUTE'),
         coalesce(jsonb_agg(jsonb_build_object(
             'tbl', tbl, 'listing_id', listing_id, 'ledger', ledger,
             'shape', shape, 'sibling_listing_id', com_id)
           order by tbl, listing_id), '[]'::jsonb)
    into v_count, v_collision, v_reroute, v_rows
    from shaped;

  if v_count > 0 then
    n := public.mon_raise('P1', 'adjudicated_reactivation', 'all', v_key,
      jsonb_build_object(
        'count', v_count,
        'collision_restored', v_collision,
        'superseded_by_reroute', v_reroute,
        'rows', v_rows,
        'why', 'a listing a recorded adjudication had retracted is ACTIVE again -- '
            || 'auto_recover_false_inactive, a scraper upsert, or a manual edit put it back. The '
            || 'per-row shape says what is actually wrong, because the two need different checks: '
            || 'COLLISION_RESTORED = the survivor is active too, so two cards for one source ad are '
            || 'served; SUPERSEDED_BY_REROUTE = the survivor has since been retired, so exactly ONE '
            || 'card is served and NOTHING is duplicated -- but it is served under the category this '
            || 'adjudication rejected; UNKNOWN_SIBLING = no pair row to compare, so it is '
            || 'unclassified, not clean.',
        'action', 'select * from ops_adjudicated_listing and compare against the row current state '
            || 'before reversing anything. For SUPERSEDED_BY_REROUTE, re-fetch the listing_url '
            || 'DIRECTLY and re-adjudicate from what the source publishes now -- a 404, a 5xx, a '
            || 'block or a redirect is UNKNOWN and must not flip a row in either direction. Do NOT '
            || 'resolve this by deleting the ledger row.'));
  end if;

  -- EVALUATED path, taken in BOTH branches: fold every open key of this kind that this run did not
  -- re-raise. With v_count = 0 the live set is empty and the whole kind clears.
  perform public.mon_resolve_stale_keys('adjudicated_reactivation',
            case when v_count > 0 then array[v_key] else '{}'::text[] end);

  return n;
end $function$;