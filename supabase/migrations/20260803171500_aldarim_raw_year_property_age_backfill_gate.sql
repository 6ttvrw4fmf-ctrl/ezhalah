-- aldarim pre-#274 property_age raw-year backfill (P1/P2, 2026-08-03 audit). Backfill only — no new
-- parser code; the forward fix already shipped in scrapers/aldarim/run.py (#274,
-- "fix(aldarim): stop fabricating age 0 from the '0' sentinel; map year_built to a real age").
--
-- ROOT CAUSE (pre-#274): the old mapping stored aldarim's raw `year_built` field into property_age
-- with NO year->age conversion, so a listing with year_built="2013" landed with property_age=2013 (a
-- literal calendar year) instead of the correct age = scrape_year - 2013. `_age_from_year_built()`
-- now performs that conversion for every 1900..scrape_year+2 shaped value:
--     n <= 0                    -> None (never fabricate new-construction from the "0" sentinel)
--     1900 <= n <= year_now+2   -> age = max(0, year_now - n)
--     property_type ageless     -> None regardless (Residential Land / Commercial Land / Gas Station)
-- This migration re-applies that SAME, already-approved formula retroactively to rows that captured
-- the OLD un-converted value and have not been re-scraped since -- a derivation, not a guess.
--
-- PROOF GATE (per-row, format-independent -- the aqar-licence-price precedent's standard):
--     property_age BETWEEN 1900 AND extract(year from now())+2   -- looks like a raw calendar year
--     AND source_capture->>'year_built' = property_age::text     -- the row's OWN raw captured
--                                                                    payload still carries that exact
--                                                                    year, unconverted -- not a
--                                                                    resemblance, the same value on
--                                                                    the same row
-- The #274 formula can never legitimately output a value in [1900, year_now+2] itself (its max
-- output is year_now - 1900, ~126), so no legitimately-computed age can ever collide with this gate --
-- confirmed against the current worktree's scrapers/aldarim/run.py::_age_from_year_built.
--
-- LIVE COUNT (re-derived via execute_sql immediately before writing this migration, 2026-08-03): 0
-- active rows in either aldarim_residential_listings or aldarim_commercial_listings currently match
-- the gate. The bug has fully self-healed: residential's active rows were last re-scraped
-- 2026-07-31 (after #274 merged 2026-07-30); commercial's 39 active rows never carried a populated
-- real-year value to begin with (property_age max = 0 there, pre- and post-fix). Nothing to convert
-- today -- this migration exists to close the backfill out as a verified, fail-closed invariant
-- (mark_stale-task style) rather than leave it undocumented, and to self-execute the derivation if
-- the gate ever legitimately matches something before this ships.
--
-- FAIL-CLOSED: re-runs the SAME proof gate at apply time. If it now matches anything other than the
-- 0 rows verified above, or the update touches a different count than the gate found, it aborts
-- rather than silently backfilling an unverified set.

do $$
declare
  n_expected constant int := 0;
  year_now   constant int := extract(year from now())::int;
  n_res int; n_com int; n_total int;
  n_res_upd int; n_com_upd int;
begin
  select count(*) into n_res
    from public.aldarim_residential_listings a
   where a.active
     and a.property_age between 1900 and year_now + 2
     and a.source_capture->>'year_built' = a.property_age::text;

  select count(*) into n_com
    from public.aldarim_commercial_listings a
   where a.active
     and a.property_age between 1900 and year_now + 2
     and a.source_capture->>'year_built' = a.property_age::text;

  n_total := n_res + n_com;

  -- Fail closed if the target set moved since the audit: better to abort than to convert an
  -- unverified row. Re-run the gate queries and update n_expected deliberately if it legitimately
  -- changed (a re-scrape can only shrink this set further, never grow it, since the forward fix is
  -- already live -- so a non-zero reading here would itself be worth investigating before proceeding).
  if n_total <> n_expected then
    raise exception 'aldarim raw-year property_age gate matched % rows (residential=%, commercial=%), '
                     'expected % -- aborting rather than backfilling an unverified set',
                     n_total, n_res, n_com, n_expected;
  end if;

  update public.aldarim_residential_listings a
     set property_age = case
           when a.property_type in ('Residential Land', 'Commercial Land', 'Gas Station') then null
           else greatest(0, year_now - a.property_age)
         end
   where a.active
     and a.property_age between 1900 and year_now + 2
     and a.source_capture->>'year_built' = a.property_age::text;
  get diagnostics n_res_upd = row_count;

  update public.aldarim_commercial_listings a
     set property_age = case
           when a.property_type in ('Residential Land', 'Commercial Land', 'Gas Station') then null
           else greatest(0, year_now - a.property_age)
         end
   where a.active
     and a.property_age between 1900 and year_now + 2
     and a.source_capture->>'year_built' = a.property_age::text;
  get diagnostics n_com_upd = row_count;

  if (n_res_upd + n_com_upd) <> n_expected then
    raise exception 'aldarim raw-year property_age repair updated % rows, expected % -- rolling back',
                     (n_res_upd + n_com_upd), n_expected;
  end if;

  raise notice 'aldarim raw-year property_age repair: % row(s) converted (residential=%, commercial=%)'
               ' -- invariant holds, 0 pre-#274 stale rows remain', n_res_upd + n_com_upd, n_res_upd, n_com_upd;
end $$;
