-- quarantine_growth: the 25% SHARE condition judges only rows that carry a location signal.
--
-- Alerts 1729 (alobid) and 1730 (abwbna), open since 2026-09-06 with unready_unreachable = 0 and
-- unready == median_7d (no growth at all). Every withheld row on both platforms is unlocated, and
-- on abwbna (49/49) and alobid (26/37) the served row carries NO location text and NO pin: the
-- Aldarim API these offices publish through returns city = null for them, so no resolver can ever
-- place them. The share condition exists to catch a LOCATION RESOLVER failure (its own adjudicate
-- text says so) - a row the source gives nothing to resolve is not one, and counting it made an
-- alarm nobody can clear by fixing anything.
--
-- The distinction, both directions (checked by the DO block at the bottom):
--   * share condition: unready rows WITH a location signal (city_ar / district_ar / region_ar text
--     or a pin) over the platform total > 25%  -> fires, exactly as before for those rows;
--   * a source-silent row (no text, no pin) no longer counts toward the SHARE;
--   * the GROWTH condition (> 2x the 7-day median, floor 20) still counts EVERY unready row, so a
--     scraper that suddenly stops capturing city (rows turn silent in a step) still fires.
-- Nothing is widened: no threshold, floor or factor changes. The payload gains
-- unready_source_silent so the split is readable from the alert.
do $patch$
declare
  def text := pg_get_functiondef('public.mon_detect_quarantine_growth()'::regprocedure);
  a1 text := $a$count(*) filter (where not production_ready and city_id is not null) as unready_unreachable,$a$;
  b1 text := $a$count(*) filter (where not production_ready and city_id is not null) as unready_unreachable,
           -- Rows the SOURCE gives nothing to resolve (no city/district/region text, no pin). They
           -- cannot be a resolver failure, so they do not count toward the 25% share below; the
           -- growth condition still counts them (a step change to silence still fires).
           count(*) filter (where not production_ready and city_ar is null and district_ar is null
                              and region_ar is null and latitude is null) as unready_source_silent,$a$;
  a2 text := $a$or (rec.total > 0 and rec.unready::numeric / rec.total > 0.25);$a$;
  b2 text := $a$or (rec.total > 0
                and (rec.unready - rec.unready_source_silent)::numeric / rec.total > 0.25);$a$;
  a3 text := $a$'unready_unreachable', rec.unready_unreachable,$a$;
  b3 text := $a$'unready_unreachable', rec.unready_unreachable,
          'unready_source_silent', rec.unready_source_silent,$a$;
begin
  if position(a1 in def) = 0 or position(a2 in def) = 0 or position(a3 in def) = 0 then
    raise exception 'mon_detect_quarantine_growth: an anchor is gone - refusing to guess';
  end if;
  if position('unready_source_silent' in def) > 0 then
    raise exception 'mon_detect_quarantine_growth already carries unready_source_silent';
  end if;
  def := replace(replace(replace(def, a1, b1), a2, b2), a3, b3);
  execute def;
end
$patch$;

-- Both directions of the share predicate, on literal shapes (fails the migration if wrong).
do $chk$
declare got boolean[];
begin
  select array_agg(((unready - silent)::numeric / total > 0.25) order by k) into got
    from (values
      (1, 49, 49, 187),  -- abwbna today: every withheld row source-silent      -> quiet
      (2, 37, 26, 138),  -- alobid today: 11 pinned of 138 (8%)                  -> quiet
      (3, 60,  0, 138),  -- 60 rows with text the resolver failed on (43%)        -> fires
      (4, 49, 10, 187)   -- 39 resolvable of 187 (21%)                            -> quiet
    ) v(k, unready, silent, total);
  if got is distinct from array[false, false, true, false] then
    raise exception 'quarantine share predicate check failed: %', got;
  end if;
  if position('(rec.unready - rec.unready_source_silent)::numeric / rec.total > 0.25'
              in pg_get_functiondef('public.mon_detect_quarantine_growth()'::regprocedure)) = 0 then
    raise exception 'mon_detect_quarantine_growth did not take the share predicate';
  end if;
end
$chk$;