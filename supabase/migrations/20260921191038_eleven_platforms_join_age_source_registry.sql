-- The eleven platforms join age_source_registry — the ONLY way an age reaches the Advanced Filter.
--
-- listing_native_location_v2 takes property_age from listing_age_resolved, NOT from
-- listing_extra_attrs, and rebuild_age_producer() (pg_cron 46, hourly at :44) regenerates that view
-- from THIS registry alone (the akariyoun lesson, 20260919014424: a hand-added arm is wiped within the
-- hour). Without these rows every age the scrapers write stays NULL in search_listings_ar — the
-- #3320 platforms are the proof: ksaaqar has 433 aged rows in listing_extra_attrs and 0 in the index.
--
-- No rebuild is called here: the tables are empty at apply time, and age_source_health() gates each
-- canonical_column arm until the table has >= 5 aged rows, > 1 distinct age, max <= 100 and no
-- build years. The :44 run admits each table on its own once its first sweep clears that gate.
--
-- TRUSTED IS EARNED BY A LIVE PROBE (the registry's standing rule). Probed 2026-09-21 through each
-- scraper's real parser; since this change the eight field/prose readers go through
-- normalize.exact_age, so an OPEN BOUND («اكثر من عشر سنوات», «40+», «فوق 30») is NULL, never its
-- floor — the defect that refused muktamel and that akariyoun fixed (20260919014358).
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', v.trusted, v.note, now()
from (values
  ('sakan', true, 'TRUSTED 2026-09-21: «عمر العقار» spec cell, closed vocabulary. Live probe of 150 pages: جديد 132, ثلاث سنوات 3, اربع/ثمان/خمس سنوات/سنتين/سنة 1 each, open bound «اكثر من عشر سنوات» 3 -> NULL via normalize.exact_age.'),
  ('moftah', true, 'TRUSTED 2026-09-21: Woo spec «عمر العقار». Live 13 products: جديد 3, 3 سنوات 1, «أكثر من 10 سنوات» 1 -> NULL (exact_age). INERT UNTIL >= 5 AGED ROWS: ~4 aged across both tables, so age_source_health() says too_small and no age reaches the AF yet.'),
  ('masar', true, 'TRUSTED 2026-09-21: anchored prose «العمر سبع سنوات» (normalize.age_from_labelled_prose); a 25-year warranty is never read as an age. INERT UNTIL >= 5 AGED ROWS: 9 listings in total, so age_source_health() says too_small today.'),
  ('bossbih', true, 'TRUSTED 2026-09-21: Drupal field-al-mr «العمر N سنة». Live sample 120 of 1,485: 30/40/45/17, all exact.'),
  ('alshawaf', true, 'TRUSTED 2026-09-21: «العمر» index/detail cell, all 987 read. Exact numbers and جديد/سنتين; open bounds «40+», «+30», «فوق 30», «اكثر من 20 سنه» (14 rows) -> NULL via exact_age; «عظم»/«بناء عربي»/«مليص» -> NULL.'),
  ('ialqarawi', true, 'TRUSTED 2026-09-21: anchored prose «العمر 13 سنة» / «عمر العقار 9 سنوات»; 6 of 150 sampled, each checked against the page text; «يتجاوز 30 سنه» -> NULL.'),
  ('aljassim', true, 'TRUSTED 2026-09-21: detail «العمر N سنة», all 90 read: 16 aged, 0..45, all exact.'),
  ('almotmkenah', true, 'TRUSTED 2026-09-21: «تاريخ البناء» field (empty on all 22 live ads) else anchored prose «عمر العقار: 5 سنوات» / «عمر الفيلا 3 سنوات»; 3 of 22 live aged. INERT UNTIL >= 5 AGED ROWS (age_source_health too_small).'),
  ('nufouth', true, 'TRUSTED 2026-09-21: the API''s own integer age_property (never derived from date_construction_building); 35 of 80 sampled units, 0..44.'),
  ('alsidra', false, 'NOT A SOURCE 2026-09-21: publishes no age field and no age prose on any of its 26 live posts; the scraper writes no property_age.'),
  ('gomenassat', false, 'NOT A SOURCE 2026-09-21: the scraper writes no property_age; registered so the absence is a decision, not silence.')
) as v(p, trusted, note)
cross join lateral (values (v.p || '_residential_listings'), (v.p || '_commercial_listings')) as x(t)
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted,
      note = excluded.note, updated_at = now();

do $verify$
declare n_trusted int; n_all int;
begin
  select count(*) filter (where trusted), count(*) into n_trusted, n_all
    from public.age_source_registry
   where source_table ~ '^(alsidra|moftah|masar|gomenassat|sakan|bossbih|alshawaf|ialqarawi|aljassim|almotmkenah|nufouth)_(residential|commercial)_listings$';
  if n_all <> 22 or n_trusted <> 18 then
    raise exception 'age_source_registry: expected 22 rows / 18 trusted for the eleven, got % / %', n_all, n_trusted;
  end if;
  raise notice 'eleven platforms registered in age_source_registry (18 trusted, 4 not a source)';
end $verify$;
