-- CORRECTION to the header comment of 20260811073933, recorded on the object itself so the next
-- session reads the verdict instead of re-deriving it (AGENTS.md: don't re-discover a settled fact).
--
-- That migration asserted the aqar cohort was "a PROVEN Ezhalah-side defect ... while aqar itself
-- publishes «سنوي»". That assertion was WRONG, and it was tested rather than believed: the 64
-- residential ad numbers were re-fetched through the production enricher from a runner aqar serves
-- (aqar-stub-recovery run 31469756776, --include-price --dry-run, 2026-08-11 07:38Z). Result:
--
--     fetched=64 written=0 unfetchable=0 no_gain=60 of 64
--
-- 60 of 64 came back "aqar publishes nothing further for this listing". Exactly ONE row (ad 6695179)
-- would have gained a rent_period at all, and only bundled with a price rewrite 45,000 -> 38,000.
-- So for this cohort the missing period is a SOURCE LIMITATION, not lost data: aqar does not state
-- one. Under the fidelity rule an honest NULL is the correct stored value and «سنوي» must NOT be
-- invented — no write was made.
--
-- What remains is therefore a PRODUCT gap, not a data bug, and it is an owner decision (routine
-- §16 stop condition 2 — two valid choices that materially change user behaviour): a rent listing
-- whose source never stated a period is unreachable the moment a user picks Annual or Monthly.
-- Options are (a) leave as-is, (b) surface period-less rentals under both chips, (c) add an
-- "unspecified" chip. Do not pick one of these inside an autonomous run.
--
-- The detector stays exactly as it is: the cohort is real, users cannot reach these listings with a
-- period selected, and it must not be allowed to grow unseen. It is P2 and its own payload already
-- says "Do NOT fix by defaulting the period".
comment on function public.mon_detect_rent_period_unreachable() is
  'Priced Rent listings unreachable by BOTH the annual and monthly Filter branches (rent_period_ar '
  'neither «سنوي» nor «شهري»). Wired into mon_run_all_detectors 2026-08-11; the equivalent check in '
  'mon_source_is_truth_violations() was never called by anything, so this cohort had never alerted. '
  'VERDICT 2026-08-11 (aqar-stub-recovery run 31469756776, --include-price --dry-run, 64/64 fetched, '
  '60 "aqar publishes nothing further"): for the aqar cohort the absent period is a SOURCE limitation, '
  'not lost data — NULL is the correct value and «سنوي» must never be defaulted in. The residual '
  'searchability gap is an OWNER product decision, not an engineering repair. Baseline at ship time: '
  '77 rows (aqar 75, souq24 1, october 1).';

do $$
begin
  if obj_description('public.mon_detect_rent_period_unreachable()'::regprocedure, 'pg_proc') is null then
    raise exception 'verdict comment was not attached to mon_detect_rent_period_unreachable';
  end if;
end $$;
