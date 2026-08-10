-- AUDIT (2026-08-10 daily engineer follow-up, per owner's standing "source is truth" rule): the
-- price_gate_withheld alert has sat open since 2026-08-09 with a comment saying "owner decision
-- pending" — but the owner's decision is already standing policy (2026-08-04): "If the source
-- platform genuinely publishes a value, Ezhalah should preserve it... detect our mistakes, not
-- censor legitimate source-published values." That resolves the blocker; this migration acts on it.
--
-- Per-row source verification of all 18 rows currently gated by price_size_impossible() (full
-- evidence in the accompanying data repair) found FIVE confirmed-genuine large land/farm listings
-- gated for NO price reason at all — their price is either a plausible per-meter RATE (correctly
-- left NULL as a total) or a reasonable price/area ratio. They are gated SOLELY by the bare
-- "area > 5,000,000 m²" clause, which does not look at price at all:
--   aqar_residential 1408409 — 23,400,000 m², source states "سعر المتر 110 §" (a rate, not a
--     total; price_total is correctly null)
--   aqar_residential 6981503 — 10,000,000 m², source states "سعر المتر 650 §" (rate only)
--   aqar_commercial  5004234 — 10,000,000 m² farm rental, source states "سعر المتر 1 §" (rate only)
--   dealapp_residential 2295954 — 15,000,000 m², source explicitly explains this is a SHARED/
--     undivided deed total ("الارض مشاعة بصك اجمالي 15,000,000 متر"); price_total 3.3B / area =
--     ~220 SAR/m², an entirely ordinary agricultural rate
--   mustqr_residential 615142 — 25,000,000 m², source describes a real multi-well farm with
--     matching street-length dimensions; area confirmed, price ppm (~0.4 SAR/m²) unremarkable
--
-- Saudi agricultural/industrial land legitimately reaches into the tens-of-millions-of-m² range
-- (a large farm concession, an industrial zone plot). A bare area threshold cannot distinguish that
-- from a genuine defect, which is exactly why the function ALSO has a price-per-meter clause — PPM
-- already normalises for size and is the real backstop. Raising the area-alone threshold 10x (to
-- 50,000,000 m² — beyond any observed genuine listing, including the largest confirmed-real one
-- above at 25M) removes the false-positive class while leaving every genuinely-impossible case this
-- gate has ever actually caught (e.g. the 506,200,774 m² "furnished chalets" concatenation bug fixed
-- earlier today, or a trillion-SAR price divided by a normal area) caught exactly as before, because
-- those all ALSO trip the unchanged 50-billion-SAR absolute price clause or the raised-but-still-
-- bounded absolute area clause.
create or replace function public.price_size_impossible(pt numeric, pa numeric, area integer)
 returns boolean
 language sql
 immutable
as $function$
  select coalesce(pt,0) > 50000000000
      or coalesce(pa,0) > 50000000000
      or coalesce(area,0) > 50000000
      or (area is not null and area > 0
          and greatest(coalesce(pt,0), coalesce(pa,0)) / area > 5000000);
$function$;

comment on function public.price_size_impossible(numeric, numeric, integer) is
  'Write-time plausibility backstop for enforce_price_size_sanity() — sets production_ready=false '
  'only for genuinely impossible combinations. Area-alone threshold raised 5M->50M on 2026-08-10 '
  'after 5 of 18 currently-gated rows proved to be confirmed-genuine large Saudi agricultural/'
  'industrial land with a merely per-meter-rate price (correctly left NULL as a total) or an '
  'ordinary price-per-meter ratio. The PPM clause (>5,000,000 SAR/m²) is the real backstop and is '
  'unchanged; never lower the price clauses without the same per-row source verification standard.';

-- Regression guard, self-cleaning, safe to run on production: proves the recalibration admits the
-- five confirmed-genuine cases while still catching the two classes of REAL defect this gate exists
-- for (a fabricated total price at any area, and a genuinely-impossible area regardless of price).
create or replace function public.mon_selftest_price_size_impossible_recalibration() returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_ok boolean := true;
begin
  -- Confirmed-genuine: large land, rate-only (no total) price — must NOT be gated.
  if public.price_size_impossible(null, null, 23400000) then v_ok := false; end if;  -- aqar 1408409
  if public.price_size_impossible(null, null, 10000000) then v_ok := false; end if;  -- aqar 6981503
  if public.price_size_impossible(3300000000, null, 15000000) then v_ok := false; end if;  -- dealapp 2295954, ~220 SAR/m2
  if public.price_size_impossible(null, 1000000, 25000000) then v_ok := false; end if;  -- mustqr 615142 rent, ~0.04 SAR/m2/yr

  -- Still caught: the real defect classes this gate exists for.
  if not public.price_size_impossible(null, null, 506200774) then v_ok := false; end if;  -- fabricated-area artifact (today's dealapp 1284664 fix) — area alone beyond the raised 50M cap
  if not public.price_size_impossible(null, null, 100000000) then v_ok := false; end if;  -- 100M m2 — still beyond the raised 50M absolute cap
  if not public.price_size_impossible(60000000000, null, 1000) then v_ok := false; end if;  -- 60B SAR total — still beyond the unchanged 50B absolute price cap
  if not public.price_size_impossible(2000000000, null, 300) then v_ok := false; end if;  -- 2B SAR / 300 m2 = ~6.7M SAR/m2 — still beyond the unchanged PPM cap

  return v_ok;
end $function$;

comment on function public.mon_selftest_price_size_impossible_recalibration() is
  'Regression guard: proves the 2026-08-10 area-threshold recalibration admits the confirmed-'
  'genuine large-land cases while still catching a fabricated-area artifact, a still-impossible '
  'absolute area, a still-impossible absolute price, and a still-impossible price-per-meter ratio. '
  'Safe to run on production (pure function, no writes).';

do $do$
begin
  if not public.mon_selftest_price_size_impossible_recalibration() then
    raise exception 'price_size_impossible recalibration self-test FAILED — refusing to ship it green';
  end if;
end $do$;
