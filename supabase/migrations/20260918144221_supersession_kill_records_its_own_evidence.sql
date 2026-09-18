-- ops_incident #275 — an AUTOMATIC res/com supersession left no evidence, so the routine's
-- highest-value P1 counted it as a kill on unknown evidence.
--
-- MEASURED 2026-09-18 (routine-11-lifecycle), over the seven platforms wired to
-- db.retire_superseded_siblings(): 16 retirements in the last 30 days, EVERY ONE evidence-free,
-- and every one confirmed a genuine supersession by an ACTIVE sibling row carrying the same
-- ad_number — sadin_commercial 5, amaall_residential 6, dealapp_residential 4,
-- arkaan_residential 1. Each counts as `without_direct_evidence` in
-- mon_detect_unknown_treated_as_dead for the 48h after it happens.
--
-- The exclusion this detector already had (migration 20260913144532) reads
-- ops_res_com_collision_adjudication, and the ONLY writer of those rows is a human/agent session.
-- It works exactly as designed — it simply has nothing to read for an automatic retirement. So the
-- suppression for the automatic path was, in practice, written by hand (arkaan AK907) or not at all
-- (arkaan AK920).
--
-- THE VERDICT IS 'SUPERSEDED', DELIBERATELY NOT 'GONE'. A supersession is not a statement about
-- the source: the listing's own URL is still served, by the sibling that superseded this copy.
-- Filing it as GONE would put a false source verdict into the one ledger every other detector
-- reads as source truth — mon_detect_prune_kill_without_source_verdict,
-- mon_detect_deletion_clock_without_evidence and ops_lifecycle_false_resurrection all key on
-- verdict = 'GONE'. It is not 'AMBIGUOUS' either: retire_superseded_siblings() reserves that word
-- for the classified-both-ways case it refuses to touch at all.
--
-- This does NOT widen the detector to ignore missing_count = 0 kills (ops_incident #275's own
-- must_not). The exclusion is keyed exactly like the dedup one it sits beside: an AFFIRMATIVE
-- ledger row, for this source_table and ad_number, written within an hour of the deactivation, by
-- the actor that performed it. An old supersession can never excuse a fresh kill on the same id,
-- and the count is REPORTED in its own payload field rather than silently subtracted.

alter table public.ops_stale_inactivation_probe
  drop constraint if exists ops_stale_inactivation_probe_verdict_check;
alter table public.ops_stale_inactivation_probe
  add constraint ops_stale_inactivation_probe_verdict_check
  check (verdict = any (array['LIVE'::text, 'GONE'::text, 'AMBIGUOUS'::text, 'UNKNOWN'::text,
                              'SUPERSEDED'::text]));

CREATE OR REPLACE FUNCTION public.mon_detect_unknown_treated_as_dead()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n           int := 0;
  live        text[] := '{}';
  r           record;
  v_no_ev     bigint;
  v_unknown   bigint;
  v_total     bigint;
  v_dedup     bigint;
  v_super     bigint;
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
               -- The SAME de-duplication performed AUTOMATICALLY, by
               -- db.retire_superseded_siblings() at scrape time (ops_incident #275). Its evidence
               -- is the row that function now writes for every ad it retires: verdict SUPERSEDED,
               -- oracle res_com.sibling_classified_this_run. Keyed and time-bounded exactly like
               -- the hand-written adjudication above, so it can excuse only the kill it performed.
               exists (
                 select 1 from public.ops_stale_inactivation_probe p
                  where p.source_table = %1$L and p.ad_number = d.ad_number
                    and p.verdict = 'SUPERSEDED'
                    and p.probed_at between d.deactivated_at - interval '1 hour'
                                        and d.deactivated_at + interval '1 hour'
               ) as superseded,
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
      select count(*) filter (where not dedup and not superseded and not gone),
             count(*) filter (where not dedup and not superseded and unk),
             count(*),
             count(*) filter (where dedup),
             count(*) filter (where superseded and not dedup)
        from classified
    $q$, r.tbl, r.platform, r.side, r.idcol)
      into v_no_ev, v_unknown, v_total, v_dedup, v_super;

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
          'auto_supersession_excluded', v_super,
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
          'excluded_note', 'adjudicated_dedup_excluded and auto_supersession_excluded rows are NOT '
              || 'part of the counts above and must NOT be restored. Each is a res/com collision '
              || 'repair: our two records of one listing_url disagreed about the table, and the '
              || 'copy this run did not classify into was retired while the sibling keeps serving '
              || 'the same URL. The first kind was adjudicated by hand into '
              || 'ops_res_com_collision_adjudication (verdict REPAIRABLE); the second was '
              || 'performed automatically by db.retire_superseded_siblings() at scrape time and '
              || 'carries its own ops_stale_inactivation_probe row (verdict SUPERSEDED, oracle '
              || 'res_com.sibling_classified_this_run) written within the hour around the '
              || 'deactivation. Restoring one re-creates the duplicate card that migration '
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
