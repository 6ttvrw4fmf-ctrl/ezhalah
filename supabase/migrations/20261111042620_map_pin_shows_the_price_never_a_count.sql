-- THE PIN SHOWS THE PRICE, NEVER A COUNT (owner 2026-11-10, final rule: «we don't say 2 instead we just put the price …
-- lowest price wins … price on request = price listed if there is»). map_pins_ar's exact-spot read now returns, for every
-- spot: the LOWEST real price, the HIGHEST real price and how many ads show no real price, so the head can read
-- «750 ألف» / «من 750 ألف» / «السعر عند الطلب» (pinHead in src/lib/mapPins.ts). A sale under 10,000 or a yearly rent
-- under 1,000 is a placeholder there, not a price (display only — the card keeps the site's figure). A spot holding buy
-- AND rent ads is now two pins (one per deal), so no head ever has to mix a sale price with a rent.
-- Two columns are appended to the result (price_max, unpriced), so the function is dropped and re-created with the same
-- 20 arguments; every other read path returns null / 0 for them. The old client ignores the extra columns.
do $mig$
declare v text; v2 text; n int; sig constant text := 'double precision,double precision,double precision,double precision,double precision,text[],jsonb,integer,text,text[],integer[],integer,integer,numeric,numeric,boolean,text[],text[],text[],text';
  floor_ constant text := 'case when k.deal = ''rent'' then 1000 else 10000 end';
begin
  v := pg_get_functiondef(('public.map_pins_ar(' || sig || ')')::regprocedure);
  v2 := replace(v, 'ids jsonb, price numeric, platform text)', 'ids jsonb, price numeric, platform text, price_max numeric, unpriced integer)');
  n := (length(v2) - length(replace(v2, 'null::jsonb, null::numeric, null::text' || chr(10), ''))) / length('null::jsonb, null::numeric, null::text' || chr(10));
  if n <> 3 then raise exception 'map_pins_ar: expected 3 non-spot read paths, found %', n; end if;
  v2 := replace(v2, 'null::jsonb, null::numeric, null::text' || chr(10), 'null::jsonb, null::numeric, null::text, null::numeric, 0' || chr(10));
  v2 := replace(v2,
    'select k.la, k.lo, count(*)::int,' || chr(10) || '           case when count(distinct k.deal) = 1 then min(k.deal) else ''mixed'' end,',
    'select k.la, k.lo, count(*)::int,' || chr(10) || '           min(k.deal),');
  v2 := replace(v2,
    '           case when count(*) > 1 then null else min(k.price) end,' || chr(10) || '           case when count(*) > 1 then null else min(k.platform) end' || chr(10),
    '           min(k.price) filter (where k.price >= ' || floor_ || '),' || chr(10) ||
    '           case when count(*) > 1 then null else min(k.platform) end,' || chr(10) ||
    '           max(k.price) filter (where k.price >= ' || floor_ || '),' || chr(10) ||
    '           (count(*) filter (where k.price is null or k.price < ' || floor_ || '))::int' || chr(10));
  v2 := replace(v2, '    group by k.la, k.lo' || chr(10), '    group by k.la, k.lo, k.deal' || chr(10));
  if position('price_max numeric, unpriced integer)' in v2) = 0 or position('min(k.deal),' in v2) = 0
     or position('max(k.price) filter' in v2) = 0 or position('group by k.la, k.lo, k.deal' in v2) = 0 then
    raise exception 'map_pins_ar: the spot read was not rewritten';
  end if;
  execute 'drop function public.map_pins_ar(' || sig || ')';
  execute v2;
  execute 'revoke all on function public.map_pins_ar(' || sig || ') from public';
  execute 'grant execute on function public.map_pins_ar(' || sig || ') to anon, authenticated, service_role';
end
$mig$;