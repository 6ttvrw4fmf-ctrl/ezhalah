-- A home whose SITE names a retired town as its district keeps its move to that town even after a title district
-- fills its recovery row (🆕 2026-11-12, alert 14421 / repeat_bug 14335 / backlog 1789).
--
-- Measured: aqar 9594877 and 26273326 (source «حي جواثا», city Hofuf; title «… حي الكلابية ، جواثا ، الاحساء») swapped
-- city every hour since 11-11 10:59 UTC:
--   :54 recovery = «حي جواثا»  → remap g2n moves the home to جواثا (3700), district shown NULL (own town);
--   :54 next hour, served city 3700 → the TITLE arm overwrites recovery with «حي الكلابية» → g2n no longer sees the
--       town, the home falls back to الهفوف (12) and is served «حي الكلابية» there → district_contradicts_source raises;
--   the hour after, served 12 → the title arm skips → recovery «حي جواثا» again → back to 3700 → the alert resolves.
-- Eleven reopens in seven days. Root cause: g2 / g2n read the town only from v1.district_ar or district_recovery, and
-- district_recovery is rewritten by the title arm. The source's own district (listing_source_district_ar_fleet) does
-- not move, so both arms now ALSO key on it. Measured at write time against the live body: the new arm set equals
-- the old one plus exactly these 2 homes (0 rows lost; city_is_district 259, duplicate_city 96, district_is_city 169,
-- district_is_city_by_pin 30 → 32). After the move the title arm fills «حي الكلابية» under جواثا (a listed district
-- of 3700), which the detector already accepts (district_recovery basis = 'title').
-- Needle edit of the LIVE body (the needle must occur exactly twice: g2 and g2n); the check block executes it.
do $mig$
declare src text; dst text; c int;
  needle constant text := 'g2d.k = public.district_key_letters(coalesce(nullif(btrim(v1.district_ar), ''''), dr.district_ar))';
  repl constant text := 'g2d.k in (public.district_key_letters(coalesce(nullif(btrim(v1.district_ar), ''''), dr.district_ar)),' || E'\n'
                     || '                         public.district_key_letters((select sd.source_district_ar from public.listing_source_district_ar_fleet sd' || E'\n'
                     || '                                                       where sd.source_table = v1.source_table and sd.listing_id = v1.listing_id)))';
begin
  src := pg_get_functiondef('public.retired_place_remap_rows()'::regprocedure);
  if position('listing_source_district_ar_fleet' in src) > 0 then raise exception 'source-district key already present'; end if;
  c := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if c <> 2 then raise exception 'needle found % times in live retired_place_remap_rows(), expected 2 (g2, g2n)', c; end if;
  dst := replace(src, needle, repl);
  execute dst;
end
$mig$;

do $chk$
declare n_pin int; n_other int;
begin
  if (length(pg_get_functiondef('public.retired_place_remap_rows()'::regprocedure))
      - length(replace(pg_get_functiondef('public.retired_place_remap_rows()'::regprocedure), 'listing_source_district_ar_fleet', '')))
     / length('listing_source_district_ar_fleet') <> 2 then
    raise exception 'source-district key did not land in both g2 and g2n';
  end if;
  if (select count(*) from public.retired_place_remap_rows()
       where source_table = 'aqar_residential_listings' and listing_id in (9594877, 26273326) and new_city_id = 3700) <> 2 then
    raise exception 'aqar 9594877 / 26273326 do not move to جواثا (3700)';
  end if;
  if not exists (select 1 from public.retired_place_remap_rows()
                  where source_table = 'arkaan_residential_listings' and listing_id = 26298570 and new_city_id = 3700) then
    raise exception 'arkaan 26298570 no longer moves to جواثا (3700)';
  end if;
  select count(*) filter (where kind = 'district_is_city_by_pin'), count(*) filter (where kind <> 'district_is_city_by_pin')
    into n_pin, n_other from public.retired_place_remap_rows();
  if n_pin < 32 or n_other < 524 then raise exception 'remap shrank: by-pin %, other % (expected ≥ 32 / ≥ 524)', n_pin, n_other; end if;
end
$chk$;
