-- unknown_treated_as_dead counted an ADJUDICATED de-duplication as a death on unknown evidence,
-- and its own prescribed action would have UNDONE the repair.
--
-- On 2026-09-13 07:36:30 a res/com collision repair retired seven duplicate rows across amaall and
-- arkaan, each recorded in public.ops_res_com_collision_adjudication with verdict='REPAIRABLE' and
-- the side actually retired. Eight seconds later those rows carried active=false. At 07:59 this
-- detector raised two P1s:
--
--   amaall_commercial_listings   deactivated_48h 6, without_direct_evidence 6
--   arkaan_residential_listings  deactivated_48h 1, without_direct_evidence 1
--
-- Both are false. A collision repair is not a claim about the SOURCE at all: it says our two records
-- of ONE listing_url disagreed about which table the ad belongs in, and retires the copy this run
-- did not classify into. The URL stays served by the sibling — verified on all seven, each has
-- exactly one active twin holding the identical listing_url — so nothing left the user's view and
-- nothing entered the retention window on an unknown.
--
-- WHY THIS IS NOT COSMETIC. The alert's `action` reads "Re-probe the affected rows by DIRECT fetch
-- and RESTORE every one the source still serves". Followed faithfully on these seven, that restores
-- the retired duplicate, re-creates the double card that migration 20260830140110 repaired, and
-- trips mon_detect_res_com_collision_repair_regression() — which was extended THIS MORNING
-- (20260913074036) precisely to watch these seven rows for exactly that. One detector's remedy was
-- another's alarm condition.
--
-- And the cost of leaving it is the cost this repository has already paid once: AGENTS.md opens on
-- nine dark detectors reading as a clean bill of health. A P1 that fires daily on correct,
-- ledgered maintenance is the same failure from the other side — the single detector that states
-- §0 (UNKNOWN IS NOT DEAD) becomes the one nobody believes.
--
-- THE DISCRIMINATOR IS AN AFFIRMATIVE RECORD, NOT AN INFERENCE. A row is excluded only when
-- ops_res_com_collision_adjudication carries a REPAIRABLE verdict naming THIS platform, THIS side,
-- and THIS id, adjudicated within an hour of the deactivation. No ledger row, wrong side, wrong id,
-- or an adjudication from another week — and the row still counts. The window matters: without it,
-- August's dealapp/sadin adjudications would excuse a fresh absence-kill on the same id forever.
--
-- Nothing is hidden. deactivated_48h still counts every deactivation, and the excluded rows are
-- reported in their own field, so the number is visible rather than silently subtracted.
--
-- MEASURED IN PRODUCTION BEFORE APPLYING (2026-09-13, 48h window, the four tables then lit):
--
--   table                             total  adjudicated  old_count  new_count
--   amaall_commercial_listings            6            6          6          0   <- clears
--   arkaan_residential_listings           1            1          1          0   <- clears
--   aqaratikom_residential_listings       1            0          1          1   <- still fires
--   satel_residential_listings            3            0          3          3   <- still fires
--
-- Both directions, on real rows. The genuine absence-only kills (docs/ops/LISTING_LIVENESS.md §1,
-- ops_incident #84) stay exactly as loud as they were.
create or replace function public.mon_detect_unknown_treated_as_dead()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n           int := 0;
  live        text[] := '{}';
  r           record;
  v_no_ev     bigint;
  v_unknown   bigint;
  v_total     bigint;
  v_dedup     bigint;
begin
  for r in
    select c.table_name as tbl,
           regexp_replace(c.table_name, '_(residential|commercial)_listings$', '') as platform,
           case when c.table_name like '%\_residential\_listings'
                then 'residential' else 'commercial' end as side,
           case when c.table_name like '%\_residential\_listings'
                then 'res_id' else 'com_id' end as idcol,
           coalesce(g.strategy, '(unregistered)') as strategy
      from information_schema.columns c
      left join public.ops_liveness_registry g
        on g.platform = regexp_replace(c.table_name, '_(residential|commercial)_listings$', '')
     where c.table_schema = 'public'
       and c.column_name = 'deactivated_at'
       and c.table_name like '%\_listings'
       and coalesce(g.strategy, '(unregistered)') <> 'DIRECT_REVISIT'
       and coalesce(g.strategy, '(unregistered)') <> 'CANDIDATE_PLUS_DIRECT'
  loop
    execute format($q$
      with dead as (
        select t.id, t.ad_number, t.deactivated_at
          from public.%1$I t
         where t.active = false and t.deactivated_at >= now() - interval '48 hours'
      ),
      classified as (
        select d.id,
               -- An ADJUDICATED de-duplication: our own bookkeeping, not a verdict about the
               -- source. Keyed on the ledger row that performed it — platform, side, id — and
               -- bounded to the hour around the deactivation so an old adjudication can never
               -- excuse a fresh kill on the same id.
               exists (
                 select 1 from public.ops_res_com_collision_adjudication a
                  where a.platform = %2$L
                    and a.retired_side = %3$L
                    and a.verdict = 'REPAIRABLE'
                    and a.%4$I = d.id
                    and a.adjudicated_at between d.deactivated_at - interval '1 hour'
                                            and d.deactivated_at + interval '1 hour'
               ) as dedup,
               exists (
                 select 1 from public.ops_stale_inactivation_probe p
                  where p.source_table = %1$L and p.ad_number = d.ad_number
                    and p.verdict = 'GONE'
                    and p.probed_at >= d.deactivated_at - interval '1 hour'
               ) as gone,
               exists (
                 select 1 from public.ops_stale_inactivation_probe p
                  where p.source_table = %1$L and p.ad_number = d.ad_number
                    and p.verdict = 'UNKNOWN'
                    and p.probed_at >= d.deactivated_at - interval '1 hour'
               ) as unk
          from dead d
      )
      select count(*) filter (where not dedup and not gone),
             count(*) filter (where not dedup and unk),
             count(*),
             count(*) filter (where dedup)
        from classified
    $q$, r.tbl, r.platform, r.side, r.idcol)
      into v_no_ev, v_unknown, v_total, v_dedup;

    if coalesce(v_no_ev, 0) > 0 or coalesce(v_unknown, 0) > 0 then
      live := live || ('unknown_treated_as_dead:' || r.tbl);
      n := n + public.mon_raise('P1', 'unknown_treated_as_dead', r.platform,
        'unknown_treated_as_dead:' || r.tbl,
        jsonb_build_object(
          'source_table', r.tbl,
          'liveness_strategy', r.strategy,
          'deactivated_48h', v_total,
          'without_direct_evidence', v_no_ev,
          'oracle_said_unknown', v_unknown,
          'adjudicated_dedup_excluded', v_dedup,
          'why', 'UNKNOWN IS NOT DEAD. This platform declares liveness strategy "'
              || r.strategy || '" in ops_liveness_registry, which means we know only that the ad '
              || 'was (or was not) in our crawl — absence is EvidenceKind.ABSENCE and decide() '
              || 'returns action="none" for it, always. These rows were nevertheless set '
              || 'active=false, and no GONE verdict was recorded against their ad_number in '
              || 'ops_stale_inactivation_probe at the time. A timeout, a 403/429/5xx, a shell '
              || 'body, a parser failure or a crawl that simply did not run all look exactly '
              || 'like this.',
          'why_it_matters', 'A deactivation is recoverable. What follows it is not: '
              || 'the row now ages toward the 30-day retention window, and at the end of that '
              || 'window scrapers/common/cleanup.py deletes it permanently. Of 21,371 rows a '
              || 'legacy age-and-strike deleter removed, 10,617 left no source key at all and '
              || 'are unknowable in either direction.',
          'action', 'Re-probe the affected rows by DIRECT fetch of each listing''s own URL and '
              || 'RESTORE every one the source still serves (a restorative write is never gated). '
              || 'Then give the platform a real oracle — pass verify_gone= in its scraper, or move '
              || 'it off CRAWL_PRESENCE_ONLY. Do NOT resolve this by widening the crawl, relaxing '
              || 'the grace count, or deleting anything.',
          'excluded_note', 'adjudicated_dedup_excluded rows are NOT part of the counts above and '
              || 'must NOT be restored. Each is a res/com collision repair recorded in '
              || 'ops_res_com_collision_adjudication (verdict REPAIRABLE) within an hour of the '
              || 'deactivation: our two records of one listing_url disagreed about the table, and '
              || 'the copy this run did not classify into was retired while the sibling keeps '
              || 'serving the same URL. Restoring one re-creates the duplicate card that migration '
              || '20260830140110 repaired and trips '
              || 'mon_detect_res_com_collision_repair_regression().',
          'boundary', 'mon_detect_prune_kill_without_source_verdict() asks a different question '
              || '(was verify_gone wiring dropped on an oracle-REQUIRED platform?) over only the '
              || 'three tables in ops_oracle_required_platform, and routes to routine #3. This '
              || 'detector is platform-agnostic and routes to routine-11-lifecycle.'));
    end if;
  end loop;

  perform public.mon_resolve_stale_keys('unknown_treated_as_dead', live);
  return n;
end;
$function$;
