-- A SILENT PER-MONTH FIGURE FOLLOWS THE POOL RULE (owner 2026-10-25/26 + 2026-10-31 «prove the monthly side live»).
--
-- 20261031205445 judged a silent rent period from its price and labelled a figure under 7,000 «شهري». But the product
-- has no monthly button: «إقامات قصيرة» = gathern + aqarmonthly ONLY (owner 2026-10-25, src/lib/rentPool.ts), and a
-- per-month figure on ANY OTHER site is a YEARLY listing at ×12 whose card prints «/سنوياً» with the line «السعر
-- المعلن N شهرياً» (that is how the sync already stores a STATED monthly on aqar: rent_period_ar = سنوي, price_annual =
-- monthly × 12). So the 996 rows labelled «شهري» on mixed sites were in NO pool again (the yearly pool wants سنوي,
-- short stays wants the two platforms), and 24 of them carried placeholder figures (1, 20, 24 SAR) that are no rent.
--
-- THE RULE NOW (one rule in two places — this function and src/lib/rentPool.ts, mirrored by the barriers):
--   silent period, raw figure p, served type:
--     p < 300                                   → NULL (placeholder, never a rent — the cheap-yearly floor, 10-26)
--     300 ≤ p < 8,000 on a home/business type   → a PER-MONTH figure: index سنوي, price_annual = p × 12, judged
--     p ≥ 15,000                                → سنوي as printed, judged
--     anything else (8,000–14,999; land/farm/chalet under 15,000) → NULL (borderline, never a guess)
--   gathern / aqarmonthly: a silent row is شهري (monthly-only sources), never ×12.
-- The bands and the type list are the same ones rent_price_annual_ar() / cheapYearlyIsMonthly() already use for a
-- STATED «yearly» figure under 8,000 (owner 2026-10-26), so a silent 3,000 apartment and a «yearly» 3,000 apartment
-- are served the same way: 36,000 /سنوياً, «السعر المعلن 3,000 شهرياً».
--
-- IDEMPOTENT: a write that only touches the row (the detector's no-op, a location fix) must not multiply again. The
-- trigger keeps the judged label when the row was already judged and the figure did not change; a real sync always
-- re-sends the raw figure, which differs from a stored ×12, so it is re-judged from the raw value.

create or replace function public.judge_silent_rent_period_ar(p numeric, type_ar text)
returns text
language sql
immutable
as $function$
  select case
           when p is null or p < 300 then null
           when p < 8000 and (type_ar in ('شقة','فيلا','دور','دوبلكس','استوديو','بيت','عمارة','عمارة سكنية','مكتب','محل','مستودع','معرض','مبنى تجاري')
                              or type_ar in ('Apartment','Villa','Floor','Duplex','Studio','House','Building','Residential Building','Office','Shop','Warehouse','Showroom','Commercial Building'))
             then 'شهري'   -- a per-month figure (the caller stores it as a yearly listing ×12 on a mixed site)
           when p >= 15000 then 'سنوي'
           else null        -- 8,000–14,999, or a per-month-sized figure on land/farm/chalet: borderline
         end
$function$;

drop function if exists public.judge_silent_rent_period_ar(numeric);

comment on function public.judge_silent_rent_period_ar(numeric, text) is
  'Owner''s silent-period rule (2026-09-28, pool rule 2026-10-25, built 2026-10-31): raw figure < 300 → NULL; 300–7,999 on a home/business type → «شهري» = a per-month figure (served as a yearly listing ×12 on mixed sites); ≥ 15,000 → «سنوي»; else NULL. Mirrored in src/lib/rentPool.ts.';

create or replace function public.enforce_rent_period_judgment()
returns trigger
language plpgsql
as $function$
declare v_raw numeric; v_label text;
begin
  if NEW.deal_ar = 'إيجار' then
    if NEW.rent_period_ar is null then
      if TG_OP = 'UPDATE' and OLD.rent_period_judged and OLD.rent_period_ar is not null
         and NEW.price_annual is not distinct from OLD.price_annual then
        -- A touch, not a fresh figure (the detector's no-op, a location fix): keep the judgment, never multiply again.
        NEW.rent_period_ar := OLD.rent_period_ar;
        NEW.rent_period_judged := true;
      elsif NEW.platform in ('gathern', 'aqarmonthly') then
        NEW.rent_period_ar := 'شهري';
        NEW.rent_period_judged := true;
      else
        v_raw := coalesce(NEW.price_annual, NEW.price_total);
        v_label := public.judge_silent_rent_period_ar(v_raw, NEW.type_ar);
        if v_label = 'شهري' then
          -- A per-month figure on a mixed site is a YEARLY listing at ×12 (the pool rule, owner 2026-10-25).
          NEW.rent_period_ar := 'سنوي';
          NEW.price_annual := v_raw * 12;
          NEW.rent_period_judged := true;
        elsif v_label = 'سنوي' then
          NEW.rent_period_ar := 'سنوي';
          NEW.rent_period_judged := true;
        else
          NEW.rent_period_judged := false;
        end if;
      end if;
    elsif TG_OP = 'UPDATE' and NEW.rent_period_ar is not distinct from OLD.rent_period_ar then
      NEW.rent_period_judged := OLD.rent_period_judged;
    else
      NEW.rent_period_judged := false;   -- the source STATED a period: PERIOD = SOURCE
    end if;
  else
    NEW.rent_period_judged := false;
  end if;
  return NEW;
end $function$;

-- The guard, repointed to the two-argument rule.
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
          or public.judge_silent_rent_period_ar(coalesce(s.price_annual, s.price_total), s.type_ar) is not null);
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
          or public.judge_silent_rent_period_ar(coalesce(s.price_annual, s.price_total), s.type_ar) is not null);
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
        'fix', 'Check trg_rent_period_judgment is enabled on search_listings_ar and enforce_rent_period_judgment() still judges a NULL period from coalesce(price_annual, price_total) and type_ar. Never clear this by hiding the rows, by labelling the borderline, or by putting a mixed-site per-month figure under «شهري».'));
  end if;
  return n;
end $function$;

-- Backfill the 996 rows 20261031205445 labelled «شهري» on mixed sites, with the trigger off so the flag is kept honest.
do $apply$
declare v_moved bigint; v_cleared bigint; v_left_monthly bigint;
begin
  alter table public.search_listings_ar disable trigger trg_rent_period_judgment;
  update public.search_listings_ar s
     set rent_period_ar = 'سنوي', price_annual = coalesce(s.price_annual, s.price_total) * 12, rent_period_judged = true
   where s.deal_ar = 'إيجار' and s.rent_period_judged and s.rent_period_ar = 'شهري'
     and s.platform not in ('gathern', 'aqarmonthly')
     and public.judge_silent_rent_period_ar(coalesce(s.price_annual, s.price_total), s.type_ar) = 'شهري';
  get diagnostics v_moved = row_count;
  update public.search_listings_ar s
     set rent_period_ar = null, rent_period_judged = false
   where s.deal_ar = 'إيجار' and s.rent_period_judged and s.rent_period_ar = 'شهري'
     and s.platform not in ('gathern', 'aqarmonthly');
  get diagnostics v_cleared = row_count;
  alter table public.search_listings_ar enable trigger trg_rent_period_judgment;
  select count(*) into v_left_monthly from public.search_listings_ar
   where production_ready and deal_ar = 'إيجار' and rent_period_ar = 'شهري' and platform not in ('gathern', 'aqarmonthly');
  if v_left_monthly <> 0 then raise exception 'APPLY: % mixed-site rows still carry «شهري»', v_left_monthly; end if;
  raise notice 'APPLY OK: % per-month figures now served as yearly ×12, % placeholders/unlisted types back to unknown', v_moved, v_cleared;
end $apply$;

-- Proof.
do $proof$
declare r record; v_left bigint;
begin
  if public.judge_silent_rent_period_ar(2500, 'شقة') is distinct from 'شهري' then raise exception 'PROOF: 2,500 apartment is a per-month figure'; end if;
  if public.judge_silent_rent_period_ar(7999, 'Office') is distinct from 'شهري' then raise exception 'PROOF: 7,999 office is a per-month figure'; end if;
  if public.judge_silent_rent_period_ar(299, 'شقة') is not null then raise exception 'PROOF: 299 is a placeholder'; end if;
  if public.judge_silent_rent_period_ar(2500, 'أرض') is not null then raise exception 'PROOF: 2,500 on land is unknown'; end if;
  if public.judge_silent_rent_period_ar(8000, 'شقة') is not null then raise exception 'PROOF: 8,000 is borderline'; end if;
  if public.judge_silent_rent_period_ar(14999, 'مستودع') is not null then raise exception 'PROOF: 14,999 is borderline'; end if;
  if public.judge_silent_rent_period_ar(15000, 'أرض') is distinct from 'سنوي' then raise exception 'PROOF: 15,000 is yearly on any type'; end if;
  if public.judge_silent_rent_period_ar(null, 'شقة') is not null then raise exception 'PROOF: no price, no guess'; end if;
  -- the customer case still holds
  select rent_period_ar, rent_period_judged, price_annual into r from public.search_listings_ar where platform = 'wajaf' and listing_id = 22222374;
  if r.rent_period_ar is distinct from 'سنوي' or not r.rent_period_judged or r.price_annual <> 180000 then raise exception 'PROOF: wajaf 22222374 changed (%, %, %)', r.rent_period_ar, r.rent_period_judged, r.price_annual; end if;
  -- idempotency: a no-op touch on a judged ×12 row keeps its figure
  select s.listing_id, s.source_table, s.price_annual into r from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_judged and s.rent_period_ar = 'سنوي' and s.price_annual < 96000
     and s.platform not in ('gathern', 'aqarmonthly') and s.price_annual = round(s.price_annual / 12) * 12 limit 1;
  if r.listing_id is not null then
    update public.search_listings_ar set rent_period_ar = null where listing_id = r.listing_id and source_table = r.source_table;
    if (select price_annual from public.search_listings_ar where listing_id = r.listing_id and source_table = r.source_table) <> r.price_annual then
      raise exception 'PROOF: a no-op touch multiplied % again', r.listing_id;
    end if;
  end if;
  perform public.mon_detect_priced_rent_unreachable();
  select count(*) into v_left from public.search_listings_ar s
   where s.production_ready and s.deal_ar = 'إيجار' and s.rent_period_ar is null
     and public.judge_silent_rent_period_ar(coalesce(s.price_annual, s.price_total), s.type_ar) is not null;
  if v_left <> 0 then raise exception 'PROOF: % labelable rows still NULL', v_left; end if;
  raise notice 'PROOF OK: per-month figures are yearly ×12, placeholders unknown, wajaf untouched, touch is idempotent, 0 labelable rows NULL';
end $proof$;
