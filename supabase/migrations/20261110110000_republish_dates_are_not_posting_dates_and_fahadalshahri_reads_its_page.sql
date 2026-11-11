-- A WORDPRESS DATE THAT MOVES ON RE-PUBLISH IS NOT A POSTING DATE — amlakalahsa and hajer; fahadalshahri reads its page.
--
-- Found 2026-11-10 by comparing every stored date with our own first sight (an ad cannot be posted after we saw it):
--   amlakalahsa  45 of 302 dated live ads carry a date more than a day AFTER we first stored them (median 21 days).
--                Read at source: /wp-json/wp/v2/land/19748 → date_gmt «2026-11-03T16:40:38», modified_gmt 46 s later,
--                though we stored this ad on 2026-09-12. No other date exists in the record (no ACF date, no
--                article_published_time).
--   hajer        6 of 123. /wp-json/wp/v2/properties?slug=… (post 1022 = HJ4010) → date_gmt «2026-10-10T10:45:58»
--                with modified_gmt the same second, though we stored that very link on 2026-06-21. The page prints no
--                other date.
-- On both sites the editor's re-publish resets WordPress `date`: a bump, which docs/ARCHITECTURE.md §20 rule (1) never
-- stores (nowaisiry's WordPress `date`, same shape). Which of the other dates are bumps cannot be told apart, and a
-- wrong date is worse than none, so both scrapers now store NULL and keep the verbatim value as
-- additional_info["date_gmt"]; this clears the stored copies (each copied to additional_info first) and records both
-- sites as 'no'. The upsert never overwrites a known date with NULL, which is why the clear has to be done here.
-- The guard that saw it — welcome_posting_date_verdict(), raised by mon_detect_welcome_posting_date_untrusted() — is
-- re-run below on the fixed data.
--
-- Seen elsewhere the same day and NOT changed (too few to call the site's field a bump): reinvest 6 of 977,
-- ksaaqar 1 of 1,460, mizlaj 1 of 29.

-- Bulk guard: these are the only rows this may touch (302 + 124 dated on 2026-11-10).
do $$
declare n_a int; n_h int;
begin
  select count(*) into n_a from (
    select 1 from public.amlakalahsa_residential_listings where date_added is not null
    union all select 1 from public.amlakalahsa_commercial_listings where date_added is not null) z;
  select count(*) into n_h from (
    select 1 from public.hajer_residential_listings where date_added is not null
    union all select 1 from public.hajer_commercial_listings where date_added is not null) z;
  if n_a > 400 or n_h > 200 then
    raise exception 'bulk guard: % amlakalahsa / % hajer dated rows, more than measured (302 / 124) — refusing', n_a, n_h;
  end if;
end $$;

update public.amlakalahsa_residential_listings
   set additional_info = coalesce(additional_info, '{}'::jsonb) || jsonb_build_object('republish_date_as_stored', date_added),
       date_added = null
 where date_added is not null;
update public.amlakalahsa_commercial_listings
   set additional_info = coalesce(additional_info, '{}'::jsonb) || jsonb_build_object('republish_date_as_stored', date_added),
       date_added = null
 where date_added is not null;
update public.hajer_residential_listings
   set additional_info = coalesce(additional_info, '{}'::jsonb) || jsonb_build_object('republish_date_as_stored', date_added),
       date_added = null
 where date_added is not null;
update public.hajer_commercial_listings
   set additional_info = coalesce(additional_info, '{}'::jsonb) || jsonb_build_object('republish_date_as_stored', date_added),
       date_added = null
 where date_added is not null;

insert into public.ops_source_posting_date_policy
  (platform, publishes, read_from, baseline_fill_pct, baseline_basis, measured_on, evidence, proof_url)
values
  ('amlakalahsa', 'no', null, null, null, '2026-11-10',
   'WordPress date_gmt moves forward when an ad is re-published: land 19748 «2026-11-03T16:40:38» (modified 46 s later) though first stored 2026-09-12; 45 of 302 dated live ads were dated after our first sight. The record carries no other date. A bump is never stored (ARCHITECTURE §20 rule 1); verbatim value kept as additional_info.date_gmt; date_added cleared 2026-11-10.',
   'https://amlakalahsa.com/land/%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d8%a7%d8%b1%d8%b6-%d9%81%d9%8a-%d8%a7%d9%84%d8%ad%d9%8a-%d8%a7%d9%84%d8%a7%d9%88%d9%84-%d8%a8%d8%b6%d8%a7%d8%ad%d9%8a%d8%a9-%d9%87%d8%ac%d8%b1-4/'),
  ('hajer', 'no', null, null, null, '2026-11-10',
   'WordPress date_gmt moves forward when an ad is re-published: post 1022 (HJ4010) «2026-10-10T10:45:58», modified the same second, though that link was stored 2026-06-21; 6 of 123 dated live ads were dated after our first sight. The page prints no other date. Verbatim value kept as additional_info.date_gmt; date_added cleared 2026-11-10.',
   'https://hajerhouses.com/property/%d8%b4%d9%82%d8%a9-%d9%84%d9%84%d8%a5%d9%8a%d8%ac%d8%a7%d8%b1-%d9%81%d9%8a-%d8%b4%d8%b1%d9%82-%d8%ad%d9%8a-%d8%a7%d9%84%d9%85%d9%84%d9%83-%d9%81%d9%87%d8%af-%d8%a7%d9%84%d9%85%d8%ad%d8%af%d9%88%d8%af/')
on conflict (platform) do update set
  publishes = excluded.publishes, read_from = excluded.read_from, baseline_fill_pct = excluded.baseline_fill_pct,
  baseline_basis = excluded.baseline_basis, measured_on = excluded.measured_on, evidence = excluded.evidence,
  proof_url = excluded.proof_url;

-- fahadalshahri (5 live ads): its product page carries a Yoast JSON-LD ItemPage datePublished with its zone, next to
-- a separate dateModified, read on 2026-11-10 from a plain request (the site answers some connections with a
-- reCAPTCHA «Bot Verification» 403, which is never crossed — then the scraper reads nothing and the date stays NULL).
insert into public.ops_source_posting_date_policy
  (platform, publishes, read_from, baseline_fill_pct, baseline_basis, measured_on, evidence, proof_url)
values
  ('fahadalshahri', 'yes', 'product page JSON-LD ItemPage datePublished (never dateModified)', 90, 'expected', '2026-11-10',
   'Read 2026-11-10: /product/فيلا-دورين-وملحق/ datePublished «2026-08-23T09:40:17+02:00», dateModified 2026-09-13; /product/شقق-حي-المروة-جدة/ «2026-08-23T09:35:59+02:00», modified 2026-09-13; all 5 published before first seen (2026-09-20). EXPECTED until the scraper has stored some; CI egress sometimes gets the bot-verification 403, which leaves NULL.',
   null)
on conflict (platform) do update set
  publishes = excluded.publishes, read_from = excluded.read_from, baseline_fill_pct = excluded.baseline_fill_pct,
  baseline_basis = excluded.baseline_basis, measured_on = excluded.measured_on, evidence = excluded.evidence,
  proof_url = excluded.proof_url;

-- Enrolled as a repair (the version is this file's: apply-migration.yml takes it from the filename).
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by) values
  ('20261110110000', 'republish_dates_are_not_posting_dates_and_fahadalshahri_reads_its_page',
   'amlakalahsa and hajer keep date_added NULL (their WordPress date_gmt moves forward on re-publish); no listing table''s posting dates fall after our own first sight often enough to be distrusted by welcome_posting_date_verdict().',
   'mon_detect_welcome_posting_date_untrusted', 'posting-dates session 2026-11-10 (map-session finding: dates later than first sight)')
on conflict do nothing;

-- The guard that saw it, on the fixed data: recompute today's check, then let its detector raise or clear.
select public.welcome_posting_date_check_run((select max(day) from public.welcome_insight_build));
select public.mon_detect_welcome_posting_date_untrusted();

do $$
begin
  if exists (select 1 from public.amlakalahsa_residential_listings where date_added is not null)
  or exists (select 1 from public.hajer_residential_listings where date_added is not null)
  or exists (select 1 from public.welcome_posting_date_check
              where day = (select max(day) from public.welcome_insight_build)
                and source_table in ('amlakalahsa_residential_listings', 'hajer_residential_listings') and distrusted) then
    raise exception 'PROOF: a re-publish date is still stored, or the guard still distrusts the table';
  end if;
end $$;
