-- The self-test applied minutes ago could not report a failure: `blind := blind || '<literal>'` with
-- `blind text[]` resolves the untyped literal to text[], so the first append raised
-- «22P02 malformed array literal» instead of collecting the finding. Caught by the mutation proof the
-- moment the predicate was replaced with `select true` — the healthy path never reaches those lines,
-- so a green run said nothing about them. Exactly the shape this file warns about: a guard that
-- passes while it cannot do its job. Every append is now explicitly ::text.
--
-- This also restores price_drift_confirmed() to its real body: the mutation proof had replaced it
-- with `select true` in the live database.

create or replace function public.price_drift_confirmed(
  p_probe_src_total  numeric,
  p_probe_src_annual numeric,
  p_probe_sync_at    timestamptz,
  p_cur_src_total    numeric,
  p_cur_src_annual   numeric,
  p_last_sync        timestamptz)
returns boolean
language sql
immutable
as $function$
  select p_last_sync     is not null
     and p_probe_sync_at is not null
     and p_probe_sync_at  <  p_last_sync
     and p_probe_src_total  is not distinct from p_cur_src_total
     and p_probe_src_annual is not distinct from p_cur_src_annual;
$function$;

create or replace function public.mon_detect_price_drift_predicate_is_blind()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; blind text[] := '{}';
  t1 constant timestamptz := '2026-09-27 06:22:00+00';  -- sync pass at the observation
  t2 constant timestamptz := '2026-09-27 07:22:00+00';  -- a later, completed sync pass
begin
  -- POSITIVE: the thing it exists to notice.
  if not public.price_drift_confirmed(1000000, null, t1, 1000000, null, t2) then
    blind := blind || 'a PROVEN stuck row (source unchanged, a sync pass completed since) was not confirmed'::text;
  end if;
  if not public.price_drift_confirmed(null, 332046, t1, null, 332046, t2) then
    blind := blind || 'a PROVEN stuck row on price_annual was not confirmed'::text;
  end if;

  -- NEGATIVE A: no sync pass has completed since the observation.
  if public.price_drift_confirmed(1000000, null, t2, 1000000, null, t2) then
    blind := blind || 'a mismatch with NO sync pass since the observation was confirmed as stuck'::text;
  end if;

  -- NEGATIVE B -- THE ONE THIS WAS BUILT FOR. The aqarmonthly shape measured 2026-09-27 (probe saw
  -- 333,195; source now 332,046), 278 rows, every one converged on one ordinary sync pass.
  if public.price_drift_confirmed(333195, null, t1, 332046, null, t2) then
    blind := blind || 'ordinary crawl/sync interleaving (the source changed again) was confirmed as stuck -- the false-P1 class is back'::text;
  end if;
  if public.price_drift_confirmed(null, 333195, t1, null, 332046, t2) then
    blind := blind || 'ordinary interleaving on price_annual was confirmed as stuck'::text;
  end if;

  -- NEGATIVE C: no sync evidence at all. Absence cannot be compared.
  if public.price_drift_confirmed(1000000, null, t1, 1000000, null, null) then
    blind := blind || 'a mismatch with NO recorded sync pass was confirmed as stuck'::text;
  end if;

  -- NEGATIVE D: one column held still while the other moved.
  if public.price_drift_confirmed(1000000, 500000, t1, 1000000, 600000, t2) then
    blind := blind || 'a row whose annual price moved was confirmed on the strength of its total alone'::text;
  end if;

  if array_length(blind, 1) > 0 then
    n := public.mon_raise('P1', 'price_drift_predicate_blind', 'all', 'price_drift_predicate_blind',
      jsonb_build_object('failures', to_jsonb(blind), 'count', array_length(blind, 1),
        'why', 'price_drift_confirmed() no longer separates a PROVEN stuck price from ordinary '
            || 'crawl/sync interleaving. Either price_fidelity() is about to resume raising a P1 a '
            || 'day on cadence (masking real drift on other platforms, since mon_raise dedups per '
            || 'key), or it has gone dark and a genuinely stuck price will never be raised at all. '
            || 'The named failures say which direction.',
        'measured_at', now()));
  else
    perform public.mon_resolve('price_drift_predicate_blind', 'all');
  end if;
  return n;
end $function$;
