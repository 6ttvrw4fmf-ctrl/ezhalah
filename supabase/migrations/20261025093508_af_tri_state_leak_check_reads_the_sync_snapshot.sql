-- 🔬 AF engineer 2026-10-25: the null-to-false leak check compares search with the snapshot the sync reads.
--
-- mon_detect_af_tri_state_violations() raised P1 af_null_to_false_conversion at 04:59 UTC on 10-25 for
-- gathern 875022 / 878711 / 972781 / 735288 (elevator, parking, driver_room FALSE in search, NULL at source).
-- Nothing manufactured a FALSE. search_listings_ar is built from listing_extra_attrs_mv (refreshed by cron
-- job 17 at :20), while the check read the LIVE view listing_extra_attrs. Eleven gathern crawls between
-- 04:43 and 04:58 rewrote those rows after the 04:20 refresh, so a lawful change waiting for the next
-- refresh read as a tri-state violation. At 09:34 UTC the same rows agree everywhere and the leak count against
-- the snapshot is 0 on every field.
--
-- The check now joins listing_extra_attrs_mv. A real leak is search FALSE where the snapshot the sync read is
-- NULL: that is the sync or a writer after it manufacturing a negative, which is what this alert exists for.
-- A needle edit on the live body, fail-closed: exactly one occurrence of each needle or nothing changes, and
-- the post-check refuses a body that lost the ~20 h gate.
do $mig$
declare
  d text := pg_get_functiondef('public.mon_detect_af_tri_state_violations'::regproc);
  join_old constant text := 'join public.listing_extra_attrs e using (source_table, listing_id)';
  join_new constant text := 'join public.listing_extra_attrs_mv e using (source_table, listing_id)';
  why_old constant text := 'boolean is NULL in listing_extra_attrs became FALSE ';
  why_new constant text := 'boolean is NULL in listing_extra_attrs_mv (the snapshot the sync reads) became FALSE ';
  after text;
begin
  if (length(d) - length(replace(d, join_old, ''))) / length(join_old) <> 1 then
    raise exception 'tri-state detector: expected exactly one live-view join, body changed under us';
  end if;
  if (length(d) - length(replace(d, why_old, ''))) / length(why_old) <> 1 then
    raise exception 'tri-state detector: expected exactly one why sentence, body changed under us';
  end if;
  execute replace(replace(d, join_old, join_new), why_old, why_new);
  after := pg_get_functiondef('public.mon_detect_af_tri_state_violations'::regproc);
  if position(join_new in after) = 0 or position(join_old in after) > 0
     or position('mon_claim_daily_slot(''mon_detect_af_tri_state_violations'')' in after) = 0 then
    raise exception 'tri-state detector: post-check failed';
  end if;
end
$mig$;
