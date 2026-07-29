-- Inactivate awal's 51 remaining live rows — link rot. OWNER-APPROVED 2026-07-28.
--
-- PR#252 retired the awal SCRAPER (awaalun.com lapsed into a GoDaddy parking page) but deliberately
-- LEFT the 51 rows searchable, deferring the link-rot call to the owner. The owner has now made it:
-- remove them. Every one of those listings sends a user to a domain-parking page, which breaks the
-- neutral-aggregator promise — the card advertises a property that no longer exists at the source.
--
-- THIS IS A SOURCE-VERIFIED KILL, NOT A TIME-BASED GUESS. Re-fetched 8 of the 51 live listing URLs
-- immediately before writing this migration (2026-07-28, chrome-UA, redirects followed, retried on
-- empty body). 8/8 returned the SAME 114-byte parking stub, HTTP 200:
--     <!DOCTYPE html><html><head><script>
--       window.onload=function(){window.location.href="/lander"}</script></head></html>
-- Two initially came back with a 0-byte body; per the standing "200 + no dead-marker is NOT proof of
-- life" rule those were RETRIED rather than assumed alive, and both then returned the same stub.
-- The WP REST catalogue endpoint is dead the same way (200 text/html, 133-byte stub) — that is what
-- killed the scraper on 07-27/07-28. Last real pull: 2026-07-26 04:23 (rows_seen=128).
--
-- WHY missing_count = 3, not 0: 3 is this codebase's "source-confirmed dead" pin. It makes the rows
-- inert to both self-healing paths — auto_recover_false_inactive (jobid 30) and prune_unseen both
-- key off it — so a future sweep cannot resurrect a listing whose source is provably gone. Writing 0
-- here is exactly the mark_stale_listings_inactive anti-pattern the 2026-07-28 audit flagged (an
-- unverified kill that nothing can re-verify). This kill IS verified, hence the pin.
--
-- REVERSIBLE: rows are inactivated, NOT deleted. `active=false` removes them from
-- search_listings_ar (the sync's delete arm drops them on its next run); the historical rows, their
-- source_capture evidence and their prices stay intact for audit. If awaalun.com ever comes back,
-- flipping active + clearing missing_count restores them. No listing DATA is modified here — only
-- the internal liveness flag — so listing fidelity is untouched.

update public.awal_residential_listings
   set active = false,
       missing_count = 3,
       deactivated_at = now()
 where active = true;

update public.awal_commercial_listings
   set active = false,
       missing_count = 3,
       deactivated_at = now()
 where active = true;

-- Fail LOUD if anything is still active, so a partial apply can never look like success.
do $$
declare
  n int;
begin
  select (select count(*) from public.awal_residential_listings where active)
       + (select count(*) from public.awal_commercial_listings  where active)
    into n;
  if n <> 0 then
    raise exception 'awal link-rot inactivation incomplete: % row(s) still active', n;
  end if;
  raise notice 'awal link-rot: 0 active rows remain (51 inactivated, missing_count=3 source-confirmed pin)';
end $$;
