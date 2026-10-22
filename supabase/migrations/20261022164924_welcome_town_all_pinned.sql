-- A town fact speaks only when EVERY ad behind it has a map pin (owner 2026-10-22: «those facts must be true from
-- our database»). The pin is what proves an ad is really in the town it is filed under; the region check added
-- earlier the same day can only test pinned ads, so an unpinned ad could still be a misfiled same-name district.
-- Measured that day: 112 town facts → 86 (40 of 49 single-ad towns, 46 of 63 few-ad towns had every ad pinned).
set local statement_timeout = '5min';
do $m$
declare src text; out_def text;
  anchor text := E'       and c.city_id not in (select city_id from w_misplaced);';
begin
  src := pg_get_functiondef('public.build_welcome_insights()'::regprocedure);
  if position('where lat is null and city_id is not null' in src) > 0 then return; end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'town anchor not found exactly once — refusing to guess';
  end if;
  out_def := replace(src, anchor,
    E'       and c.city_id not in (select city_id from w_misplaced)\n' ||
    E'       -- 3. and every one of its ads carries a pin (an unpinned ad cannot prove where it is)\n' ||
    E'       and c.city_id not in (select city_id from w_b where lat is null and city_id is not null);');
  execute out_def;
end $m$;

do $proof$
declare r int; bad int;
begin
  r := public.build_welcome_insights();
  if r < 200 then raise exception 'PROOF: only % insights after the rebuild', r; end if;
  select count(*) into bad from public.welcome_insight w
   where w.kind in ('town_single','town_few')
     and exists (select 1 from public.search_listings_ar s where s.production_ready and s.city_id = w.city_id and s.latitude is null);
  if bad > 0 then raise exception 'PROOF: % town facts still stand on an unpinned ad', bad; end if;
end $proof$;
