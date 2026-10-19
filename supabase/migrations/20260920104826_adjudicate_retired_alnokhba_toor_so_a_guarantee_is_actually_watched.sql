-- routine-7-seam, 2026-09-20. Orphaned-guarantee rotation (SYSTEMS_SEAM_ENGINEER.md PART 1/PART 3.3).
--
-- alert repair_guarantee_unwatched (id 1063) has been OPEN for 23 days naming 30 registered repairs
-- whose invariant nothing watches. Two of them are the retired-platform retractions:
--
--   20260714    "The 5 alnokhba rows (638603-638607) retired on 2026-07-14 stay inactive;
--                the retired platform must not resurrect them."
--   20260714-2  "The 23 toor rows deactivated on 2026-07-14 stay inactive."
--
-- Both carried detector = NULL. A one-shot repair is a CLAIM about an invariant; only a standing
-- detector proves it still holds. These two had neither, for 68 days.
--
-- WHY NOT mon_detect_false_resurrection: it looks correct at a glance and is the wrong answer. Its
-- predicate requires a DIRECT GONE probe of the listing's own URL (last_verified_alive_at vs the
-- gone verdict). alnokhba and toor are retired platforms with no death oracle at all -- neither
-- appears in ops_platform_liveness_coverage -- so that detector can never evaluate these rows.
-- Pointing the registry at it would satisfy the unwatched predicate while watching nothing, which
-- is the "a pointer reads as coverage" shape AGENTS.md records (BARRIER_ENGINEER PART 1.11).
--
-- The detector that GENUINELY covers "a deliberately withdrawn row must not come back" is
-- mon_detect_adjudicated_reactivation(), which walks ops_adjudicated_listing and raises when any
-- adjudicated row is active again -- regardless of which path reactivated it (the recovery job, a
-- scraper upsert, or a hand edit). It is already on the mon_run_all_detectors() roster.
--
-- To be watched by it, the rows must be IN the register. They were never entered -- which is the
-- same omission AGENTS.md records for the rakez off-plan withdrawal of 2026-09-14 ("HIDING A LISTING
-- IS A TWO-PART ACT"): the deactivation happened, the register did not. These rows are not at risk
-- from auto_recover_false_inactive() today only because its predicate is bounded to
-- deactivated_at >= now() - 24h and these are from July. That is an accident of timing, not
-- protection.
--
-- Registration is purely additive: it changes no listing's active state. Measured immediately
-- before this migration: alnokhba 6 rows / 0 active, toor 29 rows / 0 active.
--
-- awal (20260728190000, "awal rows whose source URLs rotted stay inactive") is deliberately NOT
-- touched here: awal is a LIVE platform (51 active, CRAWL_PRESENCE_ONLY) and the invariant covers an
-- unidentified subset. Freezing rows there could strand a legitimate recovery. It stays unwatched
-- and is reported as such rather than given a detector that does not fit.

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence, retracted_at)
select t.src, t.id,
       'Platform retired 2026-07-14; deactivated by the retirement migration and must not resurrect.',
       jsonb_build_object(
         'registered_by',   'routine-7-seam orphaned-guarantee rotation 2026-09-20',
         'repair_version',  t.repair_version,
         'active_at_registration', false,
         'why',             'The retirement migration deactivated these rows but never entered them '
                         || 'in the adjudication register, so nothing distinguished the deliberate '
                         || 'withdrawal from an accidental flip and no detector watched the '
                         || 'invariant. Registering them makes the decision explicit and puts them '
                         || 'under mon_detect_adjudicated_reactivation().')
       , timestamptz '2026-07-14 00:00:00+00'
from (
  select 'alnokhba_residential_listings' as src, id, '20260714'   as repair_version
    from public.alnokhba_residential_listings where not active
  union all
  select 'toor_residential_listings', id, '20260714-2'
    from public.toor_residential_listings where not active
  union all
  select 'toor_commercial_listings', id, '20260714-2'
    from public.toor_commercial_listings where not active
) t
where not exists (select 1 from public.ops_adjudicated_retraction a
                   where a.source_table = t.src and a.listing_id = t.id);

-- Point the two guarantees at the detector that genuinely covers them, and record the verdict with
-- the evidence that earned it (the registry's trigger trg_ops_registry_verdict_is_earned requires
-- evidence to clear a violation; these two were detector_missing, and the same discipline applies).
update public.ops_repair_guarantee_registry r
   set detector         = 'mon_detect_adjudicated_reactivation',
       last_verified_at = now(),
       last_verdict     = 'holds',
       last_detail      = jsonb_build_object(
         'by', 'routine-7-seam 2026-09-20 oldest-first rotation',
         'evidence_recheck', case r.repair_version
             when '20260714'   then 'alnokhba_residential_listings: 6 rows, 0 active (ids 638603-638607 all inactive)'
             else                   'toor_residential_listings: 25 rows, 0 active; toor_commercial_listings: 4 rows, 0 active'
           end,
         'method', 'counted active rows in the listing tables directly, then enrolled every inactive '
                || 'row in ops_adjudicated_retraction so mon_detect_adjudicated_reactivation() can '
                || 'evaluate the invariant on every sweep',
         'detector_was', 'NULL -- registered but unwatched for 68 days (alert repair_guarantee_unwatched, open since 2026-08-28)',
         'not_used', 'mon_detect_false_resurrection: requires a DIRECT GONE probe; these platforms '
                  || 'have no death oracle, so it could never evaluate these rows')
 where r.repair_version in ('20260714', '20260714-2');

do $verify$
declare
  v_alnokhba_active int; v_toor_active int; v_registered int; v_unwatched int; v_roster text;
begin
  select count(*) into v_alnokhba_active from public.alnokhba_residential_listings where active;
  select (select count(*) from public.toor_residential_listings where active)
       + (select count(*) from public.toor_commercial_listings where active) into v_toor_active;
  if v_alnokhba_active <> 0 or v_toor_active <> 0 then
    raise exception 'invariant does not hold: alnokhba active=%, toor active=% — refusing to record holds',
      v_alnokhba_active, v_toor_active;
  end if;

  select count(*) into v_registered from public.ops_adjudicated_listing
   where tbl in ('alnokhba_residential_listings','toor_residential_listings','toor_commercial_listings');
  if v_registered < 35 then
    raise exception 'expected >= 35 adjudicated rows for the retired platforms, found %', v_registered;
  end if;

  -- the detector must exist AND be reachable, or we have swapped one unwatched row for another
  select pg_get_functiondef(p.oid) into v_roster from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors' limit 1;
  if position('mon_detect_adjudicated_reactivation' in coalesce(v_roster,'')) = 0 then
    raise exception 'mon_detect_adjudicated_reactivation is not on the mon_run_all_detectors roster';
  end if;

  select count(*) into v_unwatched from public.ops_repair_guarantee_registry r
   where r.repair_version in ('20260714','20260714-2')
     and (coalesce(r.detector,'') = ''
          or not exists (select 1 from pg_proc p
                          where p.pronamespace='public'::regnamespace and p.proname = r.detector));
  if v_unwatched <> 0 then
    raise exception 'the two guarantees are still unwatched after the update (%)', v_unwatched;
  end if;

  raise notice 'verified: alnokhba/toor 0 active, % adjudicated rows registered, both guarantees now watched', v_registered;
end $verify$;