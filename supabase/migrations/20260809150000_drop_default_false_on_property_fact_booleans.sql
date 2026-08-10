-- SOURCE IS TRUTH, at the schema level (docs/ops/EZHALAH_DATA_ARCHITECTURE_GOAL.md, owner rule
-- 2026-08-09: "Never treat 'not mentioned' as 'no'").
--
-- 15 property-fact boolean columns carried `DEFAULT false` on all 67 listing tables. Any scraper
-- that does not explicitly write one of them got a manufactured NEGATIVE from PostgreSQL itself —
-- the database was fabricating "no" on every insert, for every platform, silently.
--
-- Proven live on wasalt 2026-08-09: the scraper never writes separate_water_meter /
-- separate_electricity_meter, so all 52,892 active rows read `false` — while wasalt's OWN payload
-- (additional_info -> waterMeter / electricityMeter) says "Yes" on 45,723 and 51,801 rows
-- respectively. The database contradicted the source on ~97,500 row-facts.
--
-- Dropping a default changes NOTHING about existing rows and no currently-running query: it only
-- stops the next INSERT from inventing a value. Unwritten fields now correctly arrive as NULL
-- = "the source did not say". Fully reversible (SET DEFAULT false).
--
-- Deliberately NOT included: ar_fetched, detail_enriched, fullparse_done, reparsed_v2,
-- rega_location_verified — pipeline/operational state where `false` is a genuine initial value.
do $$
declare r record; n int := 0;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name like '%\_listings'
      and c.data_type = 'boolean' and c.column_default = 'false'
      and c.column_name in (
        'apartment_in_project','balcony_terrace','car_entrance','electricity','extension',
        'laundry_room','optical_fibers','rent_now_pay_later','sanitation',
        'separate_electricity_meter','separate_water_meter','special_position','special_surface',
        'villa_on_roof','water_supply')
  loop
    execute format('alter table public.%I alter column %I drop default', r.table_name, r.column_name);
    n := n + 1;
  end loop;
  raise notice 'dropped DEFAULT false from % property-fact boolean columns', n;
end $$;
