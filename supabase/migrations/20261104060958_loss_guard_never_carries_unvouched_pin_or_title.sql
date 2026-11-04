-- THE LOSS GUARD NEVER CARRIES AN UNVOUCHED PIN OR TITLE DISTRICT (alert pin_district_unvouched, found 2026-11-04).
--
-- 20261103052931 taught refresh_district_recovery_table()'s LOSS GUARD to carry the would-be-lost rows of last
-- time's district_recovery into the new set instead of freezing the whole site. Correct for a district the SOURCE
-- wrote (owner 10-18: never drop a district) — but it carried basis 'pin' and basis 'title' rows too, and those are
-- not source words: a pin district is served only while a switched-on listing_pin_district row vouches for it
-- (owner 10-24, «تقريبي», never attestation), a title district only while listing_title_district still names it.
-- Measured 2026-11-04: 6 served ads (ashab 21084821/2/3 «حي العدامة», ialqarawi 12592760 «حي القلعة» / 12592849
-- «حي المجد», sirdab 13707406 «حي الرفاع») kept a pin district from 2026-10-30 22:10 whose listing_pin_district row
-- no longer exists — re-carried every hour by the guard, so mon_detect_pin_district_unvouched could never clear.
--
-- Now a carried (and a counted-as-lost) row must still be vouched for by the table its basis names. Source-word rows
-- (basis null / any other) are carried exactly as before. Live body patched, anchors checked exactly once, fail closed.
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure);
  v constant text := $v$
       and (coalesce(o.basis, '') not in ('pin', 'title')
            or (o.basis = 'pin' and exists (select 1 from public.listing_pin_district pv
                                             where pv.source_table = o.source_table and pv.listing_id = o.listing_id
                                               and pv.applied and pv.district_ar = o.district_ar))
            or (o.basis = 'title' and exists (select 1 from public.listing_title_district tv
                                               where tv.source_table = o.source_table and tv.listing_id = o.listing_id
                                                 and tv.district_ar = o.district_ar)))$v$;
  c_old constant text := $o$   where o.source_table = p_table and (v1.district_ar is null or btrim(v1.district_ar) = '');$o$;
  k_old constant text := $o$     where o.source_table = p_table and (v1.district_ar is null or btrim(v1.district_ar) = '')
    on conflict (source_table, listing_id) do nothing;$o$;
  c_new text := replace(c_old, '= '''');', '= '''')' || v || ';');
  k_new text := replace(k_old, E'= \'\')\n', E'= \'\')' || v || E'\n');
begin
  if (length(d) - length(replace(d, c_old, ''))) / length(c_old) <> 1
     or (length(d) - length(replace(d, k_old, ''))) / length(k_old) <> 1 then
    raise exception 'refresh_district_recovery_table: loss-guard anchors not found exactly once';
  end if;
  if c_new = c_old or k_new = k_old then
    raise exception 'refresh_district_recovery_table: vouch clause did not compose';
  end if;
  execute replace(replace(d, k_old, k_new), c_old, c_new);
  d := pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure);
  if (length(d) - length(replace(d, 'from public.listing_pin_district pv', ''))) / length('from public.listing_pin_district pv') <> 2 then
    raise exception 'refresh_district_recovery_table: vouch clause did not land in both the count and the carry';
  end if;
end
$mig$;
