-- A «YEARLY» RENT UNDER 8,000 SAR ON A HOME OR BUSINESS UNIT IS A PER-MONTH PRICE (owner 2026-10-26: «investigate the
-- monthly prices kept in yearly and put a very very strong guard … make sure we show yearly always»).
--
-- MEASURED 2026-10-26 over the live index (rent, pool «سنوي», priced): apartments 8,410 below 8,000 SAR a year,
-- 194 between 8,000 and 12,000, 2,202 at 12,000–20,000, 56,282 above. Offices 1,010 / 20 / 456 / 2,113. Nothing
-- rents a flat for 3,000 a YEAR. The sites' own ad text says «شهري» on 3,269 of Aqar's 5,272 cheap «yearly» ads
-- (DealApp 511 of 1,168, Tuba 33 of 66, TheRC 27 of 51, Muktamel 22 of 49); Wasalt's own payload labels e.g. 3,300
-- as `rentFreq.yearly` with no monthly figure beside it (2,660 rows) — the SOURCE publishes a per-month price under
-- its yearly field. PRICE = SOURCE and PERIOD = SOURCE still hold in the source tables (untouched); what changes is
-- what we SERVE: the index's price_annual reads such a figure as monthly ×12 so the yearly search, the budget
-- filters and the card agree, and the card says «السعر المعلن 3,300 شهرياً» under the yearly price.
--
-- THE RULE (one truth table, mirrored by src/lib/rentPool.ts::cheapYearlyIsMonthly and pinned by
-- scripts/verify-cheap-yearly-is-monthly.ts): rent, the site's period = annual, platform not a stay-length one,
-- price_annual in (0, 8000), type in — Apartment, Villa, Floor, Duplex, Studio, House, Building, Residential Building,
-- Office, Shop, Warehouse, Showroom, Commercial Building — → price_annual ×12. Rooms, land, rest houses, chalets,
-- camps, farms are OUT (a room at 6,000 a year is real). Threshold and list live in ONE place each side.
--
-- BORN OFF behind ops_feature_flags.cheap_yearly_is_monthly so this applies before the app ships; on → the next
-- hourly sync_search_listings_ar() rewrites the rows; off → the next sync restores the source figures. The guard:
-- mon_detect_cheap_yearly_rent_served() (P1, rostered, twice an hour) — while the flag is on, any served «سنوي» row
-- of those types under 8,000 SAR means the rule stopped applying (a new write path around the sync, a sync that
-- no longer calls rent_price_annual_ar, a scraper writing the index directly).

insert into public.ops_feature_flags (name, enabled, reason)
values ('cheap_yearly_is_monthly', false,
        'owner 2026-10-26: a «yearly» rent under 8,000 SAR on a home/business unit is a per-month price → served ×12 with «السعر المعلن … شهرياً». Born OFF; turned on once the app that applies the same rule to the card is live. Off = the source figure as published, restored by the next sync_search_listings_ar() run.')
on conflict (name) do nothing;

-- The ONE truth table, in SQL. Mirrors src/lib/rentPool.ts::cheapYearlyIsMonthly (English clean type) — the sync
-- hands it v.property_type (the scrapers' canonical English type, Arabic on a few sites, so both spellings match).
create or replace function public.rent_price_annual_ar(p_platform text, p_rent_period text, p_price_annual numeric, p_type text)
returns numeric
language sql
stable
set search_path = public
as $$
  select case
    when p_price_annual is null then null
    when not exists (select 1 from public.ops_feature_flags k where k.name = 'cheap_yearly_is_monthly' and k.enabled) then p_price_annual
    when p_platform in ('gathern','aqarmonthly') then p_price_annual
    when p_rent_period is distinct from 'annual' then p_price_annual
    when p_price_annual <= 0 or p_price_annual >= 8000 then p_price_annual
    when p_type in ('Apartment','Villa','Floor','Duplex','Studio','House','Building','Residential Building','Office','Shop','Warehouse','Showroom','Commercial Building')
      or p_type in ('شقة','فيلا','دور','دوبلكس','استوديو','بيت','عمارة','عمارة سكنية','مكتب','محل','مستودع','معرض','مبنى تجاري')
      then p_price_annual * 12
    else p_price_annual
  end
$$;
comment on function public.rent_price_annual_ar(text, text, numeric, text) is
  'The yearly price the index SERVES for a rent row. Owner 2026-10-26: a «yearly» figure under 8,000 SAR on a home/business unit (Apartment, Villa, Floor, Duplex, Studio, House, Building, Residential Building, Office, Shop, Warehouse, Showroom, Commercial Building) is a per-month price → ×12; rooms, land, rest houses, chalets, camps, farms untouched. Source tables keep the published figure. Behind ops_feature_flags.cheap_yearly_is_monthly. App mirror: src/lib/rentPool.ts::cheapYearlyIsMonthly.';
revoke all on function public.rent_price_annual_ar(text, text, numeric, text) from public, anon, authenticated;

-- The sync serves price_annual through it: both occurrences (the INSERT value and the "would the row change"
-- comparison) — the count is asserted.
do $sync$
declare
  d text; k int;
  old_expr constant text := 'v.price_annual';
  new_expr constant text := 'public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type)';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'sync_search_listings_ar';
  if d is null then raise exception 'sync_search_listings_ar not found'; end if;
  if position(new_expr in d) > 0 then raise notice 'sync_search_listings_ar already serves through rent_price_annual_ar'; return; end if;
  k := (length(d) - length(replace(d, old_expr, ''))) / length(old_expr);
  if k <> 2 then raise exception 'sync anchor v.price_annual found % times, want 2 — read the live sync before patching', k; end if;
  execute replace(d, old_expr, new_expr);
end $sync$;

-- The guard. Quiet while the flag is off; while on, a served cheap «yearly» home/business row is a P1.
create or replace function public.mon_detect_cheap_yearly_rent_served()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  n int := 0;
  v_on boolean;
  v_bad int;
  v_sample jsonb;
begin
  select k.enabled into v_on from public.ops_feature_flags k where k.name = 'cheap_yearly_is_monthly';
  if not coalesce(v_on, false) then
    perform public.mon_resolve_key('cheap_yearly_rent_served', 'cheap_yearly_rent_served');
    return 0;
  end if;
  select count(*), (select jsonb_agg(jsonb_build_object('platform', x.platform, 'listing_id', x.listing_id, 'price_annual', x.price_annual, 'type_ar', x.type_ar))
                      from (select s.platform, s.listing_id, s.price_annual, s.type_ar from public.search_listings_ar s
                             where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_ar = 'سنوي'
                               and s.platform not in ('gathern','aqarmonthly')
                               and s.price_annual > 0 and s.price_annual < 8000
                               and s.type_ar in ('شقة','فيلا','دور','دوبلكس','استوديو','بيت','عمارة','عمارة سكنية','مكتب','محل','مستودع','معرض','مبنى تجاري')
                             limit 5) x)
    into v_bad, v_sample
    from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_ar = 'سنوي'
     and s.platform not in ('gathern','aqarmonthly')
     and s.price_annual > 0 and s.price_annual < 8000
     and s.type_ar in ('شقة','فيلا','دور','دوبلكس','استوديو','بيت','عمارة','عمارة سكنية','مكتب','محل','مستودع','معرض','مبنى تجاري');
  if v_bad > 0 then
    n := n + public.mon_raise('P1', 'cheap_yearly_rent_served', 'search_index', 'cheap_yearly_rent_served',
      jsonb_build_object(
        'rows', v_bad, 'sample', v_sample,
        'why', 'A «yearly» rent under 8,000 SAR on a home/business unit is a per-month price (owner 2026-10-26) and must be served ×12 with «السعر المعلن … شهرياً». A served row below the line means sync_search_listings_ar() no longer writes price_annual through rent_price_annual_ar(), a sync has not run since the flag was turned on, or something writes the index around the sync.',
        'action', 'select public.rent_price_annual_ar(platform, rent_period, price_annual, property_type) for a sample row; confirm sync_search_listings_ar() contains public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type); run the sync. Never raise the threshold or shrink the type list to clear this.'));
  else
    perform public.mon_resolve_key('cheap_yearly_rent_served', 'cheap_yearly_rent_served');
  end if;
  return n;
end $function$;
revoke all on function public.mon_detect_cheap_yearly_rent_served() from public, anon, authenticated;

-- Roster: insert the new name right before an existing anchor in the live mon_run_all_detectors text, then execute it.
do $roster$
declare d text; anchor text := '''mon_detect_short_stays_pool_drift'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_cheap_yearly_rent_served''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_cheap_yearly_rent_served'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_cheap_yearly_rent_served''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end $roster$;

-- PROOF at apply, both flag states; the flag flip lives in a sub-transaction that is always rolled back.
do $proof$
declare r int; s text;
begin
  -- flag OFF (the state this migration leaves behind): the published figure, verbatim
  if public.rent_price_annual_ar('wasalt', 'annual', 3300, 'Apartment') <> 3300 then raise exception 'PROOF off: must serve the published figure'; end if;
  if public.rent_price_annual_ar('aqar', 'annual', null, 'Apartment') is not null then raise exception 'PROOF off: null stays null'; end if;
  r := public.mon_detect_cheap_yearly_rent_served();
  if r <> 0 then raise exception 'PROOF off: the guard must be quiet while the flag is off (%)', r; end if;
  select pg_get_functiondef(p.oid) into s from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'sync_search_listings_ar';
  if (length(s) - length(replace(s, 'public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type)', ''))) / length('public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type)') <> 2 then
    raise exception 'PROOF: the sync does not serve price_annual through rent_price_annual_ar in both places';
  end if;
  -- flag ON, rolled back: the owner's table
  begin
    update public.ops_feature_flags set enabled = true where name = 'cheap_yearly_is_monthly';
    if public.rent_price_annual_ar('wasalt', 'annual', 3300, 'Apartment') <> 39600 then raise exception 'PROOF on: 3,300 «yearly» apartment → 39,600'; end if;
    if public.rent_price_annual_ar('aqar', 'annual', 2800, 'شقة') <> 33600 then raise exception 'PROOF on: Arabic type spelling must match too'; end if;
    if public.rent_price_annual_ar('dealapp', 'annual', 3000, 'Office') <> 36000 then raise exception 'PROOF on: a 3,000 «yearly» office → 36,000'; end if;
    if public.rent_price_annual_ar('aqar', 'annual', 6000, 'Room') <> 6000 then raise exception 'PROOF on: a room is OUT'; end if;
    if public.rent_price_annual_ar('aqar', 'annual', 5000, 'Residential Land') <> 5000 then raise exception 'PROOF on: land is OUT'; end if;
    if public.rent_price_annual_ar('aqar', 'annual', 8000, 'Apartment') <> 8000 then raise exception 'PROOF on: 8,000 is the first real yearly figure (threshold exclusive)'; end if;
    if public.rent_price_annual_ar('aqar', 'annual', 7999, 'Apartment') <> 95988 then raise exception 'PROOF on: 7,999 is still per month'; end if;
    if public.rent_price_annual_ar('haraj', 'monthly', 3000, 'Apartment') <> 3000 then raise exception 'PROOF on: a per-month-labelled figure is already handled by the pool, untouched here'; end if;
    if public.rent_price_annual_ar('gathern', 'annual', 3000, 'Apartment') <> 3000 then raise exception 'PROOF on: stay-length platforms untouched'; end if;
    if public.rent_price_annual_ar('aqar', null, 3000, 'Apartment') <> 3000 then raise exception 'PROOF on: an unpublished period is never guessed'; end if;
    -- the index still holds today's rows (the sync has not run with the flag on), so the guard MUST see them
    r := public.mon_detect_cheap_yearly_rent_served();
    if r = 0 and not exists (select 1 from public.alert_event a where a.kind = 'cheap_yearly_rent_served' and a.resolved_at is null) then
      raise exception 'PROOF on: the guard did not raise on the un-synced index';
    end if;
    raise exception 'PROOF_ROLLBACK';
  exception when others then
    if sqlerrm <> 'PROOF_ROLLBACK' then raise; end if;
  end;
  if (select enabled from public.ops_feature_flags where name = 'cheap_yearly_is_monthly') then raise exception 'PROOF: the flag flip leaked out of its sub-transaction'; end if;
end $proof$;
