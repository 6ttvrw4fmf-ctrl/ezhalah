-- ♻️ 2026-11-08: hide 16 shown ads whose OWN page read gone on two independent readers, inside the slot
-- (LIFECYCLE_ENGINEER.md lesson 2026-10-18: a confirmed-gone ad is hidden inside the slot, never handed to
-- tomorrow's strikes; owner standing approval C: «hide what is gone on two reads»).
--   bossbih (11, commercial): fleet_liveness:bossbih APPLY 2026-11-08 07:22 UTC struck 16 (controls passed);
--     lifecycle-spot-check run 42474608378 (11:11 UTC, method site-oracle, canaries 5/5) read all 11 gone.
--     12603216 / 12603217 are the dead-visible score's gone_ids tonight (bossbih over the line).
--   sadiqeltajer (1): fleet_liveness:sadiqeltajer APPLY 08:19 UTC struck 2; spot-check 42474610507 (canaries 5/5)
--     read 14753514 gone (the score's gone_id tonight, sadiqeltajer over the line).
--   aqarcity (4): fleet_liveness:aqarcity SHADOW read them dead at 11-07 14:39, 20:59, 11-08 03:53 and 07:21 UTC;
--     spot-check 42474692308 (canaries 5/5) read all 4 gone.
-- Registered in ops_adjudicated_retraction first so auto_recover_false_inactive() cannot undo the decision;
-- mon_detect_adjudicated_reactivation raises if any is served again. Only rows still active are touched.
set local lock_timeout = '5s';

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select v.tbl, v.id,
       'lifecycle 2026-11-08: own ad page read GONE by two readers (fleet_liveness + lifecycle-spot-check site-oracle, canaries 5/5)',
       jsonb_build_object('first_reader', v.first_reader, 'second_reader', v.second_reader,
                          'migration', '20261108112500_lifecycle_hide_16_read_gone_twice',
                          'watched_by', 'mon_detect_adjudicated_reactivation')
from (values
  ('bossbih_commercial_listings', 12602958::bigint, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603043, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603044, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603045, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603046, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603047, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603138, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603189, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603203, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603216, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('bossbih_commercial_listings', 12603217, 'fleet_liveness:bossbih 2026-11-08 07:22', 'spot-check 42474608378'),
  ('sadiqeltajer_residential_listings', 14753514, 'fleet_liveness:sadiqeltajer 2026-11-08 08:19', 'spot-check 42474610507'),
  ('aqarcity_residential_listings', 593734, 'fleet_liveness:aqarcity shadow x4 (11-07 14:39 .. 11-08 07:21)', 'spot-check 42474692308'),
  ('aqarcity_residential_listings', 593732, 'fleet_liveness:aqarcity shadow x4 (11-07 14:39 .. 11-08 07:21)', 'spot-check 42474692308'),
  ('aqarcity_commercial_listings', 22704115, 'fleet_liveness:aqarcity shadow x4 (11-07 14:39 .. 11-08 07:21)', 'spot-check 42474692308'),
  ('aqarcity_commercial_listings', 22704113, 'fleet_liveness:aqarcity shadow x4 (11-07 14:39 .. 11-08 07:21)', 'spot-check 42474692308')
) as v(tbl, id, first_reader, second_reader)
where not exists (select 1 from public.ops_adjudicated_retraction r
                   where r.source_table = v.tbl and r.listing_id = v.id);

update public.bossbih_commercial_listings t
   set active = false, deactivated_at = now()
 where t.active
   and t.id in (12602958, 12603043, 12603044, 12603045, 12603046, 12603047, 12603138, 12603189, 12603203, 12603216, 12603217);

update public.sadiqeltajer_residential_listings t
   set active = false, deactivated_at = now()
 where t.active and t.id = 14753514;

update public.aqarcity_residential_listings t
   set active = false, deactivated_at = now()
 where t.active and t.id in (593734, 593732);

update public.aqarcity_commercial_listings t
   set active = false, deactivated_at = now()
 where t.active and t.id in (22704115, 22704113);
