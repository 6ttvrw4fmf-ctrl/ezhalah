-- A PERMANENT DELETE THAT NOTHING INDEPENDENTLY CONFIRMED (routine #11, 2026-09-23)
--
-- `scrapers/common/verify_deletions.py` (workflow verify-deletions.yml, pg_cron gh-verify-deletions,
-- `0 5 * * 0`) exists to re-probe a sample of already-deleted listings and catch a deleter whose
-- oracle is systematically wrong. `mon_detect_deleted_but_source_live` turns that into a P0 — but
-- ONLY on `verdict = 'live'`. A platform whose entire audit returns `unknown`, or that is never
-- sampled at all, therefore produces ZERO rows for it, forever.
--
-- That is docs/ops/LISTING_LIVENESS.md §9's lesson verbatim: **absence cannot be compared, so
-- silence reads as health**. The one apparatus that could catch a wrong deleter is dark on exactly
-- the platforms where it is dark, and nothing says so.
--
-- MEASURED 2026-09-23 over the four delete-ENABLED platforms:
--
--   platform   deleted all-time   audit samples   readable   unknown
--   aqar               5,807              0            0         0     <- NEVER_AUDITED
--   wasalt             4,015             40            0        40     <- AUDIT_BLIND
--   gathern            1,936            160          160         0
--   aqarcity             811            160          160         0
--
-- 9,822 of 12,569 permanent deletions (78%) carry no independent confirmation. Where the audit CAN
-- read, it works and matters: gathern's 160 readable samples found 3 LIVE (~1.9%).
--
-- WHAT THIS IS NOT. It is not a claim that live listings are being destroyed, and it must never be
-- read as one. Every one of those deletes carries its own per-row DIRECT verdict at delete time
-- (aqar: HTTP 200 + the «مغلق» body marker; wasalt: HTTP 404), which is the bar DELETION_SAFETY.md
-- sets. This detector says the CONFIRMATION layer is missing, which is a different and weaker
-- statement — and the honest one.
--
-- WHY IT IS NOT PERMISSION TO DELETE MORE SLOWLY OR FASTER. Per LISTING_LIVENESS.md §7 and
-- DELETION_SAFETY.md §6, a gap in the verifier is evidence about the VERIFIER. The remedy is to make
-- the audit able to read the source (wasalt answers 403/unknown from the verifier's egress; aqar is
-- never sampled), never to lower a floor or widen a kill.
--
-- The 0%-reactivation reading that led here: wasalt has rechecked 2,000 and reactivated 0 across 8
-- runs, while aqar reactivates ~15% and gathern ~14-33% of the same-shaped cohort at the same gate.
-- That may be perfectly genuine — wasalt's sibling oracle demonstrably discriminates (1,405 GONE vs
-- 145 LIVE in ops_stale_inactivation_probe, so wasalt does answer 200 for live listings from CI
-- egress) — but it is unconfirmed, and §7.1 is explicit that a zero is the number to distrust: it
-- can mean the protection was never exercised rather than that it worked.

create or replace function public.ops_lifecycle_deletion_audit_unconfirmed(
  p_inject jsonb default '[]'::jsonb)
returns table(
  platform text, deleted_in_window bigint, audit_samples bigint,
  readable bigint, unknown_ct bigint, shape text, injected boolean)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with injected as (
    select x->>'platform'                              as platform,
           coalesce((x->>'deleted_in_window')::bigint, 0) as deleted_in_window,
           coalesce((x->>'audit_samples')::bigint, 0)     as audit_samples,
           coalesce((x->>'readable')::bigint, 0)          as readable,
           coalesce((x->>'unknown_ct')::bigint, 0)        as unknown_ct,
           true                                           as injected
      from jsonb_array_elements(coalesce(p_inject, '[]'::jsonb)) x
     where x->>'platform' is not null
  ),
  real_rows as (
    select p.platform,
           coalesce(d.n, 0)        as deleted_in_window,
           coalesce(v.n, 0)        as audit_samples,
           coalesce(v.readable, 0) as readable,
           coalesce(v.unk, 0)      as unknown_ct,
           false                   as injected
      from public.platform_retention_policy p
      left join (
        select l.platform, count(*) n
          from public.cleanup_deletion_log l
         where l.deleted_at > now() - interval '30 days'
         group by 1
      ) d on d.platform = p.platform
      left join (
        select c.platform,
               count(*)                                                  n,
               count(*) filter (where c.verdict in ('dead', 'live'))      readable,
               count(*) filter (where c.verdict not in ('dead', 'live'))  unk
          from public.cleanup_deletion_verification c
         where c.verified_at > now() - interval '30 days'
         group by 1
      ) v on v.platform = p.platform
     where p.enabled
  ),
  all_rows as (select * from real_rows union all select * from injected)
  select a.platform, a.deleted_in_window, a.audit_samples, a.readable, a.unknown_ct,
         case
           -- Sampled, and not one sample could be read. The verifier ran and learned nothing.
           when a.audit_samples > 0 and a.readable = 0 then 'AUDIT_BLIND'
           -- EXPECTED-BUT-ABSENT: deletes happened and the audit never looked. A job that produces
           -- no row contributes nothing for anything to compare (LISTING_LIVENESS.md §9).
           when a.audit_samples = 0                    then 'NEVER_AUDITED'
         end as shape,
         a.injected
    from all_rows a
   -- Only a platform that actually destroyed something in the window can be unconfirmed about it.
   where a.deleted_in_window > 0
     and (a.audit_samples = 0 or a.readable = 0)
$fn$;

comment on function public.ops_lifecycle_deletion_audit_unconfirmed(jsonb) is
  'Delete-ENABLED platforms whose permanent deletions carry no readable independent post-delete '
  'confirmation in the last 30 days. AUDIT_BLIND = sampled, every sample unreadable. '
  'NEVER_AUDITED = deletes happened, the audit never sampled it. p_inject drives the self-test.';


create or replace function public.mon_detect_deletion_audit_unconfirmed()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  n int := 0;
  live text[] := '{}';
  r record;
  v_pos int;
  v_neg int;
begin
  -- SELF-TEST FIRST (the §2.5a precedent: a predicate that stops discriminating must say so rather
  -- than read as "nothing wrong"). Both directions, every sweep.
  select count(*) into v_pos from public.ops_lifecycle_deletion_audit_unconfirmed(
    '[{"platform":"__selftest_blind","deleted_in_window":10,"audit_samples":5,"readable":0,"unknown_ct":5}]'::jsonb)
   where injected and shape = 'AUDIT_BLIND';
  select count(*) into v_neg from public.ops_lifecycle_deletion_audit_unconfirmed(
    '[{"platform":"__selftest_ok","deleted_in_window":10,"audit_samples":5,"readable":5,"unknown_ct":0}]'::jsonb)
   where injected;

  if v_pos <> 1 or v_neg <> 0 then
    return public.mon_raise('P1', 'lifecycle_audit_predicate_blind', 'all',
      'lifecycle_audit_predicate_blind',
      jsonb_build_object(
        'why', 'ops_lifecycle_deletion_audit_unconfirmed() no longer distinguishes an unreadable '
            || 'audit from a readable one. Until this is repaired its silence means nothing.',
        'expected', 'a blind platform yields exactly 1 row; a fully-readable one yields 0',
        'got_blind_rows', v_pos, 'got_readable_rows', v_neg));
  end if;

  for r in
    select * from public.ops_lifecycle_deletion_audit_unconfirmed() where not injected
  loop
    live := live || ('lifecycle_deletion_audit_unconfirmed:' || r.platform);
    n := n + public.mon_raise('P1', 'lifecycle_deletion_audit_unconfirmed', r.platform,
      'lifecycle_deletion_audit_unconfirmed:' || r.platform,
      jsonb_build_object(
        'shape', r.shape,
        'deleted_in_window_30d', r.deleted_in_window,
        'audit_samples_30d', r.audit_samples,
        'readable_verdicts', r.readable,
        'unknown_verdicts', r.unknown_ct,
        'why', 'This platform permanently deleted listings and NOTHING independently confirmed '
            || 'those deletions. verify_deletions.py exists to re-probe a sample and catch a '
            || 'deleter whose oracle is systematically wrong, and mon_detect_deleted_but_source_live '
            || 'turns that into a P0 — but only on verdict=''live''. A platform whose audit is all '
            || 'unknown (AUDIT_BLIND) or never sampled (NEVER_AUDITED) produces zero rows for it, '
            || 'forever. LISTING_LIVENESS.md §9: absence cannot be compared, so silence reads as '
            || 'health.',
        'what_this_is_not', 'NOT a claim that live listings were destroyed. Every delete carries its '
            || 'own per-row DIRECT verdict at delete time (require_source_recheck=true), which is '
            || 'DELETION_SAFETY.md''s bar. This says the CONFIRMATION layer is missing — a weaker '
            || 'statement, and the honest one. Do not report it as a false-deletion incident.',
        'action', 'Make the audit able to READ this platform. For AUDIT_BLIND, the verifier''s egress '
            || 'cannot reach the source (wasalt answered unknown with a NULL http_status on 40/40 '
            || 'samples on 2026-09-20) — re-measure from the egress the job really uses, per '
            || 'AGENTS.md: an EGRESS BLOCKED note is a fact about the container, not the platform. '
            || 'For NEVER_AUDITED, find why verify_deletions.py never samples this platform.',
        'do_not', 'Do NOT stop, slow or widen the sanctioned deleter on account of this alert, and '
            || 'do NOT raise or lower any cap, floor or threshold to clear it. A gap in the verifier '
            || 'is evidence about the VERIFIER (LISTING_LIVENESS.md §7, DELETION_SAFETY.md §6). Do '
            || 'NOT backfill cleanup_deletion_verification with verdicts nobody observed — a forged '
            || 'confirmation is worse than an absent one.',
        'founding_measurement_2026_09_23', 'aqar 5,807 deleted / 0 audit samples ever (NEVER_AUDITED); '
            || 'wasalt 4,015 deleted / 40 samples / 0 readable (AUDIT_BLIND); gathern 1,936 / 160 / '
            || '160 readable, of which 3 came back LIVE; aqarcity 811 / 160 / 160 readable. '
            || '9,822 of 12,569 permanent deletions (78%) unconfirmed.'));
  end loop;

  perform public.mon_resolve_stale_keys('lifecycle_deletion_audit_unconfirmed', live);
  return n;
end
$fn$;

comment on function public.mon_detect_deletion_audit_unconfirmed() is
  'P1 lifecycle_deletion_audit_unconfirmed: a delete-ENABLED platform destroyed listings that no '
  'readable post-delete audit ever confirmed. Self-tests its own predicate in BOTH directions every '
  'sweep and raises lifecycle_audit_predicate_blind if it stops discriminating.';


-- A detector nothing calls is decoration (mon_detect_orphaned_detectors fires on one), so the
-- roster entry lands in the SAME migration.
do $mig$
declare src text; before_len int;
begin
  select prosrc into src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;

  if position('mon_detect_deletion_audit_unconfirmed' in src) > 0 then
    return; -- already registered
  end if;

  before_len := length(src);
  src := replace(src,
    '''mon_detect_cleanup_run_unrecorded'',',
    '''mon_detect_cleanup_run_unrecorded'',''mon_detect_deletion_audit_unconfirmed'',');

  if length(src) = before_len then
    raise exception 'roster anchor not matched -- refusing to leave the detector orphaned';
  end if;

  execute format('create or replace function public.mon_run_all_detectors() returns jsonb language plpgsql as %L', src);
end $mig$;
