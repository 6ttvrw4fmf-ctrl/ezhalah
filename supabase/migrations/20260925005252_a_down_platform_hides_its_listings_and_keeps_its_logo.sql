-- OWNER RULE 2026-09-24: "if a website goes down and it's the problem there, we immediately hide
-- their listings, and we include their name and logo in the animation ... because it probably went
-- down due to a government reason."
--
-- THREE PLATFORMS ARE IN THIS STATE TONIGHT and their listings are still clickable:
--   souq24  (24.com.sa)     — every browser profile lands on cPanel «Account Suspended» (2026-09-25)
--   alsidra (alsidra.com.sa) — same cPanel suspendedpage since 2026-09-23
--   sadin   (sadin.com.sa)   — its own server has answered 502 on the listing pages for 14 days
-- 151 rows in total that open onto a dead site.
--
-- THE MECHANISM, and why it satisfies BOTH halves of the rule:
--   * the search RPCs (location_search_candidates_ar and friends) filter on production_ready, so a
--     row with production_ready=false is gone from every search result — the listings are hidden;
--   * loader_active_platforms_ar() selects DISTINCT platform from search_listings_ar with NO
--     production_ready filter, so the ROWS STAYING is exactly what keeps the logo and the name in
--     the loading animation.
-- So the whole rule is one predicate on production_ready. Nothing is deleted, nothing is
-- deactivated row by row: absence of verification is UNKNOWN, never death (owner rule 2026-08-30),
-- and a platform that answers again flips itself back on the next successful crawl + sync.
--
-- The flag is `platform_registry.status = 'dormant'` — a value the CHECK constraint has always
-- allowed and nothing has ever used. 'retired' already means "gone for good, do not rebuild"
-- (alnokhba, toor); 'dormant' now means "the SOURCE is down, hold its inventory, keep its brand".
--
-- THIS MIGRATION IS A NO-OP ON ITS OWN. No platform is dormant yet, so every production_ready value
-- in the index is unchanged by it. Marking the three platforms is a separate, reversible statement,
-- applied after this one is verified.
do $mig$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  v_old := '(COALESCE(v1.city_id, uali.city_id, ulg.city_id, ulg2.city_id, uc.city_id) IS NOT NULL)) AS production_ready';
  v_new := '(COALESCE(v1.city_id, uali.city_id, ulg.city_id, ulg2.city_id, uc.city_id) IS NOT NULL) AND NOT (EXISTS (SELECT 1 FROM public.platform_registry pr WHERE pr.platform = v1.platform AND pr.status = ''dormant''))) AS production_ready';
  if position(v_old in v_def) = 0 then
    raise exception 'listing_native_location_v2: the production_ready expression did not match its '
                    'expected shape — the view changed under this migration, refusing to rewrite it blindly';
  end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || replace(v_def, v_old, v_new);
end $mig$;

-- Proof the predicate is live and still a no-op: the view must now mention the dormant test, and no
-- platform may be dormant yet.
do $check$
begin
  if position('dormant' in pg_get_viewdef('public.listing_native_location_v2'::regclass)) = 0 then
    raise exception 'the dormant gate is not in listing_native_location_v2 after the rewrite';
  end if;
  if exists (select 1 from public.platform_registry where status = 'dormant') then
    raise exception 'a platform is already dormant — this migration must land as a no-op';
  end if;
end $check$;
