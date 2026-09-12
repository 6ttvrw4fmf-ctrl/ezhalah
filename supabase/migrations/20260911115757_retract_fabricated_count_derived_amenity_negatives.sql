-- COUNT-DERIVED AMENITIES: RETRACT THE FABRICATED NEGATIVES, KEEP THE REAL ONES.
-- ops_incident #154 (routine-5, AF + Trending data integrity), measured 2026-09-11.
--
-- detect_manufactured_negatives() reported ELEVEN (platform x column) pairs holding `false` with
-- `true` nowhere on the platform, across abwbna / alobid / bahadhabab — every one of them an
-- Advanced Filter amenity predicate (parking, elevator, maid_room, driver_room, balcony_terrace,
-- air_conditioner). verify-safety-barrier.ts is inside the REQUIRED npm test, so the repo could not
-- merge anything while this stood.
--
-- ROOT CAUSE (code, fixed in the same change): four scrapers on the aldarim SaaS shape derived five
-- amenity booleans as `(_int(L.get("balconies")) or 0) > 0`, and normalize.to_int_numeric() returns
-- None for an explicit source 0 AND for a source null alike. The two collapsed into one False, so a
-- listing the API said NOTHING about was stored as a confident "no balcony".
-- normalize.count_flag() now separates them; pinned by
-- scrapers/common/tests/test_count_derived_amenities_absence_is_not_false.py.
--
-- WHAT IS REPAIRED, AND WHAT IS DELIBERATELY NOT. The obvious reading of "false with zero true
-- anywhere" is to retract the whole column. That would destroy hundreds of REAL source negatives.
-- Measured over the stored `source_capture` — the exact payload, so this is a probe and not an
-- inference — the key is present on 100% of rows on all four platforms and is published as an
-- explicit 0 on the overwhelming majority. Only the JSON-null rows were fabricated, and only those
-- are retracted here: 163 cells (abwbna 100, aldarim 63; alobid and bahadhabab have no null rows
-- at all and are untouched). This is the same split, for the same reason, as the 2026-08-11
-- aldarim/air_conditioner repair.

do $$
declare
  p text; t text; c text; k text; n bigint; total bigint := 0;
  cols text[][] := array[
    ['parking','parking_spots'], ['elevator','elevators'], ['maid_room','maid_rooms'],
    ['driver_room','driver_rooms'], ['balcony_terrace','balconies']];
begin
  foreach p in array array['aldarim','abwbna','alobid','bahadhabab'] loop
    foreach t in array array[p || '_residential_listings', p || '_commercial_listings'] loop
      for i in 1..array_length(cols, 1) loop
        c := cols[i][1]; k := cols[i][2];
        -- ONLY where the source itself sent JSON null for that key. A row whose payload carries an
        -- explicit 0 is a source-published negative and is left exactly as it is.
        execute format(
          'update public.%I set %I = null
             where %I is false and source_capture ? %L and source_capture->>%L is null',
          t, c, c, k, k);
        get diagnostics n = row_count;
        total := total + n;
      end loop;
    end loop;
  end loop;
  raise notice 'retracted % fabricated amenity negatives', total;
  if total <> 163 then
    raise exception 'expected 163 fabricated cells (measured 2026-09-11), repaired % — the inventory '
      'moved under this migration; re-measure before applying', total;
  end if;
end $$;

-- ── THE ELEVEN PAIRS THAT REMAIN ARE SOURCE TRUTH ──────────────────────────────────────────────
-- Registered per (platform, column) with the evidence that makes each one checkable, never a blanket
-- suppression: detect_manufactured_negatives() keeps firing for every pair NOT listed here.
insert into public.ops_source_published_negative (platform, col, evidence, verified_at) values
 ('abwbna','parking',
  'abwbna publishes parking_spots on 189/189 rows: explicit 0 on 169, JSON null on 20 (retracted to NULL in this migration), and no positive anywhere. Zero-true is abwbna stock genuinely having no parking. The payload is provably READ rather than defaulted: sibling flags on the same rows carry BOTH values (has_electricity 172 true / 17 false, has_sewage 135/54) and sibling COUNTS on this same platform carry positives (elevators 1, maid_rooms 3). Measured 2026-09-11 over stored source_capture, ops_incident #154.', now()),
 ('abwbna','driver_room',
  'abwbna publishes driver_rooms on 189/189 rows: explicit 0 on 169, JSON null on 20 (retracted here), no positive. Same read-not-defaulted proof as parking above (has_electricity 172/17, has_sewage 135/54; elevators/maid_rooms carry positives). Measured 2026-09-11, ops_incident #154.', now()),
 ('abwbna','balcony_terrace',
  'abwbna publishes balconies on 189/189 rows: explicit 0 on 169, JSON null on 20 (retracted here), no positive. Same read-not-defaulted proof as parking above. Measured 2026-09-11, ops_incident #154.', now()),
 ('abwbna','air_conditioner',
  'abwbna publishes is_ac_installed on 189/189 rows: explicit 0 on 169, JSON null on 20, never 1. The nulls were already stored as NULL — _flag() has been tri-state since onboarding — so every remaining false is a source-published negative. Sibling flags has_electricity/has_water/has_sewage carry both values on the same rows, proving the flag set is genuinely read. Same shape as the aldarim/air_conditioner pair registered 2026-08-11. Measured 2026-09-11, ops_incident #154.', now()),
 ('alobid','elevator',
  'alobid publishes elevators on 138/138 rows as an explicit 0 every time — zero JSON nulls, so NOTHING was fabricated on this platform and nothing is retracted. Read-not-defaulted: has_electricity 102 true / 36 false and has_sewage 41/97 on the same rows, and sibling counts carry positives (parking_spots 1, maid_rooms 2). Measured 2026-09-11, ops_incident #154.', now()),
 ('alobid','driver_room',
  'alobid publishes driver_rooms on 138/138 rows as an explicit 0 every time; zero JSON nulls, nothing retracted. Same read-not-defaulted proof as alobid/elevator above. Measured 2026-09-11, ops_incident #154.', now()),
 ('alobid','balcony_terrace',
  'alobid publishes balconies on 138/138 rows as an explicit 0 every time; zero JSON nulls, nothing retracted. Same read-not-defaulted proof as alobid/elevator above. Measured 2026-09-11, ops_incident #154.', now()),
 ('alobid','air_conditioner',
  'alobid publishes is_ac_installed on 138/138 rows as an explicit 0 every time, never 1 and never null. Sibling flags has_electricity 102/36 and has_sewage 41/97 carry both values on the same rows. Measured 2026-09-11, ops_incident #154.', now()),
 ('bahadhabab','maid_room',
  'bahadhabab publishes maid_rooms on 53/53 rows as an explicit 0 every time; zero JSON nulls, nothing retracted. Read-not-defaulted: has_electricity 38 true / 15 false, has_sewage 37/16, and sibling counts carry real positives on this platform (parking_spots 25, elevators 1, balconies 1). Measured 2026-09-11, ops_incident #154.', now()),
 ('bahadhabab','driver_room',
  'bahadhabab publishes driver_rooms on 53/53 rows as an explicit 0 every time; zero JSON nulls, nothing retracted. Same read-not-defaulted proof as bahadhabab/maid_room above. Measured 2026-09-11, ops_incident #154.', now()),
 ('bahadhabab','air_conditioner',
  'bahadhabab publishes is_ac_installed on 53/53 rows as an explicit 0 every time, never 1 and never null. Sibling flags has_electricity 38/15 and has_sewage 37/16 carry both values on the same rows. Measured 2026-09-11, ops_incident #154.', now())
on conflict (platform, col) do update
  set evidence = excluded.evidence, verified_at = excluded.verified_at;

-- Re-materialise the barrier state so the required check sees the repaired world immediately
-- instead of waiting for the 03:23 UTC cron.
select public.refresh_safety_barrier_state();
