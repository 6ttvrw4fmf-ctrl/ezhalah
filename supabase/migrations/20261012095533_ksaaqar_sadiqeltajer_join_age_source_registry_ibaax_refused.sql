-- ksaaqar and sadiqeltajer join age_source_registry; ibaax is recorded as refused (🔬 AF engineer, 2026-10-12).
-- age_source_registry is the ONLY route by which a stored property_age reaches the Advanced Filter
-- (20260926222545). Alerts af_age_source_unregistered: ksaaqar residential 465 and commercial 34 aged rows,
-- sadiqeltajer 101, ibaax 119 — none reached search. Adjudicated against the live pages, source-reread
-- run 38231820163:
--   ksaaqar      — the page's structured «عمر العقار : <value>» field: 17082459 «4 سنوات» = 4, 17082456 «سنتين» = 2,
--                  17082455 «7 سنوات» = 7, commercial 14119303 «جديد» = 0. 4 of 4 exact.
--   sadiqeltajer — the ad's labelled «العمر:» line: 17062257 «14 سنة» = 14, 14108106 «11 سنة» = 11,
--                  13634064 «جديد» = 0. 3 of 3 exact.
--   ibaax        — NOT trusted: its pages are a client-side app the reader cannot open (3 of 3 unreadable), and
--                  3 of the 4 newest aged rows store 0, which cannot be told apart from a default without the
--                  page. A recorded refusal; its ages stay out of search until a re-read proves them.
-- rebuild_age_producer() picks a trusted row up on its next hourly run (jobid 46); age_source_health() still
-- gates admission.
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', true,
       'TRUSTED 2026-10-12: ksaaqar structured «عمر العقار» 4 of 4 exact, sadiqeltajer labelled «العمر:» 3 of 3 exact, «جديد» = 0; source-reread 38231820163.',
       now()
from unnest(array['ksaaqar_residential_listings','ksaaqar_commercial_listings','sadiqeltajer_residential_listings']) t
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
values ('ibaax_residential_listings', 'canonical_column', false,
        'REFUSED 2026-10-12: pages unreadable to the re-reader (client-side app, 3 of 3) and 3 of the 4 newest aged rows store 0; unverifiable, so not trusted until a re-read proves the values. source-reread 38231820163.',
        now())
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.age_source_registry
       WHERE source_table in ('ksaaqar_residential_listings','ksaaqar_commercial_listings','sadiqeltajer_residential_listings') AND trusted) <> 3 THEN
    RAISE EXCEPTION 'expected 3 trusted age_source_registry rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.age_source_registry WHERE source_table = 'ibaax_residential_listings' AND NOT trusted) THEN
    RAISE EXCEPTION 'expected ibaax recorded as refused';
  END IF;
END $verify$;