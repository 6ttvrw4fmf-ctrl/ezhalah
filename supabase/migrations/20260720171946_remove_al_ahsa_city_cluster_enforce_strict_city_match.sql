-- Recovered verbatim from production supabase_migrations.schema_migrations on 2026-07-21
-- (drift reconciliation — applied to prod by the Al-Ahsa strict-city work / PR #163 but never
-- committed to git; the deploy drift gate flagged it as missing_in_git).

-- Owner decision 2026-07-20: "make it strict too" — the al_ahsa city cluster (merging
-- الهفوف/city_id=12, المبرز/city_id=2748, الأحساء/city_id=3677 into one combined search result,
-- migration 20260708063551_al_ahsa_city_cluster) directly conflicts with the new City-field rule
-- ("never merge two different cities just because they have the same/related name" —
-- project_city-id-search-identity-permanent-rule). Confirmed live: selecting المبرز alone
-- previously returned 763 rows, of which only 1 was genuinely المبرز (the rest were الهفوف/الأحساء).
--
-- composite_match_city_ids() has TWO independent, cleanly-separated responsibilities: (1) parsing
-- genuine multi-location composite labels like "الدمام وسيهات" (a DIFFERENT, still-wanted, still-
-- correct owner rule from 2026-07-07 — a listing that legitimately names multiple places should
-- match all of them), and (2) a separately-commented "CLUSTER EXPANSION" block that expands any
-- resolved city to every sibling in loc_city_cluster. loc_city_cluster has EXACTLY 3 rows, all
-- cluster_key='al_ahsa' — it is the ONLY cluster ever configured. Deleting these 3 rows makes the
-- cluster-expansion block's `exists (select 1 from loc_city_cluster ...)` check always false —
-- a full no-op — for every city, with ZERO code change and ZERO effect on the composite-label
-- parsing logic (part 1), which stays completely untouched.
delete from public.loc_city_cluster where cluster_key = 'al_ahsa';

-- match_city_ids is a STORED column (BEFORE INSERT/UPDATE trigger set_match_city_ids →
-- composite_match_city_ids()), not computed live — existing rows keep their old, cluster-expanded
-- value until touched. Force a recompute for exactly the 2,225 rows across the 3 affected cities
-- (712 الهفوف + 5 المبرز + 1508 الأحساء) via a no-op UPDATE (city_ar := city_ar) that still fires
-- the trigger. Scoped tightly to these 3 city_ids only — no other row in the table is touched.
update public.search_listings_ar
set city_ar = city_ar
where city_id in (12, 2748, 3677);
