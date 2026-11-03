-- ♻️ lifecycle 2026-11-03 (2/2): two more adjudications the source falsified, and dormant sites.
-- gathern GTH246249 (11638600, hidden 11-01 on two GONE reads) and wasalt WST5942484 (15912005,
-- owner «hide them» 10-19 on a no-detail read) are active again; a fresh-session CI spot-check read
-- each LIVE on its own page with canaries 5/5 (runs 41625749660, 41625746232). Recorded as
-- superseded with that evidence; the ledger rows stay. sadin (dormant: out of search) is skipped
-- like every liveness alarm skips a dormant site.
insert into public.ops_adjudication_superseded (source_table, listing_id, evidence) values
  ('gathern_residential_listings', 11638600,
   '{"why":"own page read LIVE after the 2026-11-01 hide (sweep 200 x2 on 11-02, fresh-session CI spot-check)","spot_check_run":41625749660,"canaries":"5/5"}'::jsonb),
  ('wasalt_residential_listings', 15912005,
   '{"why":"own page read LIVE after the 2026-10-19 retraction (fresh-session CI spot-check)","spot_check_run":41625746232,"canaries":"5/5"}'::jsonb)
on conflict do nothing;

CREATE OR REPLACE FUNCTION public.mon_detect_adjudicated_reactivation()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- A row in ops_adjudication_superseded was re-read live on its OWN page after the adjudication
  -- (2026-11-03): the source republished it, so it is not a reactivation to explain.
  with adj as (
    select j.tbl, j.listing_id, j.ledger, c.platform,
           case when c.res_id = j.listing_id and j.tbl = c.platform || '_residential_listings'
                then c.platform || '_commercial_listings'
                else c.platform || '_residential_listings' end as sib_tbl,
           case when c.res_id = j.listing_id and j.tbl = c.platform || '_residential_listings'
                then c.com_id else c.res_id end as sib_id
      from public.ops_adjudicated_listing j
      left join public.ops_res_com_collision_adjudication c
             on j.ledger = 'res_com_collision'
            and ((c.res_id = j.listing_id and j.tbl = c.platform || '_residential_listings')
              or (c.com_id = j.listing_id and j.tbl = c.platform || '_commercial_listings'))
     where not exists (select 1 from public.ops_adjudication_superseded s
                        where s.source_table = j.tbl and s.listing_id = j.listing_id)
       -- A dormant site's rows are out of search (ops_platform_is_dormant, as the liveness alarms
       -- skip it); they are judged again the day the site returns. No platform key contains "_".
       and not public.ops_platform_is_dormant(split_part(j.tbl, '_', 1))
  ), act as (
    select a.*,
           (xpath('/row/c/text()',
              query_to_xml(format('select count(*) c from public.%I where id = %s and active',
                                  a.tbl, a.listing_id), false, true, '')))[1]::text::int > 0 as is_active
      from adj a
  ), sib as (
    select a.*,
           case when a.sib_id is null then null
                else (xpath('/row/c/text()',
                       query_to_xml(format('select count(*) c from public.%I where id = %s and active',
                                           a.sib_tbl, a.sib_id),
                                    false, true, '')))[1]::text::int > 0
           end as sibling_active
      from act a
     where a.is_active
  ), shaped as (
    select s.tbl, s.listing_id, s.ledger, s.sib_id as com_id,
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
            || 'block or a redirect is UNKNOWN and must not flip a row in either direction. A row '
            || 'the source republished (own-page live reading after the adjudication) goes into '
            || 'ops_adjudication_superseded with its evidence. Do NOT resolve this by deleting the '
            || 'ledger row.'));
  end if;

  perform public.mon_resolve_stale_keys('adjudicated_reactivation',
            case when v_count > 0 then array[v_key] else '{}'::text[] end);

  return n;
end $function$;