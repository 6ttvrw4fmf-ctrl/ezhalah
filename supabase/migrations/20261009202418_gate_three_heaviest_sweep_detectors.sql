-- 🦅 Falcon 2026-10-09: the hourly detector sweep (jobid 38, :59) ran ~10 minutes of every hour on a
-- 2-vCPU database, and the user-facing search RPC slowed 3-5x inside that window
-- (ops_search_latency_sample: hourly means 0.75 s outside, 4-5 s inside; owner rule 2026-09-04:
-- monitoring must never materially degrade user-facing Search). Measured over the last 48 h
-- (ops_detector_timing, 48 sweeps): price_source_mismatch p50 68 s / max 307 s / 3,827 s total;
-- qa_oracle_combined_scope p50 33 s / max 164 s / 1,745 s; af_tri_state_violations p50 31 s /
-- max 185 s / 1,714 s -- the three heaviest of ~290, and the two the open
-- ungated_expensive_detector alerts (8480, 8863) already named, open since 10-06 under a deleted
-- routine. Together ~2.5 minutes of every sweep.
--
-- Nothing acts on their alerts within the hour (no automation repairs on them; the nightly
-- engineers read alerts once a day), so the sanctioned ~20 h gate (mon_claim_daily_slot, already
-- on 16 detectors, watched by mon_detect_stalled_daily_detector) loses no real detection latency.
-- The alert's own action text names this gate as the fix. The detectors' logic is untouched.
--
-- Needle edit, fail closed: each function's live body is read and the gate is inserted as its first
-- statement at a unique anchor. If an anchor is missing or already gated, the migration refuses.

do $mig$
declare
  r record;
  src text;
  n int;
  v_gate text;
begin
  for r in
    select * from (values
      ('mon_detect_price_source_mismatch',
       E'begin\n  -- ONE pass over the view answers both the price question and the barrier below it.'),
      ('mon_detect_qa_oracle_combined_scope',
       E'begin\n  for r in'),
      ('mon_detect_af_tri_state_violations',
       E'begin\n  foreach fld in array boolean_fields loop')
    ) as t(fn, anchor)
  loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = r.fn;
    if src is null then
      raise exception '% not found; refusing', r.fn;
    end if;
    if position('mon_claim_daily_slot' in src) > 0 then
      raise exception '% is already gated; refusing to gate twice', r.fn;
    end if;
    n := (length(src) - length(replace(src, r.anchor, ''))) / length(r.anchor);
    if n <> 1 then
      raise exception '% anchor found % times (expected 1); refusing to rewrite', r.fn, n;
    end if;
    v_gate := E'begin\n'
           || E'  -- ~20h gate (Falcon 2026-10-09): see the migration header. Watched by\n'
           || E'  -- mon_detect_stalled_daily_detector so this gate cannot silently wedge shut.\n'
           || format(E'  if not public.mon_claim_daily_slot(%L) then\n    return 0;\n  end if;\n', r.fn)
           || substr(r.anchor, length(E'begin\n') + 1);
    src := replace(src, r.anchor, v_gate);
    execute src;
  end loop;
end $mig$;

-- Verify the rewrite took, by execution of the same predicate the loop used.
do $chk$
declare fn text; src text;
begin
  foreach fn in array array['mon_detect_price_source_mismatch','mon_detect_qa_oracle_combined_scope','mon_detect_af_tri_state_violations'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn;
    if position(format('mon_claim_daily_slot(%L)', fn) in src) = 0 then
      raise exception 'post-check: % is not gated after the rewrite', fn;
    end if;
  end loop;
end $chk$;