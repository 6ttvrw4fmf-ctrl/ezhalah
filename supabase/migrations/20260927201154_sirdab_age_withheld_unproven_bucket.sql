-- sirdab's age is WITHHELD (trusted = false), minutes after 20260927200827 registered it and before the
-- hourly rebuild_age_producer() could publish it. The registry admits a source only on live probe evidence
-- (feedback: age-registry-requires-a-live-probe-not-a-column), and sirdab's cannot be proven:
--   * its ad page never DISPLAYS an age — the integer exists only in the RSC payload's property.property_age;
--   * the distribution is the open-bucket signature: 31 rows at 10, 8 at 11, NOTHING from 12 to 19, one 20 —
--     the shape of a form whose last options are «10» and «more than 10» (the muktamel «+10» → 11 trap).
-- Absent beats wrong: an AF «age ≤ 11» must never match a warehouse the advertiser called «10+».
-- ashab stays trusted (its «عمر العقار N» is on the page; 40/30/29 re-read live, distribution smooth).
update public.age_source_registry
   set trusted = false,
       note = 'WITHHELD 2026-09-27: age is never displayed on the ad page (API field only) and 31×10 / 8×11 / none 12–19 is the open-bucket signature — cannot be proven equal to what the advertiser stated. Re-admit only if the site shows the age or a probe proves 11 is a real 11.',
       updated_at = now()
 where source_table in ('sirdab_residential_listings','sirdab_commercial_listings');

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.age_source_registry WHERE source_table ~ '^sirdab_' AND trusted) THEN
    RAISE EXCEPTION 'sirdab is still a trusted age source';
  END IF;
  IF (SELECT count(*) FROM public.age_source_registry WHERE source_table ~ '^ashab_(residential|commercial)_listings$' AND trusted) <> 2 THEN
    RAISE EXCEPTION 'ashab must stay trusted';
  END IF;
  RAISE NOTICE 'sirdab age withheld; ashab trusted';
END $verify$;