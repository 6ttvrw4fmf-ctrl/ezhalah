-- OWNER DIRECTIVE 2026-08-05: "If the source does not provide a value confidently, store it as
-- unknown rather than inventing one."
--
-- All 7 amenity columns on all 67 listing tables (469 columns) carried `DEFAULT false`. A scraper
-- that never reads an amenity — because the platform does not publish it, or because that scraper
-- was never taught to look — therefore inserted a CONFIDENT NEGATIVE: "this flat has no lift",
-- asserted as fact, indistinguishable from a listing whose page genuinely says there is no lift.
-- That is inventing a value, and it is the same class as the two fabrications fixed today
-- (aqar's furnished-from-negation, and the sync's platform-wide furnished=true).
--
-- Dropping the default makes an unwritten amenity NULL = honestly unknown. This is metadata-only:
-- Postgres does not rewrite the table, no existing row changes, and every column is already nullable
-- (verified: 469 columns, 0 NOT NULL). The advanced-filter amenity chips require TRUE, so neither
-- false nor NULL matches them — no user-visible result changes today. What changes is that from now
-- on we stop manufacturing negatives.
--
-- NOT retroactive on purpose: an existing `false` cannot be told apart from a source-published "no",
-- and rewriting them all to NULL would destroy real negatives. The historical rows stay as they are.
do $mig$
declare r record; n int := 0;
begin
  for r in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name like '%\_listings'
      and column_name in ('elevator','parking','kitchen','air_conditioner',
                          'maid_room','driver_room','private_entrance')
      and column_default = 'false'
    order by table_name, column_name
  loop
    execute format('alter table public.%I alter column %I drop default', r.table_name, r.column_name);
    n := n + 1;
  end loop;
  raise notice 'dropped false-default on % amenity columns', n;
  if n = 0 then raise exception 'no columns matched — refusing to record a no-op migration'; end if;
end
$mig$;

-- Prove none remain.
do $verify$
declare leftover int;
begin
  select count(*) into leftover
  from information_schema.columns
  where table_schema='public' and table_name like '%\_listings'
    and column_name in ('elevator','parking','kitchen','air_conditioner',
                        'maid_room','driver_room','private_entrance')
    and column_default = 'false';
  if leftover <> 0 then
    raise exception '% amenity columns still default to false', leftover;
  end if;
end
$verify$;
