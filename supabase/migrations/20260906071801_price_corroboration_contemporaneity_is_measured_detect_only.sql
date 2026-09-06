-- Data Integrity Engineer, 2026-09-06. DETECT-ONLY half.
--
-- THE DEFECT. mon_price_source_corroboration publishes `drift_meaningful`, and the whole P1/P2
-- split of mon_detect_price_source_mismatch rests on it:
--   P1 = "that evidence is refreshed with the row (contemporaneous) ... Repair to the
--         source-displayed value"
--   P2 = "the evidence is a capture-time snapshot ... it must NEVER be repaired to the snapshot
--         value: that would overwrite a fresher source read with an older one"
-- On the two wasalt arms the flag is the literal `true`. It is ASSERTED, never measured. The
-- migration that introduced the split (20260813113844) states the assertion in words --
-- "wasalt 9, drift_meaningful = TRUE (ar_data is refreshed with the row: a real disagreement)" --
-- and it is false. ar_data is written by a SEPARATE job (cron 39 gh-wasalt-enrich-ar) and carries
-- its own ar_fetched_at; the crawl re-captures the row on its own schedule.
--
-- MEASURED ON PRODUCTION TODAY, wasalt Buy arm, 39,257 active rows:
--   ar_fetched_at is on average 56.3 DAYS OLDER than the row's own raw_captured_at,
--   37,263 of 39,257 (94.9%) are more than 7 days older, worst 72 days.
-- And the split it produces is unambiguous:
--   evidence contemporaneous (<=48h): 1,436 rows, 1,436 agree EXACTLY, zero disagreements
--   evidence stale:                  37,821 rows, 9 disagree by >=10x
-- The rent arm behaves identically (25 contemporaneous, all agree; 1 stale >=10x).
--
-- SO EVERY ROW IN THE P1 IS A MISCLASSIFICATION, and the P1 has stood red for 26 days telling
-- whoever acts on it to overwrite nine fresh prices (579,000) with a 72-day-old figure a thousand
-- times smaller (579) -- exactly the corruption the P2 arm's own text forbids.
--
-- THIS MIGRATION CHANGES NO CLASSIFICATION. It only adds the barrier, so the barrier can be
-- watched failing on the live defect before the repair lands (§G.9: a mutation must be WATCHED
-- to be caught). The repair follows in its own migration.
--
-- The check is EXECUTED against every row of the real view, not grepped: it compares the flag the
-- view publishes against the timestamp relation the flag claims to describe. A constant `true`
-- fails on the stale rows; a constant `false` fails on the contemporaneous ones. Neither mutation
-- survives, and the vacuity limb refuses to let the comparison pass by being empty.
create or replace function public.mon_detect_price_source_mismatch()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_under bigint; v_over bigint; v_minor bigint; v_checked bigint; v_drift_base bigint;
  v_stale bigint; n int := 0; s jsonb;
  v_flag_wrong bigint; v_contemporaneous bigint; v_stale_evidence bigint;
begin
  select count(*) filter (where verdict = 'stored_understated_10x' and drift_meaningful),
         count(*) filter (where verdict = 'stored_overstated_10x'  and drift_meaningful),
         count(*) filter (where verdict = 'differs_minor' and drift_meaningful),
         count(*),
         count(*) filter (where drift_meaningful),
         count(*) filter (where verdict in ('stored_understated_10x','stored_overstated_10x')
                            and not drift_meaningful)
    into v_under, v_over, v_minor, v_checked, v_drift_base, v_stale
    from public.mon_price_source_corroboration;

  -- P1: a >=10x disagreement whose evidence is refreshed WITH the row, so the two values are
  -- genuinely contemporaneous and one of them is wrong.
  if (v_under + v_over) > 0 then
    s := jsonb_build_object(
      'understated_10x', v_under, 'overstated_10x', v_over, 'corroborated', v_checked,
      'sample_ids', (select jsonb_agg(jsonb_build_object('source_table', source_table, 'listing_id', listing_id,
                                                         'stored', stored, 'source_price', source_price))
                       from (select * from public.mon_price_source_corroboration
                              where verdict in ('stored_understated_10x','stored_overstated_10x')
                                and drift_meaningful
                              order by listing_id limit 20) x),
      'why', 'A stored price disagrees with the platform''s OWN captured price by >=10x, and that evidence is refreshed with the row (contemporaneous). Owner invariant: THE PRICE ON THE SOURCE WEBSITE = THE PRICE EZHALAH STORES. Repair to the source-displayed value; never compute one. Rows whose evidence is only a capture-time snapshot are NOT counted here — they are raised separately as price_source_mismatch_stale_evidence.');
    n := n + public.mon_raise('P1', 'price_source_mismatch', 'price_fidelity', 'price_source_mismatch_10x', s);
  else
    perform public.mon_resolve('price_source_mismatch', 'price_fidelity');
  end if;

  -- P2: same >=10x shape, but the evidence is a capture-time snapshot that is NOT contemporaneous
  -- with the stored price. Still tracked — never silently dropped — but it cannot be adjudicated
  -- from the database alone, and it must NEVER be "repaired" to the snapshot value: that would
  -- overwrite a fresher source read with an older one (§19, §21).
  if v_stale > 0 then
    n := n + public.mon_raise('P2', 'price_source_mismatch_stale_evidence', 'price_fidelity',
      'price_source_mismatch_stale_evidence',
      jsonb_build_object(
        'stale_evidence_10x', v_stale,
        'sample_ids', (select jsonb_agg(jsonb_build_object('source_table', source_table, 'listing_id', listing_id,
                                                           'stored', stored, 'snapshot_price', source_price,
                                                           'evidence_field', evidence_field))
                         from (select * from public.mon_price_source_corroboration
                                where verdict in ('stored_understated_10x','stored_overstated_10x')
                                  and not drift_meaningful
                                order by listing_id limit 20) x),
        'why', 'A stored price disagrees >=10x with a CAPTURE-TIME snapshot whose evidence is not refreshed with the row, so the two are not contemporaneous and the database cannot say which is current. This is the capture-age residue §19 adjudicated on 2026-08-10 with a live probe (5/5 DB == aqar''s structured price). Resolve it ONLY with a fresh source probe from a runner the platform serves (the §22 aqar-stub-recovery pattern, --dry-run first). Do NOT repair to the snapshot value: that overwrites a fresher read with an older one.'));
  else
    perform public.mon_resolve('price_source_mismatch_stale_evidence', 'price_fidelity');
  end if;

  -- Counted ONLY over arms whose evidence is refreshed with the row — a capture-time snapshot
  -- legitimately diverges as prices move and is not drift.
  if v_drift_base > 0 and v_minor > greatest(200::bigint, v_drift_base / 100) then
    n := n + public.mon_raise('P2', 'price_source_drift', 'price_fidelity', 'price_source_drift',
      jsonb_build_object('minor_diffs', v_minor, 'drift_base', v_drift_base,
        'why', 'Many stored prices differ from the source''s captured price at the same magnitude — stale-price drift, i.e. the refresh path is not updating prices.'));
  else
    perform public.mon_resolve('price_source_drift', 'price_fidelity');
  end if;

  -- ── THE BARRIER (2026-09-06) ────────────────────────────────────────────────────────────────
  -- drift_meaningful decides which of two OPPOSITE instructions an engineer is given, so it may
  -- never be a constant. Executed over every wasalt row of the real view: the published flag must
  -- equal the timestamp relation it claims. Contemporaneous means the Arabic enrichment that
  -- supplies the evidence was fetched no more than 48h before the row's own source capture
  -- (crawl runs every 8h, enrich-ar every 4h, so a healthy pair is always inside that window).
  select count(*) filter (where v.drift_meaningful is distinct from
                                coalesce(w.ar_fetched_at >= w.raw_captured_at - interval '48 hours', false)),
         count(*) filter (where coalesce(w.ar_fetched_at >= w.raw_captured_at - interval '48 hours', false)),
         count(*) filter (where not coalesce(w.ar_fetched_at >= w.raw_captured_at - interval '48 hours', false))
    into v_flag_wrong, v_contemporaneous, v_stale_evidence
    from public.mon_price_source_corroboration v
    join public.wasalt_residential_listings w on w.id = v.listing_id
   where v.source_table = 'wasalt_residential_listings';

  if v_flag_wrong > 0 then
    n := n + public.mon_raise('P1', 'price_corroboration_contemporaneity_unmeasured', 'price_fidelity',
      'price_corroboration_contemporaneity_unmeasured',
      jsonb_build_object(
        'reason', 'flag_disagrees_with_timestamps',
        'rows_misflagged', v_flag_wrong,
        'contemporaneous_rows', v_contemporaneous,
        'stale_evidence_rows', v_stale_evidence,
        'why', 'mon_price_source_corroboration.drift_meaningful does not match the timestamp relation it names on '
             || v_flag_wrong || ' wasalt rows. That flag routes a >=10x disagreement into either a P1 that says '
             || '"repair to the source value" or a P2 that says "NEVER repair to the snapshot" — opposite '
             || 'instructions — so asserting it as a constant makes one of the two arms lie. Measured 2026-09-06: '
             || 'ar_data evidence on the wasalt Buy arm averages 56.3 days older than the row it is compared with, '
             || 'and every >=10x row in the P1 was such a pair.',
        'fix', 'Derive drift_meaningful in the view from (ar_fetched_at >= raw_captured_at - 48h), never a literal.'));
  elsif v_contemporaneous = 0 or v_stale_evidence = 0 then
    -- One side empty means the comparison above proves nothing and one of the two arms is
    -- unreachable. A barrier that cannot fail is the failure mode this repo has been burned by.
    n := n + public.mon_raise('P2', 'price_corroboration_contemporaneity_unmeasured', 'price_fidelity',
      'price_corroboration_contemporaneity_unmeasured',
      jsonb_build_object(
        'reason', 'vacuous_no_rows_on_one_side',
        'contemporaneous_rows', v_contemporaneous,
        'stale_evidence_rows', v_stale_evidence,
        'why', 'Every wasalt corroboration row now falls on ONE side of the contemporaneity test, so the '
             || 'flag check cannot distinguish a measured flag from a constant, and either the P1 or the P2 '
             || 'arm of price_source_mismatch is currently unreachable.'));
  else
    perform public.mon_resolve('price_corroboration_contemporaneity_unmeasured', 'price_fidelity');
  end if;

  return n;
end $function$;
