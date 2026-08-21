-- Data Integrity run #33: 20260820074258 legitimately redefined listing_native_location_v1
-- (the legacy branch now resolves a city inside the region its source published). The mirror
-- sql/mirrors/listing_native_location_v1.sql was regenerated verbatim in the same PR (#814), but
-- ops_sql_mirror_expected still carried the OLD digest, so mon_detect_sql_mirror_drift raised a
-- P1 at 07:59 against a change that is correct and already mirrored.
--
-- That P1 is not cosmetic: mon_raise() returns 0 for an already-open dedup key, so a mirror drift
-- key left standing on a KNOWN-good change would swallow the next REAL drift silently (23a). The
-- detector's own guidance says to update this table in the same migration as the regeneration --
-- this is that update, landed as soon as the omission was found.
--
-- Digest re-derived from live production, not copied from the mirror file:
--   md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true))
--     = 31036a9c8b92fddc5293b700985b869d  (14,127 chars)
--   previous = d7fff7ec0378d6095728e862aee80106  (13,385 chars)
-- The mirror file body hashes to the same value, which is what makes the two agree.
do $$
declare v_live text; v_before text;
begin
  select expected_md5 into v_before from public.ops_sql_mirror_expected
   where object_name = 'listing_native_location_v1';
  if v_before is null then
    raise exception 'no ops_sql_mirror_expected row for listing_native_location_v1';
  end if;

  v_live := public.mon_live_object_md5('listing_native_location_v1', 'view');
  if v_live is null then raise exception 'could not read the live object digest'; end if;

  -- Refuse to rubber-stamp: only advance to the digest production ACTUALLY reports right now.
  if v_live <> '31036a9c8b92fddc5293b700985b869d' then
    raise exception 'live digest % is not the reviewed value - refusing to update blind', v_live;
  end if;

  update public.ops_sql_mirror_expected
     set expected_md5 = v_live
   where object_name = 'listing_native_location_v1';

  if (select expected_md5 from public.ops_sql_mirror_expected
       where object_name = 'listing_native_location_v1') <> v_live then
    raise exception 'update did not take';
  end if;
end $$;

-- Prove the detector goes GREEN on the evaluated path, and that the other two mirrors still match.
do $$
declare n int; still_drifted int;
begin
  select count(*) into still_drifted
    from public.ops_sql_mirror_expected m
   where public.mon_live_object_md5(m.object_name, m.object_kind) is distinct from m.expected_md5;
  if still_drifted <> 0 then
    raise exception 'ops_sql_mirror_expected still disagrees with production for % object(s)', still_drifted;
  end if;

  n := public.mon_detect_sql_mirror_drift();
  if n <> 0 then raise exception 'detector still raising after the digest update (returned %)', n; end if;

  if exists (select 1 from public.alert_event
              where kind = 'sql_mirror_drift' and resolved_at is null) then
    raise exception 'sql_mirror_drift alert did not resolve';
  end if;
end $$;
