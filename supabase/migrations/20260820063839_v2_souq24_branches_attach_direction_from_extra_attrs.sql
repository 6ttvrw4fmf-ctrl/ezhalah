-- Senior Production Engineer run #32 (2026-08-20). Residue of the same defect class as
-- 20260820_v2_catchall_branch_attaches_extra_attrs_instead_of_null_literals, found by the barrier
-- written for that fix: with the catch-all branch repaired, the ONLY remaining place where
-- listing_extra_attrs holds a value that listing_native_location_v2 discards is the two souq24
-- inline_lookup branches, which hardcode NULL::text AS direction.
--
-- 30 souq24 listings carry a canonical direction in listing_extra_attrs -- جنوب 7, شمال 6, غرب 6,
-- شرق 5+1, شمال شرقي 5, جنوب شرقي 1 -- every one of them already inside the exact whitelist
-- sync_search_listings_ar applies to v.direction. They were unreachable by the direction Advanced
-- Filter purely because of the NULL literal.
--
-- Same remedy and same shape as 20260717_v2_souq24_branches_attach_age_resolved, which attached
-- property_age to these very branches: a scalar subquery on the branch's own key
-- (listing_extra_attrs is unique on source_table+listing_id -> cardinality-safe). Applied as a
-- guarded needle-edit with per-branch anchors asserted to appear exactly once.
--
-- VERIFIED against a test view BEFORE applying (test vs live, same snapshot):
--   196,004 rows both sides; 0 non-target column diffs; 30 direction diffs, ALL souq24;
--   30 NULL->value gains; 0 value->NULL losses; 0 diffs outside souq24.

do $$
declare v_def text; v_new text; a_res text; a_com text; n_res int; n_com int;
begin
  select pg_get_viewdef(c.oid,true) into v_def from pg_class c where c.relname='listing_native_location_v2';

  a_res := '''souq24_residential_listings''::text AND ar.listing_id = s.id) AS property_age,
    NULL::text AS direction,';
  a_com := '''souq24_commercial_listings''::text AND ar.listing_id = s.id) AS property_age,
    NULL::text AS direction,';

  n_res := (length(v_def) - length(replace(v_def, a_res, ''))) / length(a_res);
  n_com := (length(v_def) - length(replace(v_def, a_com, ''))) / length(a_com);
  if n_res <> 1 or n_com <> 1 then
    raise exception 'REFUSED: souq24 anchors not unique (res=%, com=%)', n_res, n_com;
  end if;

  v_new := replace(v_def, a_res,
'''souq24_residential_listings''::text AND ar.listing_id = s.id) AS property_age,
    ( SELECT ea.direction
           FROM listing_extra_attrs ea
          WHERE ea.source_table = ''souq24_residential_listings''::text AND ea.listing_id = s.id) AS direction,');
  v_new := replace(v_new, a_com,
'''souq24_commercial_listings''::text AND ar.listing_id = s.id) AS property_age,
    ( SELECT ea.direction
           FROM listing_extra_attrs ea
          WHERE ea.source_table = ''souq24_commercial_listings''::text AND ea.listing_id = s.id) AS direction,');

  if v_new = v_def then raise exception 'REFUSED: no change'; end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || v_new;
end $$;

drop view if exists public.listing_native_location_v2_test;
