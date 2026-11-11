-- HARAJ DAILY / WEEKLY RENTS JOIN «إقامات قصيرة» (owner 2026-11-10, backlog 1744). docs/ARCHITECTURE.md §20.
--
-- Until today the short-stays pool was decided per PLATFORM (gathern + aqarmonthly). A Haraj seller who writes
-- «للإيجار اليومي» / «ايجار يومي» / «التأجير الأسبوعي» rents by the stay too, so the pool is now also decided per
-- LISTING: a source row whose rent_period is the seller's own 'daily' / 'weekly' searches under «شهري» (the
-- «إقامات قصيرة» button). The word comes from scrapers/haraj/prose.py short_stay_rent() (a period word tied to a
-- RENT word — «تنظيف يومي» does not count), and an ad stating daily AND monthly («للايجار اليومي والشهري») joins.
-- The card shows no price (same as Gathern / Aqar Monthly); the price is never ×12: price_annual is cleared and
-- the seller's figure stays in the source record (additional_info.short_stay_price_as_stored, price_phrase /
-- unit_price_printed, price_evidence). App mirror: src/lib/rentPool.ts SHORT_STAY_PERIODS.
--
-- 1. rent_pool_ar(): 'daily' / 'weekly' → «شهري» on any platform (both flag states).
-- 2. mon_detect_short_stays_pool_drift(): a non-stay-length row under «شهري» is drift UNLESS its source period
--    is the seller's 'daily' / 'weekly'.
-- 3. Backfill the live Haraj rents the scraper already holds (the same regex as short_stay_rent(), measured
--    2026-11-11: 712 live rents — 701 residential + 11 commercial — Python and SQL agree row for row).

create or replace function public.rent_pool_ar(p_platform text, p_rent_period text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    -- a short stay the SELLER states (owner 2026-11-10, backlog 1744): its own pool on any platform
    when p_rent_period in ('daily','weekly') then 'شهري'
    when not exists (select 1 from public.ops_feature_flags k where k.name = 'short_stays_pool' and k.enabled)
      -- flag OFF: the pre-2026-10-25 mapping, verbatim (PERIOD = SOURCE; the two stay-length platforms default to «شهري»)
      then case p_rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي'
             else case when p_platform in ('gathern','aqarmonthly') then 'شهري' else null::text end end
    when p_platform in ('gathern','aqarmonthly') then 'شهري'
    else case p_rent_period when 'annual' then 'سنوي' when 'monthly' then 'سنوي' else null::text end
  end
$$;
comment on function public.rent_pool_ar(text, text) is
  'The rent POOL (search_listings_ar.rent_period_ar) for a platform + the period the site published. Owner 2026-10-25: «شهري» = «إقامات قصيرة» = gathern + aqarmonthly, plus (owner 2026-11-10, backlog 1744) any row whose source period is the seller''s own daily/weekly; any other monthly or annual → «سنوي» (price_annual is monthly×12 already); no published period → NULL, never guessed. Behind ops_feature_flags.short_stays_pool; off = the pre-2026-10-25 mapping. App mirror: src/lib/rentPool.ts.';
revoke all on function public.rent_pool_ar(text, text) from public, anon, authenticated;

-- 2. The drift detector: a seller-stated short stay is not drift.
do $det$
declare
  d text; k int;
  old_q constant text := 'where s.production_ready and s.deal_ar = ''إيجار'' and s.rent_period_ar = ''شهري''
     and s.platform not in (''gathern'',''aqarmonthly'');';
  new_q constant text := 'where s.production_ready and s.deal_ar = ''إيجار'' and s.rent_period_ar = ''شهري''
     and s.platform not in (''gathern'',''aqarmonthly'')
     and not exists (select 1 from public.listing_native_location_v2 lv   -- the seller''s daily/weekly (backlog 1744)
                      where lv.source_table = s.source_table and lv.listing_id = s.listing_id
                        and lv.rent_period in (''daily'',''weekly''));';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_detect_short_stays_pool_drift';
  if d is null then raise exception 'mon_detect_short_stays_pool_drift not found'; end if;
  if position('lv.rent_period in (''daily'',''weekly'')' in d) > 0 then raise notice 'detector already knows seller short stays'; return; end if;
  k := (length(d) - length(replace(d, old_q, ''))) / length(old_q);
  if k <> 1 then raise exception 'detector anchor found % times, want 1 — read the live detector before patching', k; end if;
  execute replace(d, old_q, new_q);
end $det$;

-- 3. Backfill: the seller's word on the live Haraj rents; the stored figure moves to additional_info.
create or replace function pg_temp.haraj_short_stay(p_title text, p_body text) returns text language sql immutable as $$
  select case when w is null then null when w like 'يوم%' then 'daily' else 'weekly' end
  from (select substring(translate(regexp_replace(coalesce(p_title,'') || E'\n' || coalesce(p_body,''),
                                                  '[ً-ْٰـ]', '', 'g'), 'أإآىة', 'ااايه')
          from '(?<![ء-ي[:alnum:]_])(?:لل|ل|ال)?(?:ايجار|اجار|تاجير)\s*(?:ال)?(يومي|يوميه|يوميا|اسبوعي|اسبوعيه|اسبوعيا)(?![ء-ي[:alnum:]_])') w) x
$$;

do $fill$
declare n_res int; n_com int;
begin
  update public.haraj_residential_listings h
     set additional_info = coalesce(h.additional_info, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
           'short_stay', pg_temp.haraj_short_stay(h.title, h.description),
           'short_stay_price_as_stored', h.price_annual, 'short_stay_rent_period_as_stored', h.rent_period)),
         rent_period = pg_temp.haraj_short_stay(h.title, h.description),
         price_annual = null
   where h.active and h.transaction_type = 'Rent'
     and pg_temp.haraj_short_stay(h.title, h.description) is not null
     and h.rent_period is distinct from pg_temp.haraj_short_stay(h.title, h.description);
  get diagnostics n_res = row_count;
  update public.haraj_commercial_listings h
     set additional_info = coalesce(h.additional_info, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
           'short_stay', pg_temp.haraj_short_stay(h.title, h.description),
           'short_stay_price_as_stored', h.price_annual, 'short_stay_rent_period_as_stored', h.rent_period)),
         rent_period = pg_temp.haraj_short_stay(h.title, h.description),
         price_annual = null
   where h.active and h.transaction_type = 'Rent'
     and pg_temp.haraj_short_stay(h.title, h.description) is not null
     and h.rent_period is distinct from pg_temp.haraj_short_stay(h.title, h.description);
  get diagnostics n_com = row_count;
  raise notice 'haraj short stays backfilled: residential %, commercial %', n_res, n_com;
  if n_res + n_com > 800 then raise exception 'backfill touched % rows, measured 712 — stop and re-measure', n_res + n_com; end if;
end $fill$;

-- PROOF at apply.
do $proof$
begin
  if public.rent_pool_ar('haraj', 'daily') is distinct from 'شهري' then raise exception 'PROOF: haraj daily must pool as شهري'; end if;
  if public.rent_pool_ar('haraj', 'weekly') is distinct from 'شهري' then raise exception 'PROOF: haraj weekly must pool as شهري'; end if;
  if public.rent_pool_ar('gathern', null) is distinct from 'شهري' then raise exception 'PROOF: gathern must pool as شهري'; end if;
  if public.rent_pool_ar('aqar', null) is not null then raise exception 'PROOF: unknown period must stay null'; end if;
  if pg_temp.haraj_short_stay('شقة للإيجار', 'الايجار 2500 شهري تنظيف يومي') is not null then raise exception 'PROOF: a daily cleaning is not a short stay'; end if;
  if pg_temp.haraj_short_stay('استراحة للتأجير الأسبوعي', '') is distinct from 'weekly' then raise exception 'PROOF: «التأجير الأسبوعي» is weekly'; end if;
  if pg_temp.haraj_short_stay('شاليه للإيجار اليومي', 'او الأسبوعي') is distinct from 'daily' then raise exception 'PROOF: first rent phrase decides'; end if;
  if exists (select 1 from public.ops_feature_flags k where k.name = 'short_stays_pool' and k.enabled) then
    if public.rent_pool_ar('haraj', 'monthly') is distinct from 'سنوي' then raise exception 'PROOF: haraj monthly must still pool as سنوي'; end if;
  end if;
end $proof$;
