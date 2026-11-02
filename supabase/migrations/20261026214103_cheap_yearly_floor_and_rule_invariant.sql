-- CHEAP-«YEARLY» RULE, MEASURED ON ITS FIRST LIVE HOUR (2026-10-26 21:22 UTC sync, flag on since 20:38):
--   • the rule applied everywhere — 0 rent rows served a price other than rent_price_annual_ar(source inputs);
--   • the guard still raised: its predicate («a served سنوي row of those types under 8,000») was WIDER than the
--     rule. 118 rows carry a source figure under 300 SAR (1, 12, 35, 100 … — placeholders, not rents; ×12 leaves
--     them under 8,000), and rows whose SITE WORD is monthly pool under سنوي at ×12 with a legitimately small
--     yearly (an office at 495/month = 5,940/yr) — the rule never touches them, the guard counted them.
--
-- TWO FIXES. (1) A FLOOR: the rule applies to source figures in [300, 8000) only — under 300 a «yearly» figure is
-- not a monthly rent either, it is a placeholder, and the existing price-magnitude guards own it. Mirrored in
-- src/lib/rentPool.ts (CHEAP_YEARLY_FROM = 300). (2) THE GUARD WATCHES THE INVARIANT, NOT A BAND: for every served
-- rent row, index.price_annual must equal rent_price_annual_ar(the source row's platform, word, figure, type).
-- That is exactly «the rule stopped applying», with no false positive from any price band, and it catches a
-- write path around the sync just the same. Flag off → quiet.

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
    when p_price_annual < 300 or p_price_annual >= 8000 then p_price_annual
    when p_type in ('Apartment','Villa','Floor','Duplex','Studio','House','Building','Residential Building','Office','Shop','Warehouse','Showroom','Commercial Building')
      or p_type in ('شقة','فيلا','دور','دوبلكس','استوديو','بيت','عمارة','عمارة سكنية','مكتب','محل','مستودع','معرض','مبنى تجاري')
      then p_price_annual * 12
    else p_price_annual
  end
$$;
comment on function public.rent_price_annual_ar(text, text, numeric, text) is
  'The yearly price the index SERVES for a rent row. Owner 2026-10-26: a «yearly» figure in [300, 8000) SAR on a home/business unit (Apartment, Villa, Floor, Duplex, Studio, House, Building, Residential Building, Office, Shop, Warehouse, Showroom, Commercial Building) is a per-month price → ×12; under 300 it is a placeholder (price-magnitude guards own it); rooms, land, rest houses, chalets, camps, farms untouched. Source tables keep the published figure. Behind ops_feature_flags.cheap_yearly_is_monthly. App mirror: src/lib/rentPool.ts::cheapYearlyIsMonthly.';

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
  -- THE INVARIANT: what the index serves for a rent row is what the rule says for that row's source inputs.
  with off_rule as (
    select s.platform, s.listing_id, s.price_annual as served, v.price_annual as published, v.rent_period as site_word, v.property_type,
           public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) as per_rule
      from public.search_listings_ar s
      join public.listing_native_location_v2 v on v.source_table = s.source_table and v.listing_id = s.listing_id
     where s.production_ready and s.deal_ar = 'إيجار'
       and s.price_annual is distinct from public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type))
  select count(*), (select jsonb_agg(to_jsonb(x)) from (select * from off_rule limit 5) x) into v_bad, v_sample from off_rule;
  if v_bad > 0 then
    n := n + public.mon_raise('P1', 'cheap_yearly_rent_served', 'search_index', 'cheap_yearly_rent_served',
      jsonb_build_object(
        'rows', v_bad, 'sample', v_sample,
        'why', 'For a served rent row, search_listings_ar.price_annual must equal rent_price_annual_ar(platform, the site''s period word, the published figure, the type) — the cheap-«yearly» ×12 rule (owner 2026-10-26). A row off the rule means sync_search_listings_ar() no longer writes price_annual through the function, a sync has not run since the flag/rule changed, or something writes the index around the sync.',
        'action', 'Read the sample (served vs per_rule); confirm sync_search_listings_ar() contains public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type); run the sync. Never clear this by changing the threshold or the type list on one side only.'));
  else
    perform public.mon_resolve_key('cheap_yearly_rent_served', 'cheap_yearly_rent_served');
  end if;
  return n;
end $function$;
revoke all on function public.mon_detect_cheap_yearly_rent_served() from public, anon, authenticated;

-- PROOF at apply (the flag is ON in production): the floor, the band, and the invariant on the live index.
do $proof$
declare r int;
begin
  if public.rent_price_annual_ar('aqar', 'annual', 200, 'Apartment') <> 200 then raise exception 'PROOF: 200 is a placeholder, untouched'; end if;
  if public.rent_price_annual_ar('aqar', 'annual', 300, 'Apartment') <> 3600 then raise exception 'PROOF: 300 is the first per-month figure'; end if;
  if public.rent_price_annual_ar('wasalt', 'annual', 3300, 'Apartment') <> 39600 then raise exception 'PROOF: 3,300 → 39,600'; end if;
  if public.rent_price_annual_ar('aqar', 'annual', 8000, 'Apartment') <> 8000 then raise exception 'PROOF: 8,000 is yearly'; end if;
  if public.rent_price_annual_ar('haraj', 'monthly', 495, 'Office') <> 495 then raise exception 'PROOF: a monthly-word row is the pool''s job'; end if;
  -- the index was synced at 21:22 with the old (floorless) rule: the 118 placeholder rows are now off the new rule
  -- (served ×12, rule says untouched) until the next sync — so the detector MUST see them right now …
  r := public.mon_detect_cheap_yearly_rent_served();
  if r = 0 and not exists (select 1 from public.alert_event a where a.kind = 'cheap_yearly_rent_served' and a.resolved_at is null) then
    raise exception 'PROOF: the invariant detector saw no drift on an index synced with the old rule';
  end if;
  -- … and it must go quiet by itself after the next sync (the sync writes through the same function).
end $proof$;
