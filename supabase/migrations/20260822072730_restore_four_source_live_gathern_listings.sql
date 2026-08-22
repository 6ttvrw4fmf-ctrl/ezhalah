-- RESTORE FOUR GATHERN LISTINGS THE SOURCE STILL SERVES.
--
-- Section 15 is unambiguous: "source confirms live -> RESTORE". These four are inactive in Ezhalah
-- and return a full HTTP 200 detail page at gathern right now.
--
-- HOW THEY WERE PROVED (2026-08-22, Data Integrity run #37). Direct probes from this run, replicated,
-- with a control group in the SAME session so a healthy probe is proved rather than assumed:
--   id 3979578  view/47702/unit/80347    10/10 x 200, 144,406 bytes, 0 redirects
--   id 7415308  view/47702/unit/199034   15/15 x 200, 140,604 bytes, 0 redirects
--   id 1816639  view/179293/unit/250731   5/5  x 200, 149,692 bytes
--   id 5150623  view/179028/unit/250282   5/5  x 200, 215,452 bytes
--   CONTROL, still dead: id 724847 view/51511/unit/199472  6/6 x 404, 50,787 bytes
--   CONTROL, known live: 10 randomly sampled ACTIVE rows -> 10/10 x 200
-- A 404 serves a ~50 KB error page and a live unit a ~140-215 KB page, so the two are not merely
-- different status codes; the restored rows are real unit pages, reached with no redirect.
--
-- WHY THESE ROWS EXISTED AT ALL -- the defect, not the symptom. The sweep's own rule is
-- "HTTP 200 -> alive -> rescue", but it only ever applied that rule to rows that were still ACTIVE.
-- Nothing re-probed a row once it was killed. So one source fact -- a live detail page -- produced a
-- rescue for one row and permanent removal for another, decided purely by our own prior state. The
-- stated recovery path (the crawl upsert) only fires if the unit re-enters gathern's enumeration
-- feed, and a unit can keep a live page while sitting out of that feed. id 1816639 had been
-- inactive and unreachable for 26 days; id 5150623 for 10.
--
-- THE PAYLOAD IS NOT A NEW RULE. It is byte-for-byte what the sweep's own `alive` branch writes
-- (active + missing_count reset + last_seen_at refreshed); this migration applies the existing rule
-- to rows the kill pass stopped looking at. The systematic fix ships with it as
-- `--recheck-dead` in scrapers/gathern/liveness.py.
--
-- SCOPE IS DELIBERATELY FOUR, NOT THE COHORT. A 60-row random sample of the 2,515 killed rows found
-- 3 live (~5%, i.e. ~126 expected). Those are NOT restored here: restoring a row requires ITS OWN
-- 200, and extrapolating a sample into a bulk reactivation would be exactly the guessing this
-- routine forbids. The --recheck-dead pass restores them one probe at a time.

do $$
declare v_restored int; v_control_active boolean;
begin
  update public.gathern_residential_listings
     set active = true, missing_count = 0, last_seen_at = now(), deactivated_at = null
   where id in (3979578, 7415308, 1816639, 5150623)
     and active = false;
  get diagnostics v_restored = row_count;

  if v_restored <> 4 then
    raise exception 'expected to restore exactly 4 rows, restored %', v_restored;
  end if;

  -- CONTROL (section 21): a row proved DEAD in the same probe session must be untouched. This is
  -- what stops a targeted repair from quietly becoming a sweep.
  select active into v_control_active
    from public.gathern_residential_listings where id = 724847;
  if v_control_active is distinct from false then
    raise exception 'control row 724847 (6/6 x 404) is no longer inactive - refusing';
  end if;

  -- Record the basis in the same ledger the sweep now writes to, so these restores are as
  -- re-checkable as any other liveness decision rather than an unexplained state change.
  insert into public.gathern_liveness_detail
    (listing_id, http_status, verdict, missing_count_before, missing_count_after, applied)
  values (3979578, 200, 'alive', 3, 0, true),
         (7415308, 200, 'alive', 3, 0, true),
         (1816639, 200, 'alive', 3, 0, true),
         (5150623, 200, 'alive', 4, 0, true);

  raise notice 'restored % source-live gathern listings; control row still inactive', v_restored;
end $$;
