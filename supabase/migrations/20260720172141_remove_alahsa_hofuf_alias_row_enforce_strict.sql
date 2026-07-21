-- Recovered verbatim from production supabase_migrations.schema_migrations on 2026-07-21
-- (drift reconciliation — applied to prod by the Al-Ahsa strict-city work / PR #163 but never
-- committed to git; the deploy drift gate flagged it as missing_in_git).

-- Found while verifying the al_ahsa cluster removal (migration
-- remove_al_ahsa_city_cluster_enforce_strict_city_match): a SEPARATE mechanism,
-- loc_catalog_city_alias, had a row aliasing "الاحساء" (normalized) directly to city_id=12
-- (الهفوف) — a different table than loc_city_cluster, but the same underlying effect: searching
-- الأحساء (its own real catalog city, id=3677, 1508 real listings) also pulled in ALL of الهفوف's
-- 712 listings via the RPC's city_ids resolution (normalize_ar('الاحساء') matched this alias row,
-- adding city_id=12 to the resolved city_ids set alongside 3677). Live-verified: searching الأحساء
-- returned 2220 (1508 + 712) instead of its own 1508 before this fix. Removing this alias row
-- fully completes the owner's 2026-07-20 "make it strict too" decision for these two real, distinct
-- cities — no other alias rows exist for city_id in (12, 2748, 3677) (checked).
delete from public.loc_catalog_city_alias where alias_norm = normalize_ar('الاحساء') and city_id = 12;
