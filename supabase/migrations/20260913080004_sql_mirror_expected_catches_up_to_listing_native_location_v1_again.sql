-- P1 sql_mirror_drift has been open since 2026-09-11 19:29 and is a FALSE POSITIVE.
--
-- The mirror FILE is byte-correct against production. Proven two ways on 2026-09-13:
--   * sql/mirrors/listing_native_location_v1.sql records md5 52b8d750cd49b1f46fdb471499678afc
--     in its header, and scripts/verify-sql-mirrors-not-stale.ts recomputes the file BODY to the
--     same value (header=52b8d750… body=52b8d750…);
--   * mon_live_object_md5('listing_native_location_v1','view') returns 52b8d750cd49b1f46fdb471499678afc.
-- File == live. What is wrong is ops_sql_mirror_expected.expected_md5, which holds
-- 862a10b719341ab0d425b81b02d69871 — a value matching NEITHER side of the comparison it exists
-- to make, so the detector compares live against a number nothing else in the system believes.
--
-- HOW IT GOT THERE, and why this is the second time. 20260911155123 set expected_md5 to
-- 862a10b7… to catch up to a regeneration. The next day the amlakalahsa activation
-- (20260912190822) regenerated the view again — md5 moved to 52b8d750… — and updated the mirror
-- FILE and its header, but not this registry row. Regenerating a mirror is thus a two-place edit
-- where only one place is enforced, and the unenforced place is the one the P1 reads.
-- scripts/verify-mirror-md5-is-registered.ts (added with this change) closes that: a mirror
-- header md5 that no committed migration ever writes as an expected_md5 is now RED offline,
-- which would have caught 2026-09-12 on the PR that made it.
--
-- Nothing about production behaviour changes here; this corrects an ops bookkeeping value only.
update public.ops_sql_mirror_expected
   set expected_md5 = '52b8d750cd49b1f46fdb471499678afc'
 where object_name = 'listing_native_location_v1'
   and object_kind = 'view'
   and expected_md5 = '862a10b719341ab0d425b81b02d69871';

do $$
begin
  if not exists (select 1 from public.ops_sql_mirror_expected
                  where object_name='listing_native_location_v1'
                    and expected_md5='52b8d750cd49b1f46fdb471499678afc') then
    raise exception 'update did not land — expected_md5 still wrong';
  end if;
  -- Prove against the LIVE object, not just against the literal we just wrote.
  if public.mon_live_object_md5('listing_native_location_v1','view')
     is distinct from '52b8d750cd49b1f46fdb471499678afc' then
    raise exception 'live md5 is not what this migration claims — do NOT paper over real drift';
  end if;
end $$;
