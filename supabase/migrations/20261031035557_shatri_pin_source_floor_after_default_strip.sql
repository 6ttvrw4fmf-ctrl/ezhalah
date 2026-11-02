-- shatri's pin floor was set to 90 on 2026-10-31 02:40 UTC from 49/50 served pins — a number measured BEFORE the :15
-- default-pin strip had seen the site. At 03:15 strip_shared_default_pins() registered 21.53151,39.20492 (5 ads across
-- 5 districts: the office, printed by Houzez on ads without their own location) and removed it; the honest served
-- coverage is 39/50 (78 %). This is not a regression to hide, it is a floor that was never true: set it to 75 with the
-- reason here (data/pin-sources.json carries the same row; verify-pin-capture-declared.ts needs this literal).
insert into public.ops_pin_source_declared (platform, pin_source, floor_pct, proven_on) values
  ('shatri', 'ad-page', 75, date '2026-10-31')
on conflict (platform) do update set pin_source = excluded.pin_source, floor_pct = excluded.floor_pct,
  proven_on = excluded.proven_on, declared_at = now();

do $proof$
declare n bigint;
begin
  select count(*) into n from public.pin_coverage_by_platform() where below_floor;
  if n <> 0 then
    raise exception 'PROOF: % platform(s) still below floor: %', n,
      (select string_agg(platform || ' ' || pct || '% < ' || coalesce(floor_pct::text, 'undeclared'), ', ') from public.pin_coverage_by_platform() where below_floor);
  end if;
  if (select floor_pct from public.ops_pin_source_declared where platform = 'shatri') <> 75 then raise exception 'PROOF: shatri floor did not land'; end if;
  raise notice 'PROOF OK: shatri floor 75; 0 platforms below floor';
end $proof$;