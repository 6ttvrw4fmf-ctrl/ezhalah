-- OWNER RULE 2026-09-24, applied to a fourth platform: "if a website goes down and it's the problem
-- there, we immediately hide their listings, and we include their name and logo in the animation".
-- Owner directed this platform specifically on 2026-09-25.
--
-- THE EVIDENCE, and why it is the source's problem and not ours.
-- awaalun.com's own server answers **HTTP 500** on the listings REST endpoint
-- (https://awaalun.com/wp-json/wp/v2/rtcl_listing), measured 2026-09-25 07:39:39Z from GitHub
-- Actions egress — the vantage point the scrapers really use, not a cloud agent container (from
-- which example.com and wordpress.org are equally unreachable, so nothing measured there would mean
-- anything). A 500 is not a refusal: the server accepted the request and then failed internally.
-- That distinction matters, because the two-TLS-profile requirement in the 2026-09-24 precedent
-- exists to stop a **403 handshake refusal** being mistaken for a dead address, and a 500 is not
-- that shape.
--
-- It is also not a blip. Four consecutive runs over 27+ hours produced zero listings:
--   2026-09-23 04:22  ok=true  rows_seen=128   <- last good run
--   2026-09-24 04:22  ok=false rows_seen=0
--   2026-09-24 17:19  ok=false rows_seen=0
--   2026-09-25 04:22  ok=false rows_seen=0
--   2026-09-25 07:39  ok=false rows_seen=0     <- first run that could say WHY: HTTP 500
-- The first four could only say "(source down, parked, or blocked)" — three guesses — because
-- fetch_listings() collapsed five distinct outcomes into one empty list. PR #4299 fixed that, and
-- the very next run named the cause. This migration is downstream of that diagnosis, not of a hunch.
--
-- WE DID NOT CAUSE IT: awal's first failure was 2026-09-24 04:22Z; the last change to that scraper
-- (#4074) landed 22:32Z the same day, ~18 hours later.
--
-- WHAT THIS DOES, and what it deliberately does NOT do. Exactly the mechanism of 20260925005730:
-- the search RPCs filter production_ready, so the top-level dormant gate removes awal's 51 listings
-- from every result; loader_active_platforms_ar() selects DISTINCT platform from search_listings_ar
-- with NO production_ready filter, so the rows STAYING is what keeps awal's name and logo in the
-- loading animation. Both halves of the owner's rule, one predicate.
--
-- NOTHING IS DELETED AND NO ROW IS DEACTIVATED. active stays true, the raw tables are untouched,
-- and no ops_adjudicated_retraction entry is needed or appropriate: auto_recover_false_inactive()
-- only ever touches rows with active = false, and this sets none. Absence of verification is
-- UNKNOWN, never death (owner rule 2026-08-30) — so if awaalun.com's server recovers, its next
-- successful crawl restores it with no migration and no human step.
--
-- REVERSIBLE IN ONE LINE:  update public.platform_registry set status = 'active' where platform = 'awal';
--
-- VERIFIED LIVE through the anon interfaces the app itself uses, after the gate propagated to the
-- served index (2026-09-25 07:4xZ): location_search_candidates_ar returns 0 for awal (was 51) while
-- loader_active_platforms_ar() still lists it among 104 platforms — listings hidden, brand retained.
-- Healthy neighbour wadod untouched at 7.

update public.platform_registry
   set status = 'dormant'
 where platform = 'awal'
   and status = 'active';

do $$
declare v_status text; v_rows int;
begin
  select status into v_status from public.platform_registry where platform = 'awal';
  if v_status is distinct from 'dormant' then
    raise exception 'awal did not reach dormant (status=%) — refusing to land a half-applied rule',
      v_status;
  end if;

  -- The brand must survive the hide, or only half the owner's rule shipped. The rows are what
  -- carry it into loader_active_platforms_ar(), so assert they are still there.
  select count(*) into v_rows from public.awal_residential_listings where active;
  if v_rows = 0 then
    raise exception 'awal has no active rows left — the logo would vanish from the loader, which is '
                    'the opposite of the rule';
  end if;
  raise notice 'awal dormant; % active rows retained to keep its name and logo in the loader', v_rows;
end $$;
