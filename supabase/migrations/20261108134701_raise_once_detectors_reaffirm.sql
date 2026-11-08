-- 🔧 2026-11-08: four detectors that raised ONCE and then froze their own alert now re-affirm it every sweep.
--
-- mon_detect_served_total_below_city_floor (P1 9996, owner 10-18 «we can get sued», frozen since 2026-10-18 with the
-- numbers of the day it was born: 430 rows while the live set was 147 on 11-04), mon_detect_af_view_drops_stored_answer,
-- mon_detect_served_pin_outside_ksa and mon_detect_wasalt_street_width_misread wrapped their mon_raise() in
-- «elsif not exists (select 1 from alert_event where dedup_key = … and resolved_at is null) then». mon_raise() is the
-- only writer of last_affirmed_at and the one that refreshes the payload and escalates an open alert, so behind that
-- guard an open alert never moved and read as «no detector stands behind it» (backlog 1339: the 11-04 fix was written
-- as a full redefinition and never applied — the connector held it on LIMB A's scratch cleanup). This is the same fix
-- as a one-token edit on the LIVE bodies: the guard becomes «else», so a still-true condition calls mon_raise() every
-- sweep (it dedups itself) and a zero still resolves, exactly as before. Nothing else in the four bodies changes.
do $$
declare
  f text;
  d text;
  d2 text;
  n_total int := 0;
  guard constant text := 'elsif not exists \(select 1 from public\.alert_event where dedup_key = ''[a-z_]+'' and resolved_at is null\) then';
begin
  foreach f in array array['mon_detect_served_total_below_city_floor', 'mon_detect_af_view_drops_stored_answer',
                           'mon_detect_served_pin_outside_ksa', 'mon_detect_wasalt_street_width_misread']
  loop
    select pg_get_functiondef(('public.' || f)::regproc) into d;
    d2 := regexp_replace(d, guard, 'else', 'g');
    if d2 = d then
      raise exception '% carries no raise-once guard any more — re-read before editing', f;
    end if;
    n_total := n_total + (select count(*) from regexp_matches(d, guard, 'g'));
    execute d2;
  end loop;
  if n_total <> 5 then
    raise exception 'expected 5 guards across the four detectors (2 in served_total_below_city_floor), found %', n_total;
  end if;
  raise notice 'raise-once guards replaced: %', n_total;
end $$;

-- PROOF (pure reads): no roster detector among the four still carries the guard, and each still raises and resolves.
do $$
declare
  r record;
  n_bad int := 0;
begin
  for r in
    select p.proname, pg_get_functiondef(p.oid) def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('mon_detect_served_total_below_city_floor', 'mon_detect_af_view_drops_stored_answer',
                         'mon_detect_served_pin_outside_ksa', 'mon_detect_wasalt_street_width_misread')
  loop
    if r.def ~ 'elsif not exists \(select 1 from public\.alert_event' then
      n_bad := n_bad + 1; raise warning '% still carries the guard', r.proname;
    end if;
    if r.def !~ 'mon_raise\(' or r.def !~ 'mon_resolve' then
      n_bad := n_bad + 1; raise warning '% lost its raise or resolve path', r.proname;
    end if;
  end loop;
  if n_bad > 0 then raise exception '% proof check(s) failed', n_bad; end if;
  raise notice 'four detectors re-affirm every sweep; raise and resolve paths intact';
end $$;