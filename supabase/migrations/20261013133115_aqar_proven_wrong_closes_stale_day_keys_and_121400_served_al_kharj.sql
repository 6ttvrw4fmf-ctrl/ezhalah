-- 🔧 Quality & Repair 2026-10-13: (1) aqar 121400 served the wrong city; (2) a day-keyed detector closes yesterday's key.
--
-- (1) aqar_residential_listings 121400: raw city «Al Kharj», neighbourhood «حي الصفاء»; aqar_shadow_resolved
-- served الهياثم (1071) while listings_arabic_locations and aqar_classify_shadow_drift() (PROVEN_WRONG) say
-- الخرج (1061). The detector's own 'fix' recipe is applied: log + shadow + served row, each guarded on the exact
-- value it replaces.
--
-- (2) mon_detect_aqar_proven_wrong_resolution raises under 'aqar_proven_wrong_resolution:<today>' and, when the
-- condition clears, resolves ONLY today's key. Every earlier day's key stays open forever: on 2026-10-13 the
-- repair queue carried 17 open alerts of this kind for a condition that was down to ONE row (16 keys from
-- 2026-09-26 … 2026-10-11, all closed-in-reality). A standing alert nobody can close is noise that hides the
-- real one. The detector now resolves every open key of its kind other than today's, in BOTH branches: the
-- newest key carries the state. Proof is the next detector run: open keys 17 → 0 once (1) is in.
-- (The other six day-keyed detectors had 0 stale keys on 2026-10-13; the class is in ops_engineer_backlog.)

insert into public.aqar_resolver_log (src_table, id, city_id) values ('aqar_residential_listings', 121400, 1061);

update public.aqar_shadow_resolved
   set city_ar_parsed = 'الخرج', region_ar_parsed = 'منطقة الرياض', parsed_city_id = 1061,
       today_city = 'الخرج', today_region = 'منطقة الرياض', today_city_id = 1061
 where src_table = 'aqar_residential_listings' and id = 121400 and parsed_city_id = 1071;

update public.search_listings_ar
   set city_ar = 'الخرج', city_id = 1061, region_ar = 'منطقة الرياض', region_id = 1
 where source_table = 'aqar_residential_listings' and listing_id = 121400 and city_id = 1071;

create or replace function public.mon_detect_aqar_proven_wrong_resolution()
 returns integer
 language plpgsql
as $function$
declare
  n int;
  sample jsonb;
  v_today text := 'aqar_proven_wrong_resolution:' || current_date;
begin
  select count(*) into n from public.aqar_classify_shadow_drift() where category = 'PROVEN_WRONG';

  -- Yesterday's key is never the live state: the newest key is. Close every older open key of this kind.
  perform public.mon_resolve_key('aqar_proven_wrong_resolution', e.dedup_key)
    from public.alert_event e
   where e.kind = 'aqar_proven_wrong_resolution' and e.resolved_at is null and e.dedup_key <> v_today;

  if n > 0 then
    select jsonb_agg(jsonb_build_object(
             'src_table', src_table, 'id', id, 'raw_city', raw_city,
             'old_city_ar', old_city_ar, 'fresh_city_ar', fresh_city_ar, 'neighborhood', neighborhood))
      into sample
      from (select * from public.aqar_classify_shadow_drift() where category = 'PROVEN_WRONG' limit 10) s;
    perform public.mon_raise('P1', 'aqar_proven_wrong_resolution', 'aqar',
      v_today,
      jsonb_build_object('count', n, 'sample', sample,
        'why', 'the listing''s own neighborhood field matches a real catalog district under a '
            || 'DIFFERENT city than the one aqar_shadow_resolved currently serves for it - this is '
            || 'concrete, per-row proof of a wrong city, not a taxonomy question.',
        'fix', 'update aqar_shadow_resolved.{city_ar_parsed,region_ar_parsed,parsed_city_id} and '
            || 'the matching search_listings_ar row to the fresh values from '
            || 'aqar_classify_shadow_drift(), then log to aqar_resolver_log.'));
  else
    perform public.mon_resolve_key('aqar_proven_wrong_resolution', v_today);
  end if;

  return n;
end;
$function$;