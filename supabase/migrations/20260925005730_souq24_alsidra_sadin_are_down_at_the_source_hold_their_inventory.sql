-- Mark the three platforms whose SOURCE is down, under the all-arms gate added by
-- the_down_platform_gate_covers_all_four_arms_of_v2. Their 151 listings leave search on the next
-- sync; their logos and names stay in the loading animation, because loader_active_platforms_ar()
-- selects DISTINCT platform from search_listings_ar with no production_ready filter — the rows
-- staying is what keeps the brand visible. That is both halves of the owner's 2026-09-24 rule.
--
-- EACH PROBED LIVE 2026-09-25 00:5x UTC on TWO TLS profiles (chrome124 + safari17_0), so a
-- fingerprint refusal cannot be mistaken for a dead site ("a 403 can be the HANDSHAKE, not the
-- address"):
--   souq24  → 200 at https://24.com.sa/cgi-sys/suspendedpage.cgi       «Account Suspended»
--   alsidra → 200 at https://alsidra.com.sa/cgi-sys/suspendedpage.cgi  cPanel suspended page
--   sadin   → 502 Bad Gateway from its own nginx/1.24.0, 14 days running
-- souq24 is corroborated from the other side the same night: with the proxy-route fix (PR #4090)
-- its transport recovered completely — 21/23 browse pages in 15s, 2 timeouts instead of 465 — and
-- it still harvested 0 listing ids, because the pages it now reads cleanly ARE the suspended page.
--
-- REVERSIBLE BY DESIGN: nothing is deleted, no row is deactivated, the raw tables are untouched.
-- Absence of verification is UNKNOWN, never death (owner rule 2026-08-30). When a site answers
-- again, set status back to 'active' and the next sync restores its listings.
update public.platform_registry
   set status = 'dormant',
       notes = left(coalesce(notes || ' | ', '')
               || 'DORMANT 2026-09-25 (owner down-rule): the SOURCE is down at its own end — '
               || case platform
                    when 'souq24'  then 'cPanel «Account Suspended» on 24.com.sa'
                    when 'alsidra' then 'cPanel suspendedpage on alsidra.com.sa'
                    when 'sadin'   then '502 Bad Gateway from its own nginx, 14 days'
                  end
               || ', probed chrome124 + safari17_0. Listings held out of search '
               || '(production_ready=false via listing_native_location_v2); logo + name kept in the '
               || 'loading strip. Set status back to active when it answers again.', 2000),
       updated_at = now()
 where platform in ('souq24', 'alsidra', 'sadin');

do $check$
declare n int;
begin
  select count(*) into n from public.platform_registry where status = 'dormant';
  if n <> 3 then raise exception 'expected exactly 3 dormant platforms, found %', n; end if;

  -- every one of the 151 rows must now be held out by the gate, in ALL arms
  select count(*) into n from public.listing_native_location_v2
   where platform in ('souq24','alsidra','sadin') and production_ready;
  if n <> 0 then raise exception '% rows of the down platforms are still production_ready in v2', n; end if;

  -- and the brand must survive: the rows themselves are still there for the loader
  select count(*) into n from public.listing_native_location_v2
   where platform in ('souq24','alsidra','sadin');
  if n < 151 then raise exception 'the down platforms lost rows (%) — the logo would disappear too', n; end if;

  -- no healthy platform may be caught by this
  select count(*) into n from public.listing_native_location_v2
   where production_ready and platform in (select platform from public.platform_registry where status = 'active');
  if n < 200000 then raise exception 'active platforms lost production_ready rows (%)', n; end if;
end $check$;
