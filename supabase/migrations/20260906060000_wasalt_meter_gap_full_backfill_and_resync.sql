-- PREPARED, NOT YET APPLIED. Daily Engineer (routine-1-scraping) prepared this migration read-only
-- on 2026-09-06 and cannot apply it (Supabase access is SELECT-only except its own heartbeat row —
-- see AGENTS.md Hard Rule 6). This file is the exact, idempotent SQL for the Senior Production
-- Engineer (routine-2) to run via apply_migration, then merge this PR as the git mirror.
--
-- CONTEXT. Ops alert kind=wasalt_meter_parse_gap (issue #1700, P2, raised 2026-09-04). Migration
-- 20260809151000 repaired separate_water_meter/separate_electricity_meter from additional_info for
-- the wasalt_residential_listings rows that existed on 2026-08-09, but the producing path
-- (scrapers/wasalt/enrich.py) never recomputed those two columns on every enrichment since — so the
-- gap re-grew on every row re-enriched, and NEVER covered wasalt_commercial_listings at all (that
-- table was never touched by any prior repair). The producing-path fix is already merged (PR #1999,
-- commit de84e52) — this migration is the one-time backfill half the alert also asked for, plus the
-- resync the alert did not originally call out (see LEAK WARNING below), plus extending the
-- standing detector to a table it never covered (see DETECTOR EXTENSION below).
--
-- EXACT AFFECTED ROWS (measured read-only 2026-09-06, before this migration runs):
--   wasalt_residential_listings: 8,459 rows need a fix (8,365 active + 94 inactive) — ALL of them
--     are a pure NULL -> determined-value fill (0 rows currently hold a value that DISAGREES with
--     the source; wrong_value counts measured as 0 for both columns). Both columns always go stale
--     together per row (water_needs_fix = elec_needs_fix = any_row_needs_fix = 8,459 exactly).
--   wasalt_commercial_listings: 1,309 of 1,312 total rows need a fix (1,071 active + 238 inactive) —
--     again a pure NULL -> value fill, 0 wrong-value rows. This table has never been repaired before.
--   Source values found (both tables): ONLY exact "Yes"/"No" strings in additional_info — no case
--     variants exist today, so matching case-insensitively (mirroring the CODE's `_yes_no()` in
--     scrapers/wasalt/run.py, which does `.strip().lower()`) changes nothing observed today but
--     stays consistent with the currently-authoritative parsing logic rather than the older
--     migration's stricter exact-case match.
--
-- LEAK WARNING (measured read-only 2026-09-06, NOT part of the original alert — found while
-- verifying "end to end"). listing_rich_attrs is a VIEW over these raw tables, and
-- sync_listing_rich_attrs(p_source_table) periodically copies ANY diff (including a column going
-- NULL) from that view into search_listings_ar, the served index. Of the 8,365 active residential
-- gap rows, 116 have ALREADY been synced as NULL into search_listings_ar (the corruption already
-- reached the served index for those 116); the other 8,249 still retain their correct pre-gap value
-- in search_listings_ar purely because the periodic sync has not touched those specific rows again
-- yet — they remain AT RISK of the same silent NULL-out on their next sync, for as long as the raw
-- tables stay wrong. wasalt_commercial_listings has NO such window: all 1,071 active gap rows are
-- ALREADY NULL in search_listings_ar (never having held a correct value in the first place, since
-- commercial was never repaired).
--
-- THEREFORE THE ORDER IN THIS FILE MATTERS: the raw-table backfill (steps 1-2) MUST run and complete
-- BEFORE the two sync_listing_rich_attrs() calls (step 3) — running the sync first, or against
-- still-NULL raw data, is exactly the mechanism that already leaked 116 rows. Once steps 1-2 land,
-- listing_rich_attrs (the view) reads the corrected raw values, so step 3 only ever propagates
-- CORRECT values forward.
--
-- SAFETY. Every UPDATE below only fills a column that is currently NULL, driven solely by the same
-- row's OWN already-captured additional_info (jsonb array of {key,value}) — never inferred, never
-- copied across rows, never overwriting a non-null value (matches the "never fabricate, never erase
-- a known value" rule; also makes this migration safe to re-run: a second run finds zero NULL rows
-- left to update and is a no-op).
--
-- DETECTOR EXTENSION (this repair MUST ship watched — verify-repair-migrations-are-guarded.ts).
-- 20260904143531_wasalt_meter_parse_gap_detector_and_registry_rotation.sql already created and
-- rostered mon_detect_wasalt_meter_parse_gap(), which continuously re-checks the exact invariant
-- this migration establishes — but it only ever read wasalt_residential_listings. Since this
-- migration ALSO repairs wasalt_commercial_listings for the first time, that half of the invariant
-- would go back to being unwatched the moment this file lands. Step 4 below extends the SAME
-- function (same name, same roster entry — no re-wiring needed) to union both tables, so a future
-- regression on EITHER table re-raises the existing P2 alert_event key 'wasalt_meter_parse_gap'
-- rather than silently decaying again the way the residential-only gap did for 26 days. The
-- self-assertion at the end proves the detector reads ZERO violations immediately after this
-- migration's own backfill — not just that it CAN raise, but that the repair it is watching
-- actually holds right now.
--
-- The scraper-side root cause itself needs no further watching beyond this: PR #1999 (commit
-- de84e52, merged) fixed scrapers/wasalt/enrich.py's meter_fields_from_deep() to recompute both
-- columns on every future enrichment, with test_wasalt_enrich_meter_parse_gap.py pinning that via
-- the real code path against the real function. This detector is the DB-side backstop in case that
-- fix is ever reverted or a new producing path is added without reusing it.

-- ── Step 0: provenance backup (mirrors the 20260809151000 precedent) ────────────────────────────
create table if not exists wasalt_meter_gap_backfill_20260906 (
  source_table text not null,
  id bigint not null,
  active boolean,
  separate_water_meter_before boolean,
  separate_electricity_meter_before boolean,
  captured_at timestamptz not null default now()
);

insert into wasalt_meter_gap_backfill_20260906 (source_table, id, active, separate_water_meter_before, separate_electricity_meter_before)
select 'wasalt_residential_listings', id, active, separate_water_meter, separate_electricity_meter
  from wasalt_residential_listings
 where separate_water_meter is null or separate_electricity_meter is null;

insert into wasalt_meter_gap_backfill_20260906 (source_table, id, active, separate_water_meter_before, separate_electricity_meter_before)
select 'wasalt_commercial_listings', id, active, separate_water_meter, separate_electricity_meter
  from wasalt_commercial_listings
 where separate_water_meter is null or separate_electricity_meter is null;

-- ── Step 1: backfill wasalt_residential_listings from its own additional_info ───────────────────
update wasalt_residential_listings w
   set separate_water_meter = coalesce(w.separate_water_meter, s.wm),
       separate_electricity_meter = coalesce(w.separate_electricity_meter, s.em)
  from (
    select w2.id,
      (select case lower(trim(elem->>'value')) when 'yes' then true when 'no' then false else null end
         from jsonb_array_elements(coalesce(w2.additional_info, '[]'::jsonb)) elem
        where elem->>'key' = 'waterMeter' limit 1) as wm,
      (select case lower(trim(elem->>'value')) when 'yes' then true when 'no' then false else null end
         from jsonb_array_elements(coalesce(w2.additional_info, '[]'::jsonb)) elem
        where elem->>'key' = 'electricityMeter' limit 1) as em
      from wasalt_residential_listings w2
     where w2.separate_water_meter is null or w2.separate_electricity_meter is null
  ) s
 where s.id = w.id
   and (s.wm is not null or s.em is not null);

-- ── Step 2: backfill wasalt_commercial_listings from its own additional_info (never repaired before) ──
update wasalt_commercial_listings w
   set separate_water_meter = coalesce(w.separate_water_meter, s.wm),
       separate_electricity_meter = coalesce(w.separate_electricity_meter, s.em)
  from (
    select w2.id,
      (select case lower(trim(elem->>'value')) when 'yes' then true when 'no' then false else null end
         from jsonb_array_elements(coalesce(w2.additional_info, '[]'::jsonb)) elem
        where elem->>'key' = 'waterMeter' limit 1) as wm,
      (select case lower(trim(elem->>'value')) when 'yes' then true when 'no' then false else null end
         from jsonb_array_elements(coalesce(w2.additional_info, '[]'::jsonb)) elem
        where elem->>'key' = 'electricityMeter' limit 1) as em
      from wasalt_commercial_listings w2
     where w2.separate_water_meter is null or w2.separate_electricity_meter is null
  ) s
 where s.id = w.id
   and (s.wm is not null or s.em is not null);

-- ── Step 3: propagate the now-correct raw values into the served index ──────────────────────────
-- MUST run after steps 1-2 (see LEAK WARNING above). sync_listing_rich_attrs() diffs
-- listing_rich_attrs (a view over the raw tables) against search_listings_ar and copies over any
-- row that differs — running it before the backfill is exactly what already leaked 116 rows.
select sync_listing_rich_attrs('wasalt_residential_listings');
select sync_listing_rich_attrs('wasalt_commercial_listings');

-- ── Step 4: extend the standing detector to also cover wasalt_commercial_listings ────────────────
-- Same function name, same roster entry (already wired by 20260904143531) — this is a body-only
-- CREATE OR REPLACE, so no re-wiring, no new roster edit, no new alert kind. The residential half of
-- the WHERE clause is byte-for-byte unchanged from the live definition; only the UNION ALL branch
-- for wasalt_commercial_listings and a `source_table` tag on the raised detail are new.
create or replace function public.mon_detect_wasalt_meter_parse_gap()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gap        bigint;
  v_after      bigint;
  v_res        bigint;
  v_com        bigint;
  n            int := 0;
begin
  with gap as (
    select 'wasalt_residential_listings'::text as source_table, w.scraped_at
      from public.wasalt_residential_listings w
     where w.active
       and jsonb_typeof(w.additional_info) = 'array'
       and (
         ((select elem->>'value' from jsonb_array_elements(w.additional_info) elem
            where elem->>'key' = 'waterMeter' limit 1) in ('Yes','No')
          and w.separate_water_meter is null)
         or
         ((select elem->>'value' from jsonb_array_elements(w.additional_info) elem
            where elem->>'key' = 'electricityMeter' limit 1) in ('Yes','No')
          and w.separate_electricity_meter is null))
    union all
    select 'wasalt_commercial_listings'::text as source_table, w.scraped_at
      from public.wasalt_commercial_listings w
     where w.active
       and jsonb_typeof(w.additional_info) = 'array'
       and (
         ((select elem->>'value' from jsonb_array_elements(w.additional_info) elem
            where elem->>'key' = 'waterMeter' limit 1) in ('Yes','No')
          and w.separate_water_meter is null)
         or
         ((select elem->>'value' from jsonb_array_elements(w.additional_info) elem
            where elem->>'key' = 'electricityMeter' limit 1) in ('Yes','No')
          and w.separate_electricity_meter is null))
  )
  select count(*),
         count(*) filter (where scraped_at >= timestamptz '2026-08-09'),
         count(*) filter (where source_table = 'wasalt_residential_listings'),
         count(*) filter (where source_table = 'wasalt_commercial_listings')
    into v_gap, v_after, v_res, v_com
    from gap;

  if v_gap > 0 then
    n := n + public.mon_raise('P2', 'repair_guarantee', 'wasalt', 'wasalt_meter_parse_gap',
      jsonb_build_object(
        'active_rows_with_gap', v_gap,
        'active_rows_with_gap_residential', v_res,
        'active_rows_with_gap_commercial', v_com,
        'scraped_since_the_repair', v_after,
        'repair', '20260809151000_wasalt_meters_repaired_from_source; '
               || '20260906060000_wasalt_meter_gap_full_backfill_and_resync (adds commercial)',
        'why', 'wasalt publishes waterMeter/electricityMeter as Yes/No inside additional_info on '
            || 'these ACTIVE rows, but separate_water_meter / separate_electricity_meter are NULL. '
            || 'The producing path (scrapers/wasalt/enrich.py) is fixed as of PR #1999 (commit '
            || 'de84e52) to recompute both columns on every future enrichment — this detector is '
            || 'the DB-side backstop in case that fix is ever reverted or bypassed by a new path.',
        'action', 'If this re-raises: confirm meter_fields_from_deep() (scrapers/wasalt/enrich.py) '
            || 'is still wired into every write path for BOTH tables, then backfill only the '
            || 'standing rows from THEIR OWN payload — never infer a value the payload does not '
            || 'publish.',
        'do_not', 'Do NOT clear this with another one-shot UPDATE and no producing-path fix. Do NOT '
            || 'infer a value the payload does not publish: only Yes/No are read, anything else '
            || 'stays NULL.'));
  else
    perform public.mon_resolve_key('repair_guarantee', 'wasalt_meter_parse_gap');
  end if;
  return n;
end
$function$;

comment on function public.mon_detect_wasalt_meter_parse_gap() is
'Raises while ACTIVE wasalt rows (residential OR commercial) publish waterMeter/electricityMeter '
'(Yes/No) in additional_info but the parsed separate_*_meter column is NULL — i.e. the invariant '
'repaired by 20260809151000 (residential) and 20260906060000 (commercial, first repair) is being '
're-broken by the producing path. Extended 2026-09-06 to cover wasalt_commercial_listings, which the '
'original 2026-09-04 version never read. Reads only what wasalt already sent us; never writes a '
'listing row.';

-- ── the registry gains a row for the commercial repair, pointing at the same (now-extended) detector ──
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by)
values (
  '20260906060000',
  'wasalt_meter_gap_full_backfill_and_resync',
  'wasalt_commercial_listings separate_water_meter/separate_electricity_meter match the source '
    || 'additional_info Yes/No, the same invariant 20260809151000 established for '
    || 'wasalt_residential_listings — first repair for the commercial table.',
  'mon_detect_wasalt_meter_parse_gap',
  'daily-engineer-routine-1-scraping-prepared-for-senior-review'
);

-- ── self-assertions: prove reachability AND that the repair actually holds right now ─────────────
do $assert$
declare v_raised int; v_listed boolean; v_detector text;
begin
  select position('mon_detect_wasalt_meter_parse_gap' in
                  pg_get_functiondef('public.mon_run_all_detectors'::regproc)) > 0
    into v_listed;
  if not v_listed then
    raise exception 'detector is not reachable from the mon_run_all_detectors roster';
  end if;

  select detector into v_detector
    from public.ops_repair_guarantee_registry where repair_version = '20260906060000';
  if v_detector is distinct from 'mon_detect_wasalt_meter_parse_gap' then
    raise exception 'new registry row was not pointed at the (extended) detector (got %)', v_detector;
  end if;

  -- EXECUTED proof, not a source claim: after steps 1-3 above, the invariant must hold for BOTH
  -- tables right now, so the extended detector must read zero and self-resolve.
  select public.mon_detect_wasalt_meter_parse_gap() into v_raised;
  if v_raised <> 0 then
    raise exception 'detector still finds a gap immediately after this migration''s own backfill — '
      'the backfill in steps 1-2 did not actually close the invariant it claims to (v_raised=%)', v_raised;
  end if;
end
$assert$;

-- ── Verification (run these SELECTs after applying, expect all four to return 0 — same invariant
--    the self-assertion above already proved, kept here for a human to re-check by hand) ─────────
-- select count(*) from wasalt_residential_listings w
--   where (select case lower(trim(elem->>'value')) when 'yes' then true when 'no' then false else null end
--            from jsonb_array_elements(coalesce(w.additional_info,'[]'::jsonb)) elem
--           where elem->>'key'='waterMeter' limit 1) is not null
--     and w.separate_water_meter is null;
-- select count(*) from wasalt_commercial_listings w
--   where (select case lower(trim(elem->>'value')) when 'yes' then true when 'no' then false else null end
--            from jsonb_array_elements(coalesce(w.additional_info,'[]'::jsonb)) elem
--           where elem->>'key'='waterMeter' limit 1) is not null
--     and w.separate_water_meter is null;
-- select count(*) from search_listings_ar s join wasalt_residential_listings w
--     on w.id = s.listing_id and s.source_table='wasalt_residential_listings'
--   where w.separate_water_meter is not null and s.separate_water_meter is distinct from w.separate_water_meter;
-- select count(*) from search_listings_ar s join wasalt_commercial_listings w
--     on w.id = s.listing_id and s.source_table='wasalt_commercial_listings'
--   where w.separate_water_meter is not null and s.separate_water_meter is distinct from w.separate_water_meter;
