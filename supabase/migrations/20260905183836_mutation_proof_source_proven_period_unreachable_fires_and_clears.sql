-- MUTATION PROOF for mon_detect_source_proven_period_unreachable(), executed against the real
-- objects rather than asserted in prose (precedent: 20260830140831, which reactivates a retired row,
-- asserts its detector fires, then puts the row back).
--
-- WHY THIS PROOF AND NOT A COUNT. The detector reads 0 today, and under the owner's 2026-09-05 rule
-- it SHOULD read 0 while every UNKNOWN period is honest. A standing 0 is indistinguishable from a
-- detector that cannot fire at all (§24c; and §25c, where a barrier's cohort could never contain its
-- own subject). The only way to know it works is to create the exact condition it exists for.
--
-- THE INJECTION IS A PROBE, NOT A LISTING EDIT. It writes one synthetic row into
-- ops_rent_period_source_probe claiming the source publishes «سنوي» for a raghdan listing we serve
-- with rent_period_ar NULL, asserts the detector raises exactly that key, then deletes the synthetic
-- probe and asserts the detector clears it. No listing row is touched at any point, so no source
-- fact is fabricated even transiently - which matters, because fabricating a period is precisely
-- what the rule forbids. Asserted at the end: the fixture's rent_period_ar is still NULL.
--
-- It also proves the honest-UNKNOWN direction, which is the half the owner asked for: the fixture
-- has NO probe before or after, and the detector reads 0 in both of those states. Honest UNKNOWN
-- never alerts; a source-proven period we lost always does.
--
-- ON THE ONE ASSERTION DELIBERATELY NOT MADE HERE. §25b says to check that an alert did not resolve
-- in the same microsecond it was raised. That check is MEANINGLESS inside a migration: Postgres
-- freezes now() for the whole transaction, so mon_raise() and mon_resolve_stale_keys() necessarily
-- stamp identical timestamps here, and asserting otherwise fails on a transaction artifact rather
-- than on a defect (this migration did exactly that on its first attempt and was rolled back).
-- The insta-resolve property was therefore proven where it is real - across separate transactions,
-- live on production 2026-09-05: raised 18:37:31.837145+00, resolved 18:37:50.035148+00, held open
-- 18.198 s, resolved_at = created_at -> false. Re-run those two halves rather than re-deriving this.

do $$
declare
  v_tbl   text := 'raghdan_residential_listings';
  v_id    bigint := 597904;
  v_key   text;
  v_base  int;
  v_fired int;
  v_open  int;
  v_after int;
begin
  v_key := 'source_proven_period_unreachable:' || v_tbl || ':' || v_id::text;

  -- Guard the fixture: meaningful only on a row that is genuinely an honest UNKNOWN (in the index,
  -- rent, NULL period) and carries no real probe we would be clobbering.
  if not exists (select 1 from search_listings_ar
                  where source_table = v_tbl and listing_id = v_id
                    and rent_period_ar is null and deal_ar = 'إيجار') then
    raise notice 'SKIPPED: fixture %:% is no longer an index rent row with a NULL period', v_tbl, v_id;
    return;
  end if;
  if exists (select 1 from ops_rent_period_source_probe
              where source_table = v_tbl and listing_id = v_id and method not like 'SYNTHETIC%') then
    raise notice 'SKIPPED: fixture %:% now carries a real probe', v_tbl, v_id;
    return;
  end if;

  -- BEFORE: honest UNKNOWN, no probe. Must be silent.
  v_base := public.mon_detect_source_proven_period_unreachable();
  if v_base <> 0 then
    raise exception 'REFUSING: detector not clean before the injection (raised %)', v_base;
  end if;

  -- INJECT: the source is now on record as publishing a period for a row we serve as NULL.
  insert into ops_rent_period_source_probe
        (source_table, listing_id, probed_at, http_status, observed_subtype, method, evidence)
  values (v_tbl, v_id, now(), 200, 'سنوي',
          'SYNTHETIC mutation proof for mon_detect_source_proven_period_unreachable',
          'Injected and deleted inside this migration. NOT a real observation of raghdan.');

  v_fired := public.mon_detect_source_proven_period_unreachable();
  select count(*) into v_open from alert_event
   where kind = 'source_proven_period_unreachable' and dedup_key = v_key and resolved_at is null;

  if v_fired <> 1 or v_open <> 1 then
    raise exception 'MUTATION NOT KILLED: detector raised % and left % open key(s) for an injected '
                    'source-proven period - it cannot see the condition it exists for', v_fired, v_open;
  end if;

  -- RETRACT: the row goes back to being an honest UNKNOWN.
  delete from ops_rent_period_source_probe
   where source_table = v_tbl and listing_id = v_id and method like 'SYNTHETIC%';

  v_after := public.mon_detect_source_proven_period_unreachable();
  select count(*) into v_open from alert_event
   where kind = 'source_proven_period_unreachable' and dedup_key = v_key and resolved_at is null;

  if v_after <> 0 or v_open <> 0 then
    raise exception 'CANNOT GO GREEN: after retracting the probe the detector raised % and left % '
                    'open key(s) - a barrier that cannot clear suppresses its own next alert (§23a)',
                    v_after, v_open;
  end if;

  -- The listing itself must be exactly as we found it: honest UNKNOWN, no fabricated period.
  if (select rent_period_ar from search_listings_ar
       where source_table = v_tbl and listing_id = v_id) is not null then
    raise exception 'FIXTURE MUTATED: %:% no longer carries an honest NULL period', v_tbl, v_id;
  end if;
  if exists (select 1 from ops_rent_period_source_probe
              where source_table = v_tbl and listing_id = v_id and method like 'SYNTHETIC%') then
    raise exception 'CLEANUP FAILED: synthetic probe still present on %:%', v_tbl, v_id;
  end if;

  raise notice 'mutation proof OK: silent=% fired=% cleared=%', v_base, v_fired, v_after;
end $$;
