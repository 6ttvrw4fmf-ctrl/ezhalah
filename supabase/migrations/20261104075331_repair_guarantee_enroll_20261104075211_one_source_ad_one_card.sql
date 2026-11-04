-- Enroll the 2026-11-04 one-source-ad-one-card repair (20261104075211) in the orphaned-guarantee
-- registry. Data-only insert: no DDL, so PostgREST does not reload its schema cache.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by)
values ('20261104075211',
        'retire_second_copy_of_one_source_ad_wasalt_hajer',
        'No source ad is production_ready in both a platform''s residential and commercial table under the same ad_number and URL (wasalt routes each ad by its own «Property usage» and supersedes the sibling).',
        'mon_detect_url_collisions_res_vs_com',
        'card-identity engineer 2026-11-04 (author of the repair)')
on conflict do nothing;
