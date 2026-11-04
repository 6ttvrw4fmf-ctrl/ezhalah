-- Enroll 20261104013008 (billion-price leftovers) in the orphaned-guarantee registry. Data-only insert, no DDL.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by)
values ('20261104013008', 'billion_price_leftovers_wasalt_two_gone_dealapp_source_published',
        'No served price over 1,000,000,000 SAR that no page read has proven; the two wasalt ads proven 404 on both routes stay hidden (adjudicated).',
        'mon_detect_served_billion_price_unproven', 'outside engineer 2026-11-04 (author of the repair, backlog 1261)')
on conflict do nothing;