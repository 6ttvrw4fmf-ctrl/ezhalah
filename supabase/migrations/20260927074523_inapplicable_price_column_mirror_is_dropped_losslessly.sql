-- A PRICE IN THE COLUMN ITS DEAL TYPE DOES NOT USE -- but only the half that can be PROVEN.
--
-- FOUND (routine #3, 2026-09-27, ops_incident #840). Across 269,552 searchable rows, 41 carry a price
-- in the column their deal type does not use: 36 «بيع» rows with a price_annual, 5 «إيجار» rows with a
-- price_total. enforce_price_size_sanity() already states the rule -- "not applicable is NULL, never 0
-- ... a placeholder we invented, not a figure any source published" -- but it only ever acted on an
-- exact 0, so a non-zero value in the inapplicable column passed through untouched.
--
-- THE SPLIT, AND WHY ONLY HALF IS FIXED HERE. 4 of the 41 hold the SAME number in both columns
-- (mustqr 2, abeea 1, satel 1). Dropping the inapplicable one there is LOSSLESS BY CONSTRUCTION: the
-- identical figure is still present in the column the deal actually uses, so no source information
-- can be destroyed. That is a repair this routine can prove, so it makes it.
--
-- The other 37 hold DIFFERENT numbers -- e.g. aqar_residential 503, a villa «للبيع» at price_total
-- 2,400,000 carrying price_annual 27,600. That is either Ezhalah picking a foreign figure off the page
-- (the captured text for those rows is largely site navigation chrome), or a genuinely dual-listed
-- «للبيع أو للإيجار» advert. Stored data cannot tell those apart, and aqar is client-side rendered so a
-- plain fetch of the page does not settle it either. AGENTS.md and DATA_INTEGRITY_ENGINEER.md are
-- explicit that data is corrected only when Ezhalah can be PROVEN to have created the error, so those
-- 37 are left EXACTLY as they are and carried in #840 for source adjudication. Nulling a figure that
-- the source might really publish would itself be the fidelity violation this routine exists to stop.
--
-- USER IMPACT TODAY: none observed on Normal Filter -- the Buy price filter reads price_total and the
-- Rent filter reads price_annual, so neither reads the other's column. This is latent contamination,
-- not a live wrong card, and it is reported as such.
--
-- NOT ALREADY COVERED: mon_detect_price_borrowed_from_chrome() hunts a different shape (one repeated
-- constant dominating a platform's price_total distribution) and reads price_total only. Nothing in the
-- system could see the inapplicable-column shape before this.

-- 1. THE PURE PREDICATE -- decides, writes nothing, takes injected values so the self-test below can
--    run the REAL one rather than a copy of it.
create or replace function public.price_inapplicable_mirror(
  p_deal text, p_total numeric, p_annual numeric)
returns text
language sql
immutable
as $function$
  -- Returns the column that is a LOSSLESS mirror and may be dropped, or NULL when nothing may be.
  -- Requires an exact equality: a DIFFERENT value in the inapplicable column is not a mirror, it is
  -- an unadjudicated fact, and this function must never authorise dropping one.
  select case
    when p_deal = 'بيع'   and p_annual is not null and p_annual = p_total  then 'price_annual'
    when p_deal = 'إيجار' and p_total  is not null and p_total  = p_annual then 'price_total'
    else null
  end;
$function$;

comment on function public.price_inapplicable_mirror(text,numeric,numeric) is
  'PURE: which price column (if any) is an exact duplicate of the applicable one and can be dropped without losing any source figure. Executed against injected cases by mon_detect_price_inapplicable_mirror_blind().';

-- 2. THE WRITE PATH -- extend the existing sanity trigger by needle edit so a concurrent session's
--    change to it cannot be clobbered, and so every arm already in it stays exactly as it is.
do $mig$
declare def text; anchor constant text := '  return NEW;'; a int;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'enforce_price_size_sanity';
  if def is null then
    raise exception 'enforce_price_size_sanity() not found -- refusing to proceed';
  end if;
  if position('price_inapplicable_mirror' in def) > 0 then
    return;   -- already wired; idempotent re-apply
  end if;
  a := position(anchor in def);
  if a = 0 then
    raise exception 'needle anchor not found in the LIVE enforce_price_size_sanity() -- refusing to full-body-replace it';
  end if;
  def := substr(def, 1, a - 1)
      || '  -- An EXACT duplicate of the applicable price sitting in the inapplicable column carries no' || chr(10)
      || '  -- source figure of its own, so dropping it loses nothing (routine #3, 2026-09-27,' || chr(10)
      || '  -- ops_incident #840). A column holding a DIFFERENT value is deliberately left alone: it may' || chr(10)
      || '  -- be source-published, and only source adjudication may decide.' || chr(10)
      || '  case public.price_inapplicable_mirror(NEW.deal_ar, NEW.price_total, NEW.price_annual)' || chr(10)
      || '    when ''price_annual'' then NEW.price_annual := null;' || chr(10)
      || '    when ''price_total''  then NEW.price_total  := null;' || chr(10)
      || '    else null;' || chr(10)
      || '  end case;' || chr(10)
      || chr(10)
      || anchor
      || substr(def, a + length(anchor));
  execute def;
end $mig$;

-- 3. THE GUARD -- both the standing state (which the trigger now makes structurally impossible) and
--    the predicate itself, executed against injected cases in both directions.
create or replace function public.mon_detect_price_inapplicable_mirror_blind()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; blind text[] := '{}'; v_live bigint;
begin
  -- POSITIVE: an exact mirror must be reported as droppable, on both deal types.
  if public.price_inapplicable_mirror('بيع', 1000, 1000) is distinct from 'price_annual' then
    blind := blind || 'an exact price_annual mirror on a Buy row was not reported as droppable'::text;
  end if;
  if public.price_inapplicable_mirror('إيجار', 1000, 1000) is distinct from 'price_total' then
    blind := blind || 'an exact price_total mirror on a Rent row was not reported as droppable'::text;
  end if;

  -- NEGATIVE -- THE ONES THAT MATTER. A DIFFERENT value in the inapplicable column is an
  -- unadjudicated source fact. If this predicate ever authorises dropping one, Ezhalah starts
  -- destroying figures the source may really publish. aqar_residential 503 verbatim.
  if public.price_inapplicable_mirror('بيع', 2400000, 27600) is not null then
    blind := blind || 'a DIFFERING price_annual on a Buy row (aqar 503: 2,400,000 / 27,600) was authorised for dropping -- that is source destruction, not a repair'::text;
  end if;
  if public.price_inapplicable_mirror('إيجار', 630000, 130000) is not null then
    blind := blind || 'a DIFFERING price_total on a Rent row was authorised for dropping'::text;
  end if;
  -- A lone value in the applicable column is the normal case and must never be touched.
  if public.price_inapplicable_mirror('بيع', 1000, null) is not null then
    blind := blind || 'a Buy row with only a price_total was authorised for dropping'::text;
  end if;
  if public.price_inapplicable_mirror('إيجار', null, 1000) is not null then
    blind := blind || 'a Rent row with only a price_annual was authorised for dropping'::text;
  end if;
  -- An unknown deal type decides nothing. Never guess which column applies.
  if public.price_inapplicable_mirror(null, 1000, 1000) is not null then
    blind := blind || 'a row with an UNKNOWN deal type was authorised for dropping -- the applicable column is not known'::text;
  end if;

  -- THE STANDING STATE. With the trigger in place this is structurally 0; a non-zero means the
  -- write path regressed and mirrors are reaching the served index again.
  select count(*) into v_live from public.search_listings_ar s
   where public.price_inapplicable_mirror(s.deal_ar, s.price_total, s.price_annual) is not null;

  if array_length(blind, 1) > 0 or v_live > 0 then
    n := public.mon_raise(case when array_length(blind,1) > 0 then 'P1' else 'P2' end,
      'price_inapplicable_mirror', 'all', 'price_inapplicable_mirror',
      jsonb_build_object('predicate_failures', to_jsonb(blind), 'live_mirror_rows', v_live,
        'why', 'Either price_inapplicable_mirror() stopped telling an exact duplicate apart from a '
            || 'differing (unadjudicated) value -- in which direction the named failures say -- or '
            || 'mirror rows are reaching search_listings_ar again, meaning the sanity trigger no '
            || 'longer drops them on write. The dangerous direction is a DIFFERING value being '
            || 'authorised for dropping: that destroys a figure the source may publish.',
        'measured_at', now()));
  else
    perform public.mon_resolve('price_inapplicable_mirror', 'all');
  end if;
  return n;
end $function$;

-- 4. ROSTER, in the SAME migration -- a detector nothing reaches is decoration (AGENTS.md), and
--    mon_detect_orphaned_detectors() raises the moment one exists outside the roster.
do $mig$
declare def text; anchor constant text := '    ''mon_detect_oracle_chain_never_observed'','; a int;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if def is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to register the detector blind';
  end if;
  if position('mon_detect_price_inapplicable_mirror_blind' in def) > 0 then
    return;
  end if;
  a := position(anchor in def);
  if a = 0 then
    raise exception 'needle anchor not found in the LIVE mon_run_all_detectors() roster -- refusing to full-body-replace it';
  end if;
  def := substr(def, 1, a - 1)
      || '    ''mon_detect_price_inapplicable_mirror_blind'',' || chr(10)
      || anchor
      || substr(def, a + length(anchor));
  execute def;
end $mig$;
