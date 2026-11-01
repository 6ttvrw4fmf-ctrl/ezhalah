-- sadiqeltajer frontage: each ad's OWN «الواجهة» row, re-read 2026-10-13 (🔬 AF engineer, backlog 512).
-- CI source-reread 38379060128 read the frontage row of all 117 served rows that carried a width or a facade.
-- The old reader took the facade from the FIRST bearing in a word list anywhere in the row, so an alley
-- («شارع غربي 15م وممر شمالي 8م») or the plot's side lengths («شارع شرقي 30م الاطوال : شمالي 41م …») gave the
-- wrong facade, and on a corner plot it could pair one street's width with another street's bearing
-- («شارع شرقي 30 م و شارع جنوبي 15م» stored as south + 30). scrapers/sadiqeltajer/run.py now reads ONE street
-- or nothing (the fleet rule). Repaired here, each row guarded on the exact value it holds today:
--   6 wrong facades → the street's own bearing; 3 widths the row states → filled (NULL only);
--   6 corner plots whose stored width and facade belong to DIFFERENT streets → both NULL.
-- The 26 other corner rows store one real street's own width and bearing (true, partial) and are left as
-- they are until a multi-facade representation exists (backlog 292).
do $b$
declare n int; total int := 0;
begin
  -- wrong facade: the street's own bearing (width unchanged)
  update public.sadiqeltajer_residential_listings set direction = v.new_dir
    from (values (12219125,'جنوبي','غربي'), (12219206,'شمالي','غربي'), (12217838,'جنوبي','غربي'),
                 (12218772,'شمالي','شرقي')) v(id, old_dir, new_dir)
   where sadiqeltajer_residential_listings.id = v.id and direction = v.old_dir;
  get diagnostics n = row_count; total := total + n;
  update public.sadiqeltajer_residential_listings set direction = 'شرقي', street_width_m = 15
   where id = 12219014 and direction = 'شمالي' and street_width_m is null;
  get diagnostics n = row_count; total := total + n;
  update public.sadiqeltajer_commercial_listings set direction = 'شرقي'
   where id = 14108262 and direction = 'شمالي' and street_width_m = 30;
  get diagnostics n = row_count; total := total + n;
  -- a width the row states, facade already right
  update public.sadiqeltajer_residential_listings set street_width_m = 15
   where id in (12219012, 12219013, 12219159) and street_width_m is null;
  get diagnostics n = row_count; total := total + n;
  -- corner plot, stored width and facade from two different streets → unknown
  update public.sadiqeltajer_residential_listings set direction = null, street_width_m = null
    from (values (12219130,'جنوبي',40), (12219281,'جنوبي',25), (12219210,'شمالي',12),
                 (12219127,'شمالي',30), (12218770,'شمالى',25)) v(id, old_dir, old_w)
   where sadiqeltajer_residential_listings.id = v.id and direction = v.old_dir and street_width_m = v.old_w;
  get diagnostics n = row_count; total := total + n;
  update public.sadiqeltajer_commercial_listings set direction = null, street_width_m = null
   where id = 12219371 and direction = 'جنوبي' and street_width_m = 30;
  get diagnostics n = row_count; total := total + n;
  raise notice 'sadiqeltajer frontage repair: % rows', total;
  if total = 0 or total > 15 then raise exception 'repair out of range: % of 15', total; end if;
end $b$;
