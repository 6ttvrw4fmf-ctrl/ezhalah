-- CORRECTION to 20260923235943, same day, same routine.
--
-- That migration's action text told the reader, for NEVER_AUDITED: "find why verify_deletions.py
-- never samples this platform". Measured immediately afterwards, that is the WRONG instruction for
-- the founding case and would have cost the next responder the whole investigation:
--
--   scrape_runs 49294, verify_deletions:aqar, 2026-09-20 05:03:14, ok=true
--     "sampled=0 ... | no deletions logged for this platform in the last 30d — nothing to verify"
--
-- aqar's FIRST deletion in the window landed 2026-09-20 08:00 — three hours AFTER that run. Before
-- it, aqar had deleted nothing for 30+ days because the anomaly guard aborted every cleanup run
-- (ops_incident #195), so "nothing to verify" was true and correct on 08-30, 09-06, 09-13 and 09-20.
-- The backlog drain then ran 09-21/22/23 at 02:00 (1,825 + 1,823 + 1,702). The verifier is WEEKLY
-- (pg_cron gh-verify-deletions, `0 5 * * 0`), so the next chance to sample any of it is 09-27 05:00.
--
-- aqar is therefore a LAG, not a broken sampler — and the alert is still right to fire, because the
-- rows really are destroyed and really are unconfirmed. At ~1,800 deletes/day against a 40-row
-- weekly sample, roughly 12,000 aqar rows will be permanently gone before one is independently
-- checked. That is the finding. "The sampler is broken" is not.
--
-- docs/ops/LISTING_LIFECYCLE_ENGINEER.md §8.3: a P0 whose remedy field sends every responder down a
-- path that does not work is worse than a P0 with no remedy text. This migration exists only to
-- stop this detector being that.

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
  v_last_run text;
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
    -- Hand the responder the verifier's OWN last word about this platform, so the first question
    -- ("did the job run, and what did it say?") is answered in the alert instead of investigated.
    select coalesce(
             'last verify_deletions:' || r.platform || ' run ' || s.started_at::text
             || ' ok=' || s.ok::text || ' — ' || coalesce(s.notes, '(no notes)'),
             'no verify_deletions:' || r.platform || ' run has EVER been recorded')
      into v_last_run
      from public.scrape_runs s
     where s.platform = 'verify_deletions:' || r.platform
     order by s.started_at desc
     limit 1;

    live := live || ('lifecycle_deletion_audit_unconfirmed:' || r.platform);
    n := n + public.mon_raise('P1', 'lifecycle_deletion_audit_unconfirmed', r.platform,
      'lifecycle_deletion_audit_unconfirmed:' || r.platform,
      jsonb_build_object(
        'shape', r.shape,
        'deleted_in_window_30d', r.deleted_in_window,
        'audit_samples_30d', r.audit_samples,
        'readable_verdicts', r.readable,
        'unknown_verdicts', r.unknown_ct,
        'verifier_last_word', coalesce(v_last_run, '(lookup failed)'),
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
        'read_verifier_last_word_first', 'NEVER_AUDITED has TWO causes and they need opposite '
            || 'responses, so read the verifier_last_word field BEFORE investigating anything. '
            || '(a) LAG — the job ran, said "no deletions logged ... nothing to verify", and was '
            || 'RIGHT at the time, because the deletions started after it. verify_deletions is '
            || 'WEEKLY (gh-verify-deletions, 0 5 * * 0), so a backlog drain that begins on a Monday '
            || 'is unconfirmed until the following Sunday. Founding case: aqar''s first deletion '
            || 'landed 2026-09-20 08:00, three hours after that day''s 05:03 run, and the drain then '
            || 'removed ~1,800/day. Nothing is broken — but ~12,000 rows will be permanently gone '
            || 'before one is sampled, against a 40-row weekly sample, and THAT is the finding. '
            || '(b) BROKEN — the job errored, never ran at all, or ran with rows available and '
            || 'still sampled nothing. Only in case (b) is there a sampler to fix.',
        'action', 'AUDIT_BLIND: the verifier''s egress cannot read the source — wasalt answered '
            || 'unknown with a NULL http_status on 40/40 samples on 2026-09-20. Re-measure from the '
            || 'egress the job really uses (CI), per AGENTS.md: an EGRESS BLOCKED note is a fact '
            || 'about the container that wrote it, not about the platform. NEVER_AUDITED: classify '
            || 'it with read_verifier_last_word_first, then fix the sampler (b) or note the coverage '
            || 'the weekly cadence actually buys at the current delete rate (a).',
        'do_not', 'Do NOT stop, slow or widen the sanctioned deleter on account of this alert, and '
            || 'do NOT raise or lower any cap, floor or threshold to clear it. A gap in the verifier '
            || 'is evidence about the VERIFIER (LISTING_LIVENESS.md §7, DELETION_SAFETY.md §6). Do '
            || 'NOT backfill cleanup_deletion_verification with verdicts nobody observed — a forged '
            || 'confirmation is worse than an absent one.',
        'founding_measurement_2026_09_23', 'aqar 5,807 deleted / 0 audit samples (NEVER_AUDITED, '
            || 'cause (a) LAG — verified against scrape_runs 49294); wasalt 4,015 deleted / 40 '
            || 'samples / 0 readable (AUDIT_BLIND); gathern 1,936 / 160 / 160 readable, of which 3 '
            || 'came back LIVE; aqarcity 811 / 160 / 160 readable. 9,822 of 12,569 permanent '
            || 'deletions (78%) unconfirmed.'));
  end loop;

  perform public.mon_resolve_stale_keys('lifecycle_deletion_audit_unconfirmed', live);
  return n;
end
$fn$;

comment on function public.mon_detect_deletion_audit_unconfirmed() is
  'P1 lifecycle_deletion_audit_unconfirmed: a delete-ENABLED platform destroyed listings that no '
  'readable post-delete audit ever confirmed. Carries the verifier''s own last run notes so a LAG '
  '(weekly cadence, deletions began after the last run) is not investigated as a broken sampler. '
  'Self-tests its predicate in BOTH directions every sweep (lifecycle_audit_predicate_blind).';
