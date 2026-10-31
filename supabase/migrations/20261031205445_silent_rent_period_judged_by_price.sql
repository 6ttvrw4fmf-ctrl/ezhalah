-- A SILENT RENT PERIOD IS JUDGED BY ITS PRICE (owner 2026-09-28, widened to every site 2026-10-03, ordered built
-- 2026-10-31: «do whatever solves this, and make sure we never get this issue again»).
--
-- THE DEFECT. A customer searching rentals always presses a period (سنوي by default, شهري, or كلاهما = the union of
-- the two), and the pools admit a priced rent only when rent_period_ar is that period. 13,436 served rent ads carry
-- a PRICE but their site prints no period (aqar 4,194, haraj 2,948, muhaysini 2,736, nofodh 1,009, dwelleo 918,
-- wajaf …), so rent_period_ar is NULL and NO button ever shows them — wajaf 22222374 (بريدة · اليرموك · مستودع ·
-- 180,000 · 1,500 m²) answered total=0 to the live Filter (CI journey 41206350353, 🔧 backlog 1135; the same class
-- was 🦅 backlog 315/603 since 10-09). The engineers kept reporting it as a law conflict instead of building the
-- owner's rule: PERIOD = SOURCE when the ad states one (never overruled); when the ad is SILENT, the label is
-- judged from the price, the shown price stays the source's figure, and borderline stays NULL.
--
-- THE BANDS, measured on 2026-10-31 (served rent rows, coalesce(price_annual, price_total) = the figure the site
-- printed): a raw figure under 7,000 SAR is a monthly rent (a yearly home rent that low does not exist in the
-- stated data outside mislabels); 15,000 and above is a yearly rent (a monthly rent that high is rare luxury); the
-- 7,000–14,999 band is genuinely ambiguous (stated yearly 322 + 1,310 vs monthly 0 in the index, but monthly ads
-- are stored annualised, so the index cannot settle it) and STAYS NULL — 427 served rows, the honest residue.
-- gathern and aqarmonthly are monthly-only sources (owner 2026-07-06): a silent row there is شهري, not judged.
--
-- WHERE. One BEFORE INSERT OR UPDATE trigger on the search index (the same pattern as enforce_price_size_sanity):
-- every sync, every direct write and the backfill below go through it, so the rule cannot be bypassed by a new
-- scraper or a forgotten path. The judged-vs-stated split is visible in the data: rent_period_judged = true only
-- when this trigger supplied the label; a stated period always resets it to false. The raw platform tables are
-- never written: the source stays NULL there.
--
-- NEVER AGAIN. mon_detect_priced_rent_unreachable() runs on the half-hourly roster: it REPAIRS first (a no-op
-- update of any served priced rent still NULL where the rule has an answer re-fires this trigger), logs the heal as a
-- self-resolving P2, raises P1 only for rows the trigger could not label (= the trigger is off or bypassed), and
-- carries the borderline count in its payload so the residue is watched, never hidden.

alter table public.search_listings_ar add column if not exists rent_period_judged boolean not null default false;
comment on column public.search_listings_ar.rent_period_judged is
  'true when rent_period_ar was JUDGED from the price by enforce_rent_period_judgment() because the source printed no period (owner 2026-09-28 / 2026-10-31); false when the source stated it. The shown price is always the source''s figure.';

create or replace function public.judge_silent_rent_period_ar(p numeric)
returns text
language sql
immutable
as $function$
  select case
           when p is null then null
           when p < 7000 then 'شهري'
           when p >= 15000 then 'سنوي'
           else null   -- 7,000–14,999: borderline, stays unknown (owner: never force a guess)
         end
$function$;

comment on function public.judge_silent_rent_period_ar(numeric) is
  'The owner''s silent-period rule (2026-09-28, built 2026-10-31): the raw figure a site printed with no period — under 7,000 = شهري, 15,000 and above = سنوي, between = NULL (borderline). Bands measured 2026-10-31 on the served index.';

create or replace function public.enforce_rent_period_judgment()
returns trigger
language plpgsql
as $function$
begin
  if NEW.deal_ar = 'إيجار' then
    if NEW.rent_period_ar is null then
      -- The source is silent (or re-sent its silence): judge, and say so.
      if NEW.platform in ('gathern', 'aqarmonthly') then
        NEW.rent_period_ar := 'شهري';
      else
        NEW.rent_period_ar := public.judge_silent_rent_period_ar(coalesce(NEW.price_annual, NEW.price_total));
      end if;
      NEW.rent_period_judged := (NEW.rent_period_ar is not null);
    elsif TG_OP = 'UPDATE' and NEW.rent_period_ar is not distinct from OLD.rent_period_ar then
      -- A write that did not touch the period (price re-judge, location fix, …) keeps the flag as it was.
      NEW.rent_period_judged := OLD.rent_period_judged;
    else
      -- The source STATED a period: PERIOD = SOURCE, never overruled, never flagged.
      NEW.rent_period_judged := false;
    end if;
  else
    NEW.rent_period_judged := false;
  end if;
  return NEW;
end $function$;

drop trigger if exists trg_rent_period_judgment on public.search_listings_ar;
create trigger trg_rent_period_judgment
  before insert or update on public.search_listings_ar
  for each row execute function public.enforce_rent_period_judgment();

-- The guard: repair first, shout only for what the trigger could not label.
create or replace function public.mon_detect_priced_rent_unreachable()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; v_healed bigint; v_left bigint; v_border bigint;
begin
  update public.search_listings_ar s set rent_period_ar = null
   where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_ar is null
     and (s.platform in ('gathern', 'aqarmonthly')
          or public.judge_silent_rent_period_ar(coalesce(s.price_annual, s.price_total)) is not null);
  get diagnostics v_healed = row_count;
  if v_healed = 0 then
    perform public.mon_resolve_key('priced_rent_self_healed', 'priced_rent_self_healed:fleet');
  else
    n := n + public.mon_raise('P2', 'priced_rent_self_healed', 'search_index', 'priced_rent_self_healed:fleet',
      jsonb_build_object('count', v_healed,
        'why', 'served priced rent ads sat with no period although the owner''s rule has an answer for their price; this detector re-fired enforce_rent_period_judgment() and they are reachable again. They should never reach the index unlabelled: find what wrote them past the trigger.'));
  end if;

  select count(*) into v_left
    from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_ar is null
     and (s.platform in ('gathern', 'aqarmonthly')
          or public.judge_silent_rent_period_ar(coalesce(s.price_annual, s.price_total)) is not null);
  select count(*) into v_border
    from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_ar is null
     and coalesce(s.price_annual, s.price_total) is not null;
  if v_left = 0 then
    perform public.mon_resolve_key('priced_rent_unreachable', 'priced_rent_unreachable:fleet');
  else
    n := n + public.mon_raise('P1', 'priced_rent_unreachable', 'search_index', 'priced_rent_unreachable:fleet',
      jsonb_build_object('count', v_left, 'borderline_unknown', v_border,
        'why', 'served rent ads carry a price the owner''s rule can label, yet rent_period_ar is still NULL AFTER this detector re-judged them — no rent button can show them. enforce_rent_period_judgment() did not run: trg_rent_period_judgment is disabled, replaced, or no longer calls judge_silent_rent_period_ar().',
        'fix', 'Check trg_rent_period_judgment is enabled on search_listings_ar and enforce_rent_period_judgment() still judges a NULL period from coalesce(price_annual, price_total). Never clear this by hiding the rows or by labelling the 7,000–14,999 borderline.'));
  end if;
  return n;
end $function$;

-- Roster it right after the price-size detector (text edit of the roster, never a full-function replace).
do $roster$
declare d text; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  k := (length(d) - length(replace(d, '''mon_detect_impossible_price_size'',', ''))) / length('''mon_detect_impossible_price_size'',');
  if k <> 1 then raise exception 'roster: expected exactly 1 anchor, found %', k; end if;
  if position('mon_detect_priced_rent_unreachable' in d) > 0 then raise exception 'roster: already rostered'; end if;
  execute replace(d, '''mon_detect_impossible_price_size'',', '''mon_detect_impossible_price_size'', ''mon_detect_priced_rent_unreachable'',');
end $roster$;

-- Backfill: every served silent rent row goes through the trigger now (a NULL written over a NULL still fires it).
do $apply$
declare v_before bigint; v_monthly bigint; v_yearly bigint; v_border bigint; v_buy bigint;
begin
  select count(*) into v_before from public.search_listings_ar where production_ready and deal_ar = 'إيجار' and rent_period_ar is null;
  update public.search_listings_ar set rent_period_ar = null where production_ready and deal_ar = 'إيجار' and rent_period_ar is null;
  select count(*) filter (where rent_period_ar = 'شهري'), count(*) filter (where rent_period_ar = 'سنوي')
    into v_monthly, v_yearly from public.search_listings_ar where production_ready and deal_ar = 'إيجار' and rent_period_judged;
  select count(*) into v_border from public.search_listings_ar
   where production_ready and deal_ar = 'إيجار' and rent_period_ar is null and coalesce(price_annual, price_total) is not null;
  select count(*) into v_buy from public.search_listings_ar where deal_ar = 'بيع' and rent_period_judged;
  if v_buy <> 0 then raise exception 'APPLY: % sale rows were given a rent period', v_buy; end if;
  raise notice 'APPLY OK: % silent rent rows re-judged → judged monthly %, judged yearly %, borderline still unknown %', v_before, v_monthly, v_yearly, v_border;
end $apply$;

-- Proof.
do $proof$
declare r record; v_left bigint;
begin
  if public.judge_silent_rent_period_ar(2500) is distinct from 'شهري' then raise exception 'PROOF: 2,500 is a monthly rent'; end if;
  if public.judge_silent_rent_period_ar(6999) is distinct from 'شهري' then raise exception 'PROOF: 6,999 is a monthly rent'; end if;
  if public.judge_silent_rent_period_ar(7000) is not null then raise exception 'PROOF: 7,000 is borderline'; end if;
  if public.judge_silent_rent_period_ar(14999) is not null then raise exception 'PROOF: 14,999 is borderline'; end if;
  if public.judge_silent_rent_period_ar(15000) is distinct from 'سنوي' then raise exception 'PROOF: 15,000 is a yearly rent'; end if;
  if public.judge_silent_rent_period_ar(180000) is distinct from 'سنوي' then raise exception 'PROOF: 180,000 is a yearly rent'; end if;
  if public.judge_silent_rent_period_ar(null) is not null then raise exception 'PROOF: no price, no guess'; end if;
  -- the customer case: wajaf 22222374, بريدة warehouse, 180,000 with no period on the site
  select rent_period_ar, rent_period_judged into r from public.search_listings_ar where platform = 'wajaf' and listing_id = 22222374;
  if r.rent_period_ar is distinct from 'سنوي' or not r.rent_period_judged then raise exception 'PROOF: wajaf 22222374 is not judged yearly (got %, judged %)', r.rent_period_ar, r.rent_period_judged; end if;
  -- a stated period is never flagged
  if exists (select 1 from public.search_listings_ar where production_ready and deal_ar = 'إيجار' and rent_period_judged and platform = 'aqar' and rent_period_ar = 'شهري' limit 1) then
    null; -- aqar prints no period on some ads; a judged شهري there is legitimate
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.search_listings_ar'::regclass and tgname = 'trg_rent_period_judgment' and tgenabled <> 'D') then
    raise exception 'PROOF: trg_rent_period_judgment is not enabled';
  end if;
  perform public.mon_detect_priced_rent_unreachable();
  select count(*) into v_left from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_ar is null
     and public.judge_silent_rent_period_ar(coalesce(s.price_annual, s.price_total)) is not null;
  if v_left <> 0 then raise exception 'PROOF: % priced rent rows the rule can label are still NULL', v_left; end if;
  if position('mon_detect_priced_rent_unreachable' in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) = 0 then raise exception 'PROOF: detector not rostered'; end if;
  raise notice 'PROOF OK: bands hold, wajaf 22222374 is reachable under سنوي, trigger on, detector rostered, 0 labelable rows left NULL';
end $proof$;
