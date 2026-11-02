-- District guards (owner 2026-10-25: «let's also add these guards»). Enforced by the database, so no session, script or
-- engineer can skip them:
--   1) the district list never loses a district (no DELETE, no TRUNCATE);
--   2) a new or renamed list name must be a real district name: no number, no plan «مخطط», no base «قاعدة», no street
--      «شارع», no road «طريق», no villages «قرى», not a single letter;
--   3) a new or renamed list name must not be a spelling twin of a name already on that city's list (district_twin_check);
--      an owner-approved exception sets ezhalah.district_guard_ok for that one statement;
--   4) a district read from a map pin (listing_pin_district) must already be on the list for that listing's city, and is
--      stored in the list's own spelling, so a map answer can never add a name or a second spelling;
--   5) the alarm mon_detect_district_guards_missing() raises P1 if any of these triggers is dropped or disabled.

create or replace function public.trg_district_list_guard()
returns trigger
language plpgsql set search_path to 'public'
as $function$
declare v_norm text; v_twin record; v_ok text := nullif(current_setting('ezhalah.district_guard_ok', true), '');
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'district list guard: districts are never deleted (owner 2026-10-25)';
  end if;
  v_norm := public.norm_district_tok(new.district_ar);
  if v_norm is null or v_norm = '' then
    raise exception 'district list guard: empty district name';
  end if;
  new.district_norm := coalesce(new.district_norm, v_norm);
  if v_ok is not null then
    return new;
  end if;
  if char_length(v_norm) < 2 or new.district_ar ~ '[0-9٠-٩]'
     or v_norm ~ '(^|\s)(مخطط|مخططات|قاعده|شارع|طريق|قري)(\s|$)' then
    raise exception 'district list guard: «%» is not a district name (a number, plan, base, street, road, villages or one letter)', new.district_ar;
  end if;
  select * into v_twin from public.district_twin_check(new.city_id, new.district_ar) limit 1;
  if v_twin.verdict = 'twin' and not (tg_op = 'UPDATE' and v_twin.twin_ar is not distinct from old.district_ar) then
    raise exception 'district list guard: «%» is a spelling twin of «%» on the list for city % — use that name', new.district_ar, v_twin.twin_ar, new.city_id;
  end if;
  return new;
end $function$;

drop trigger if exists trg_zz_district_list_guard on public.loc_catalog_district;
create trigger trg_zz_district_list_guard
  before insert or update of district_ar, city_id or delete on public.loc_catalog_district
  for each row execute function public.trg_district_list_guard();

drop trigger if exists trg_zz_district_list_no_truncate on public.loc_catalog_district;
create trigger trg_zz_district_list_no_truncate
  before truncate on public.loc_catalog_district
  for each statement execute function public.trg_district_list_guard();

create or replace function public.trg_pin_district_on_list()
returns trigger
language plpgsql set search_path to 'public'
as $function$
declare v_list text;
begin
  select c.district_ar into v_list
    from public.loc_catalog_district c
   where c.city_id = new.city_id
     and c.district_norm = public.norm_district_tok(public.loc_display_district_ar(new.city_id, new.district_ar))
   limit 1;
  if v_list is null then
    raise exception 'pin district guard: «%» is not on the district list for city % — a map answer only fills a district we already know', new.district_ar, new.city_id;
  end if;
  if v_list ~ '[0-9٠-٩]' or public.norm_district_tok(v_list) ~ '(^|\s)(مخطط|مخططات|قاعده|شارع|طريق|قري)(\s|$)' then
    raise exception 'pin district guard: «%» is on the list but is not a district a home sits in (plan, base, street, road, villages or a number)', v_list;
  end if;
  new.district_ar := v_list;
  return new;
end $function$;

drop trigger if exists trg_pin_district_on_list on public.listing_pin_district;
create trigger trg_pin_district_on_list
  before insert or update of district_ar, city_id on public.listing_pin_district
  for each row execute function public.trg_pin_district_on_list();

create or replace function public.mon_detect_district_guards_missing()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_missing text[]; v_open boolean; r int := 0;
begin
  select array_agg(w) into v_missing
    from unnest(array['trg_zz_district_list_guard', 'trg_zz_district_list_no_truncate', 'trg_pin_district_on_list']) w
   where not exists (select 1 from pg_trigger t
                      where t.tgname = w and not t.tgisinternal and t.tgenabled <> 'D'
                        and t.tgrelid in ('public.loc_catalog_district'::regclass, 'public.listing_pin_district'::regclass));
  v_open := exists (select 1 from public.alert_event where dedup_key = 'district_guards_missing' and resolved_at is null);
  if v_missing is null then
    if v_open then perform public.mon_resolve('district_guards_missing', 'location'); end if;
  elsif not v_open then
    r := public.mon_raise('P1', 'district_guards_missing', 'location', 'district_guards_missing',
      jsonb_build_object('missing', to_jsonb(v_missing),
        'why', 'A district guard trigger is gone or disabled: the list could lose a district, gain a junk name or a spelling twin, or a map answer could add a name that is not on the list (owner 2026-10-25).',
        'action', 'Re-create the trigger from migration district_guards_owner_2026_10_25; find which change dropped or disabled it.'));
  end if;
  return r;
end $function$;

do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_district_guards_missing''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_district_guards_missing'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_district_guards_missing''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF, every case inside a rolled-back sub-transaction; nothing stays.
do $proof$
declare n0 bigint := (select count(*) from public.loc_catalog_district); v text; caught boolean;
begin
  -- 1) never deleted
  caught := false;
  begin delete from public.loc_catalog_district where district_id = (select min(district_id) from public.loc_catalog_district);
  exception when others then caught := sqlerrm like 'district list guard: districts are never deleted%'; end;
  if not caught then raise exception 'PROOF: a delete was not refused'; end if;
  -- 2) junk names refused
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (6, 'مخطط 5');
  exception when others then caught := sqlerrm like 'district list guard: «مخطط 5» is not a district name%'; end;
  if not caught then raise exception 'PROOF: a plan name was not refused'; end if;
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (6, 'قاعدة الاختبار الجوية');
  exception when others then caught := sqlerrm like 'district list guard:%not a district name%'; end;
  if not caught then raise exception 'PROOF: a base name was not refused'; end if;
  -- 3) spelling twin refused (Hofuf: «الضاحية الحي الثالث» = «الضاحية الثالث»)
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (12, 'الضاحية الحي الثالث');
  exception when others then caught := sqlerrm like 'district list guard:%spelling twin of «الضاحية الثالث»%'; end;
  if not caught then raise exception 'PROOF: a spelling twin was not refused'; end if;
  -- 4) a clean new name is accepted and gets its norm; then rolled back
  begin
    insert into public.loc_catalog_district (city_id, district_ar) values (6, 'حي اختبار الحراسة') returning district_norm into v;
    if v is distinct from public.norm_district_tok('حي اختبار الحراسة') then raise exception 'PROOF: norm not set (%)', v; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if; end;
  -- 5) a pin district must be on the list, and is stored in the list's spelling («الهجلة الجديد» → «حي الهجلة», Makkah)
  begin
    insert into public.listing_pin_district (source_table, listing_id, city_id, district_ar, run_id)
    values ('proof_pin_table', -1, 6, 'الهجلة الجديد', 'proof') returning district_ar into v;
    if v <> 'حي الهجلة' then raise exception 'PROOF: pin district not stored in the list spelling (%)', v; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if; end;
  caught := false;
  begin insert into public.listing_pin_district (source_table, listing_id, city_id, district_ar, run_id)
        values ('proof_pin_table', -1, 6, 'حي لا يوجد ابدا', 'proof');
  exception when others then caught := sqlerrm like 'pin district guard:%not on the district list%'; end;
  if not caught then raise exception 'PROOF: a pin district off the list was not refused'; end if;
  -- 6) the alarm reads clean, is rostered, and nothing stayed
  if public.mon_detect_district_guards_missing() <> 0 then raise exception 'PROOF: guards read as missing'; end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_district_guards_missing') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  if (select count(*) from public.loc_catalog_district) <> n0 then raise exception 'PROOF: the list changed'; end if;
  if exists (select 1 from public.listing_pin_district where source_table = 'proof_pin_table') then raise exception 'PROOF: a proof pin row stayed'; end if;
  raise notice 'PROOF OK: delete refused, plan/base refused, twin refused, clean name accepted, pin off-list refused, pin spelling = list, alarm rostered';
end $proof$;
