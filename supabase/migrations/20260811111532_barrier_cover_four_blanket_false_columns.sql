-- 396,220 invented negatives, invisible because the barrier's column list did not include them.
--
-- apartment_in_project, extension, special_position and special_surface are aqar concepts
-- (شقة في مشروع / ملحق / موقع مميز / مساحة مميزة). aqar publishes them legitimately and has real
-- `true` values. The other 48 tables are schema clones of aqar's template, and every one of them
-- carries a literal `false` on all 99,055 active rows with ZERO `true` anywhere — no source ever
-- said "no". Textbook manufactured negatives; they were simply outside barrier_attribute_columns(),
-- so detect_manufactured_negatives() never looked.
--
-- Extending the list makes the EXISTING detector and repair cover them, so this cannot recur.
create or replace function public.barrier_attribute_columns()
returns text[]
language sql immutable
as $$
  select array[
    'elevator','parking','kitchen','air_conditioner','maid_room','driver_room','private_entrance',
    'balcony_terrace','laundry_room','optical_fibers','separate_water_meter',
    'separate_electricity_meter','car_entrance','water_supply','electricity','sanitation',
    'villa_on_roof','rent_now_pay_later',
    -- added 2026-08-11: 99,055 rows x 4 columns of blanket false on 48 non-aqar tables
    'apartment_in_project','extension','special_position','special_surface'
  ]::text[];
$$;

-- Drain the repair in <=25k-row batches instead of one 396k-cell statement. The 2026-08-10 outage
-- was exactly a bulk repair of this shape (849k cells, HTTP 522 fleet-wide, owner restart), so this
-- runs one bounded batch per invocation, every 5 minutes, and becomes a no-op once clean. It is
-- self-terminating by nature: nothing left to repair means zero rows touched.
create or replace function public.repair_blanket_false_batch(p_limit int default 25000)
returns table(tbl text, col text, cells bigint)
language plpgsql
as $fn$
declare t text; c text; n bigint; v_true bigint;
begin
  for t, c in
    select ic.table_name, ic.column_name
      from information_schema.columns ic
     where ic.table_schema = 'public' and ic.table_name like '%\_listings'
       and ic.column_name = any(public.barrier_attribute_columns())
       and ic.table_name not like '%backup%'
     order by ic.table_name, ic.column_name
  loop
    -- only when the platform never publishes a TRUE for this column anywhere
    execute format('select count(*) filter (where %I) from public.%I', c, t) into v_true;
    continue when v_true > 0;

    execute format($f$
      update public.%I set %I = null
       where ctid in (select ctid from public.%I where %I is false limit %s)
    $f$, t, c, t, c, p_limit);
    get diagnostics n = row_count;

    if n > 0 then
      tbl := t; col := c; cells := n; return next;
      return;   -- ONE bounded batch per invocation
    end if;
  end loop;
end
$fn$;

comment on function public.repair_blanket_false_batch(int) is
  'Repairs manufactured negatives (a column false everywhere with no true anywhere on the platform) '
  'in ONE <=25k-row batch per call. Scheduled every 5 minutes; becomes a no-op when clean.';

select cron.schedule('repair-blanket-false-drain', '*/5 * * * *',
  $$set statement_timeout to '120s'; select * from public.repair_blanket_false_batch();$$);
