-- Enroll re-apply 20261025164000 (the 10 rows of repair 20261025153723 that pre-PR-8686 crawls turned back to yes) in the
-- repair-guarantee registry, under the same invariant and detector.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values
  ('20261025164000',
   'kitchen_not_installed_reapply',
   'Same invariant as 20261025153723: no active ad on a prose-read kitchen site stores kitchen = true while its own words '
   || 'say «مطبخ غير راكب» right after it. These 10 rows were re-written by crawls dispatched on commits before PR 8686.',
   'mon_detect_not_installed_served_as_yes',
   'kitchen not-installed repair 2026-10-25 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'rows_changed', 10, 'rows_active', 10,
     'reverted_by', 'small-sources sync on 197d3728 (dwelleo) and the 15:05 haraj sync on 2d5b4851',
     'detector_rows_before', 8,
     'detector_rows_after', 0,
     'detector_on_roster', true,
     'forward_fix', 'PR 8686 (every crawl from b33778a0 on)'))
on conflict do nothing;
