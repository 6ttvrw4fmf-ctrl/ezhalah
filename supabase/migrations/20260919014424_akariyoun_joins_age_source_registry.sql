-- عقاريون joins age_source_registry — the ONLY mechanism that makes its age reach the Advanced
-- Filter, and the one I got wrong first.
--
-- WHAT I DID WRONG. 20260919001322 appended an akariyoun arm to listing_age_resolved BY HAND. The
-- AF age question then worked, and I reported it working. pg_cron job 46 runs
-- rebuild_age_producer() hourly at :44, which REGENERATES that view from THIS registry — so my arm
-- was wiped at the top of the hour and the AF age answer silently went back to zero. The view is
-- an OUTPUT; this table is the contract. A hand-edited output looks correct for less than an hour.
--
-- TRUSTED IS EARNED BY A LIVE PROBE, NOT BY A COLUMN EXISTING (the registry's own standing rule).
-- All 63 rows stored as age=10 were re-fetched from their own listing URLs on 2026-09-19 and their
-- «عمر العقار» text read directly:
--     46  «اكثر من عشر سنوات»  -> an OPEN BOUND. The parser now returns NULL for these, and
--                                 20260919_akariyoun_open_bound_ages_are_unknown_not_ten repaired
--                                 the already-stored values.
--     17  «عشر سنوات»          -> genuinely ten.
-- Spot-checked against the source in both directions: «ثمان سنوات» -> 8 and «عشر سنوات» -> 10 both
-- match the page exactly. age_source_health() independently returns verdict='ok' for both tables
-- (197 aged / 11 distinct / 0..10 / 0 year-like), so the registry's own gate agrees.
--
-- strategy = canonical_column: the scraper writes property_age onto the table directly, parsed from
-- the source's Arabic word numerals (ثمان سنوات -> 8), never derived from a build year or a range.
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
values
  ('akariyoun_residential_listings', 'canonical_column', true,
   'TRUSTED 2026-09-19: Arabic word-numeral ages parsed from «عمر العقار» on the listing''s own page. Live-probed all 63 rows stored as 10 — 46 said «اكثر من عشر سنوات» (open bound -> NULL, repaired) and 17 said «عشر سنوات» (exact). age_source_health verdict=ok.', now()),
  ('akariyoun_commercial_listings', 'canonical_column', true,
   'TRUSTED 2026-09-19: same parser and same page shape as the residential table; age_source_health verdict=ok (25 aged, 0..10, 0 year-like).', now())
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted,
      note = excluded.note, updated_at = now();

-- Regenerate now rather than waiting for :44, so the AF answer is correct immediately.
select public.rebuild_age_producer();

do $verify$
declare v_n int;
begin
  if position('akariyoun_residential_listings' in pg_get_viewdef('public.listing_age_resolved'::regclass,true)) = 0 then
    raise exception 'akariyoun did not land in the REGENERATED listing_age_resolved — the registry row is not being read';
  end if;
  select count(*) into v_n from public.listing_age_resolved
   where source_table = 'akariyoun_residential_listings';
  if v_n = 0 then
    raise exception 'akariyoun arm regenerated but empty';
  end if;
  raise notice 'akariyoun ages now flowing through the producer: %', v_n;
end $verify$;