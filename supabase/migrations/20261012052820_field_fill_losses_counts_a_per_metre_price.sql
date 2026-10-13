-- ⚡ Scraping Engineer, 2026-10-12 — scraper_field_fill_losses(): a per-metre price is a price.
--
-- The weekly field-fill robot counted a row as priced only on price_total / price_annual. A source that
-- states «سعر المتر» is stored as price_per_meter with price_total NULL by design (no area×rate
-- derivation inside scrapers/ — verify-ppm-searchable-and-filter-safe), so a week of per-metre land ads
-- read as «price lost» and opened backlog 405 (alshawaf, 41 points) against a parser that was right:
-- source-reread run 38207152782 showed /22320 «سعر المتر» stored as price_per_meter 1850.
-- Needle edit of the live body (same signature, no DROP); the check block proves it landed.
do $mig$
declare v_def text; v_old text; v_new text;
begin
  v_def := pg_get_functiondef('public.scraper_field_fill_losses(boolean)'::regprocedure);
  v_old := $o$avg((coalesce(s.price_total, s.price_annual) is not null)::int) as p$o$;
  v_new := $n$avg((coalesce(s.price_total, s.price_annual, s.price_per_meter) is not null)::int) as p$n$;
  if position(v_old in v_def) = 0 then
    raise exception 'scraper_field_fill_losses: expected price expression not found — refusing to edit blindly';
  end if;
  execute replace(v_def, v_old, v_new);
end $mig$;

do $chk$
begin
  if position('s.price_per_meter) is not null' in pg_get_functiondef('public.scraper_field_fill_losses(boolean)'::regprocedure)) = 0 then
    raise exception 'scraper_field_fill_losses: per-metre price not counted after edit';
  end if;
end $chk$;
