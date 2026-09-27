-- A DOWN platform now leaves the loading strip too: logo hidden, platform count drops (owner rule
-- 2026-09-26, superseding the "keep the logo" half of the 2026-09-24 DOWN rule).
--
-- Owner, 2026-09-26: "if a website is down cuz we cant bring it back hide the logo and the number
-- count decreases cuz it probably got suspended because of regulations" — and, asked when: "you
-- should bring all of them [back] no matter what, but if the site is suspended or there is something
-- wrong with it … we just put it down." So: the moment the daily engineer confirms a site is down ON
-- ITS SIDE (platform_registry.status = 'dormant'), its listings are hidden (unchanged, the v2 gate)
-- AND its logo leaves the strip, and the strip's «Reviewing N platforms» count — which is literally
-- the number of logos — drops with it. When the site answers again and a crawl succeeds, the engineer
-- flips it back to 'active' and both return automatically; nothing here deletes or deactivates a row.
--
-- WHY A NEW FUNCTION, NOT A CHANGE TO loader_active_platforms_ar(). That function answers the BROAD
-- question "which platforms have rows in search_listings_ar", and a dozen barriers use it as exactly
-- that (served-scope, image coverage, identity, the PLATFORM_META-vs-production roster check). The
-- strip answers a NARROWER question — "which platforms is Ezhalah searching for you right now" —
-- which verify-loader-platforms-match-active.ts already distinguishes in its own header. So the
-- narrow answer is DERIVED from the broad one here, in one place, and only the strip reads it.
--
-- 'retired' is excluded too: a retired platform is "not counted, no logo" by contract
-- (scrapers/RETIRED_PLATFORMS.txt); today they already have 0 rows, so this only makes it explicit.

create or replace function public.loader_strip_platforms_ar()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p order by p), '{}'::text[])
  from unnest(public.loader_active_platforms_ar()) as p
  where not exists (
    select 1 from public.platform_registry r
    where r.platform = p and r.status in ('dormant', 'retired')
  );
$$;

grant execute on function public.loader_strip_platforms_ar() to anon, authenticated;

-- Executed against production at apply time — not a comment about what it should do.
do $verify$
declare
  v_active text[] := public.loader_active_platforms_ar();
  v_strip  text[] := public.loader_strip_platforms_ar();
  v_leak   text[];
  v_lost   text[];
begin
  -- 1. The strip never advertises a platform with no rows.
  if not (v_strip <@ v_active) then
    raise exception 'strip is not a subset of the active set: %', array(select unnest(v_strip) except select unnest(v_active));
  end if;
  -- 2. No down/retired platform is in the strip.
  select array_agg(p) into v_leak from unnest(v_strip) p
   where exists (select 1 from public.platform_registry r where r.platform = p and r.status in ('dormant','retired'));
  if v_leak is not null then
    raise exception 'down/retired platforms still in the strip: %', v_leak;
  end if;
  -- 3. Nothing else was dropped: every active platform that is not down is still in the strip.
  select array_agg(p) into v_lost from unnest(v_active) p
   where not (p = any(v_strip))
     and not exists (select 1 from public.platform_registry r where r.platform = p and r.status in ('dormant','retired'));
  if v_lost is not null then
    raise exception 'healthy platforms dropped from the strip: %', v_lost;
  end if;
  raise notice 'loader strip: % of % active platforms shown; % down/retired hidden',
    cardinality(v_strip), cardinality(v_active), cardinality(v_active) - cardinality(v_strip);
end $verify$;
