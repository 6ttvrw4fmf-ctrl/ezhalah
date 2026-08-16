-- CONTROL PLANE: register every VIABLE commercial + rural + land cohort from the 2026-08-16
-- overnight profiling (20 type×deal cohorts profiled from live fresh-band data; 13 documented
-- NOT-VIABLE stay Normal-Filter-only: Chalet ×2, Camp ×2, Factory ×2, Staff Housing ×2, Service
-- Facilities ×2, Hotel/rent n=25, Farm/rent fresh=3, CommLand/rent n=23, IndLand/rent n=0,
-- AgriPlot/rent n=5 — evidence in docs/AF_COHORT_LEDGER.md). Monthly stays FROZEN — no شهري row.
-- 12 waivers first: land types have NO building amenities (AC/elevator/kitchen/private-entrance);
-- their 22-33%% all-time known-rates are June-bulk-era artifacts, fresh 0%% is correct source truth
-- (same fresh rows parse street_width ~99%%). Freeze-guard floor raised 24 -> 53 in-transaction.
do $do$
declare readiness int; rich int; parity_n int; n int; snap jsonb; def text; occ int;
begin
  insert into public.ops_amenity_capture_verified (source_table, field, deal_ar, rent_period_key, type_ar, note)
  select 'aqar_residential_listings', f, 'بيع', '*', t,
         '2026-08-16 commercial build: LAND has no building amenities — fresh 0% is correct source truth; the all-time rate is June-bulk-era artifact. Same fresh rows parse street_width ~99%.'
  from unnest(array['air_conditioner','elevator','kitchen','private_entrance']) f,
       unnest(array['أرض تجارية','أرض زراعية','أرض صناعية']) t;

  insert into public.af_cohort_registry(deal_ar, rent_period_ar, type_ar, enabled, note) values
    ('بيع',null,'مكتب',true,'Certified 2026-08-16 — Office/Buy (n=60, thin: age+street).'),
    ('إيجار','سنوي','مكتب',true,'Certified 2026-08-16 — Office/Rent-Annual (n=2,140; age+furnished+utility chips; AC rejected fresh-dead).'),
    ('بيع',null,'مكاتب مشتركة',true,'Family rider — rides Office search (n=0 buy).'),
    ('إيجار','سنوي','مكاتب مشتركة',true,'Family rider — rides Office search (n=5).'),
    ('بيع',null,'محل',true,'Certified 2026-08-16 — Shop/Buy (n=286; street+direction+age+utility chips; aqar 97.6%).'),
    ('إيجار','سنوي','محل',true,'Certified 2026-08-16 — Shop/Rent-Annual (n=1,982; strongest commercial cohort).'),
    ('بيع',null,'كشك',true,'Family rider — rides Shop search (n=3).'),
    ('إيجار','سنوي','كشك',true,'Family rider — rides Shop search (n=52).'),
    ('بيع',null,'درايف ثرو',true,'Family rider — rides Shop search (n=0 buy).'),
    ('إيجار','سنوي','درايف ثرو',true,'Family rider — rides Shop search (n=1).'),
    ('بيع',null,'معرض',true,'Certified 2026-08-16 — Showroom/Buy (n=88, thin: age+street; options gate per-scope).'),
    ('بيع',null,'مستودع',true,'Certified 2026-08-16 — Warehouse/Buy (n=147; age+street+utility chips).'),
    ('إيجار','سنوي','مستودع',true,'Certified 2026-08-16 — Warehouse/Rent-Annual (n=1,175; fresh supply dealapp-first).'),
    ('بيع',null,'ورشة',true,'Certified 2026-08-16 — Workshop/Buy (n=74; street+age).'),
    ('إيجار','سنوي','ورشة',true,'Certified 2026-08-16 — Workshop/Rent-Annual (n=141; street+age+direction).'),
    ('بيع',null,'مبنى تجاري',true,'Certified 2026-08-16 — CommBldg/Buy (n=179; age+street+direction+utility chips). عمارة commercial rows already covered by the ResBldg registry rows.'),
    ('إيجار','سنوي','مبنى تجاري',true,'Certified 2026-08-16 — CommBldg/Rent-Annual (n=347).'),
    ('بيع',null,'فندق',true,'Certified 2026-08-16 — Hotel/Buy (n=69, thin; rent n=25 NOT-VIABLE).'),
    ('بيع',null,'محطة وقود',true,'Certified 2026-08-16 — GasStation/Buy (n=78; age+street+chips).'),
    ('إيجار','سنوي','محطة وقود',true,'Certified 2026-08-16 — GasStation/Rent-Annual (n=49, thin; options gate per-scope).'),
    ('بيع',null,'أرض تجارية',true,'Certified 2026-08-16 — CommLand/Buy (n=17,509 — largest cohort in the system; street+direction).'),
    ('بيع',null,'أرض صناعية',true,'Certified 2026-08-16 — IndLand/Buy (n=1,794; street+direction; aqar monoculture flag).'),
    ('بيع',null,'أرض سكنية',true,'Certified 2026-08-16 — ResLand/Buy (n=10,338; street+direction; dealapp+wasalt+aqar diverse).'),
    ('إيجار','سنوي','أرض سكنية',true,'Certified 2026-08-16 — ResLand/Rent-Annual (n=412, thin; street+direction).'),
    ('بيع',null,'استراحة',true,'Certified 2026-08-16 — RestHouse/Buy (n=1,712; age+street+direction+water/sanitation chips).'),
    ('إيجار','سنوي','استراحة',true,'Certified 2026-08-16 — RestHouse/Rent-Annual (n=1,268; age+street+kitchen/electricity chips).'),
    ('بيع',null,'مزرعة',true,'Certified 2026-08-16 — Farm/Buy (n=233; street+direction+age; 15-platform diversity). Farm/rent held (fresh 3/wk).'),
    ('بيع',null,'أرض زراعية',true,'Certified 2026-08-16 — AgriPlot/Buy (n=1,009; the land quintet: street+direction+electricity/water/sanitation).');

  select count(*) into n from public.af_cohort_registry where enabled;
  if n <> 52 then raise exception 'ABORT: expected 52 enabled rows, got %', n; end if;

  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname='mon_check_filter_parity_legacy' and p.pronamespace='public'::regnamespace;
  occ := (length(def) - length(replace(def, '< 24', ''))) / length('< 24');
  if occ <> 1 then raise exception 'ABORT: floor needle occurs %', occ; end if;
  def := replace(def, '< 24', '< 52');
  occ := (length(def) - length(replace(def, '''floor'', 24', ''))) / length('''floor'', 24');
  if occ <> 1 then raise exception 'ABORT: floor-detail needle occurs %', occ; end if;
  def := replace(def, '''floor'', 24', '''floor'', 52');
  execute def;

  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into snap from public.mon_rich_attrs_drift_state d;
  select public.mon_af_new_listing_readiness() into readiness;
  select public.mon_rich_attrs_barrier() into rich;
  delete from public.mon_rich_attrs_drift_state;
  insert into public.mon_rich_attrs_drift_state
    select (jsonb_populate_record(null::public.mon_rich_attrs_drift_state, e.j)).*
    from jsonb_array_elements(snap) e(j);
  select count(*) into parity_n from public.mon_filter_parity_barrier();
  if readiness <> 0 or rich <> 0 or parity_n <> 0 then
    raise exception 'ABORT: barriers not clean (readiness=% rich=% parity=%)', readiness, rich, parity_n;
  end if;
  if public.mon_check_filter_parity_legacy() <> 0 then
    raise exception 'ABORT: parity wrapper dirty after floor raise';
  end if;
  raise notice 'SUCCESS: 28 commercial/rural/land cohort rows registered (52 enabled); 12 evidenced land waivers; floor 52; all barriers clean';
end $do$;