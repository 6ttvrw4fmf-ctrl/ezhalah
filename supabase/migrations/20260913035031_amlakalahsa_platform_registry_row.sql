-- amlakalahsa has real tables/rows and an ops_liveness_registry entry, but was never inserted
-- into platform_registry (a separate registry that scripts/gen-searchable-tables.ts and the
-- "unmonitored searchable platforms" check both read). ops_searchable_platforms_unmonitored()
-- currently reports it as the exact muktamel-shaped blind spot that check exists to catch.
-- Values match its sibling recently-added source platforms (status=active, kind=source,
-- expected_cadence_hours=24, window_days=7) — same shape as abralosol/abwbna above it.
insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values ('amlakalahsa', 'active', 24, 7, null, 'source', now())
on conflict (platform) do nothing;