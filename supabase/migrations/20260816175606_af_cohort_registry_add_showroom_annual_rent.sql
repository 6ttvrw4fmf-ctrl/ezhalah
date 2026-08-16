-- GAP FIX (2026-08-16 full-taxonomy audit): معرض/إيجار سنوي has 469 eligible rows and 23 fresh/7d
-- (street_width 85%/fresh 100%, property_age 100%, direction 84%) — MORE viable than معرض/بيع (88/3)
-- which was already certified. It was missed by the commercial build. Enable it on the shared
-- architecture. Questions (COHORT_QUESTIONS.Showroom.RentAnnual): property_age · street_width ·
-- direction. No utility chips (commercial showroom electricity 0% — wasalt doesn't publish it), no
-- furnished. Dry-run: readiness=0, no would-fire segments, no waivers needed. Floor 52 -> 53.
do $do$
declare readiness int; rich int; parity_n int; n int; snap jsonb; def text; occ int;
begin
  insert into public.af_cohort_registry(deal_ar,rent_period_ar,type_ar,enabled,note)
  values ('إيجار','سنوي','معرض',true,'Certified 2026-08-16 — Showroom/Rent-Annual (n=469, 23 fresh/7d; street+direction+age). Full-taxonomy audit gap fix.');

  select count(*) into n from public.af_cohort_registry where enabled;
  if n <> 53 then raise exception 'ABORT: expected 53 enabled rows, got %', n; end if;

  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname='mon_check_filter_parity_legacy' and p.pronamespace='public'::regnamespace;
  occ := (length(def)-length(replace(def,'< 52','')))/length('< 52');
  if occ <> 1 then raise exception 'ABORT: floor needle occurs %', occ; end if;
  def := replace(def,'< 52','< 53');
  occ := (length(def)-length(replace(def,'''floor'', 52','')))/length('''floor'', 52');
  if occ <> 1 then raise exception 'ABORT: floor-detail needle occurs %', occ; end if;
  def := replace(def,'''floor'', 52','''floor'', 53');
  execute def;

  select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into snap from public.mon_rich_attrs_drift_state d;
  select public.mon_af_new_listing_readiness() into readiness;
  select public.mon_rich_attrs_barrier() into rich;
  delete from public.mon_rich_attrs_drift_state;
  insert into public.mon_rich_attrs_drift_state select (jsonb_populate_record(null::public.mon_rich_attrs_drift_state,e.j)).* from jsonb_array_elements(snap) e(j);
  select count(*) into parity_n from public.mon_filter_parity_barrier();
  if readiness<>0 or rich<>0 or parity_n<>0 then
    raise exception 'ABORT: barriers not clean (readiness=% rich=% parity=%)', readiness, rich, parity_n;
  end if;
  if public.mon_check_filter_parity_legacy() <> 0 then raise exception 'ABORT: parity wrapper dirty'; end if;
  raise notice 'SUCCESS: معرض/rent registered (53 enabled); floor 53; barriers clean';
end $do$;