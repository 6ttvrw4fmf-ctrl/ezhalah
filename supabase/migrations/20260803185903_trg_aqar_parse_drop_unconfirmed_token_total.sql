-- Companion (2026-08-03): trg_aqar_parse's fidelity guard drops a Buy price_total only in two
-- proven phone/REGA-artifact bands when the strict parser could not confirm any price. Extend it
-- with the token band: parsed_price NULL AND price_total 1–9,999 → NULL. A Saudi Buy TOTAL under
-- 10k SAR does not exist; when the source genuinely displays such a number as the price the strict
-- parser CONFIRMS it (§-marked, rate-excluded) and it is stored exactly — this guard only fires on
-- UNCONFIRMED leftovers (the Python enrich's rate-as-total captures this backfill re-parses away).
do $mig$
declare src text; out text; needle text;
begin
  src := pg_get_functiondef('public.trg_aqar_parse'::regproc);
  if position('between 1 and 9999' in src) > 0 then
    raise notice 'already applied — skipping';
    return;
  end if;
  needle := '       and (NEW.price_total between 100000000 and 101000000
         or NEW.price_total between 500000000 and 599999999) then';
  if position(needle in src) = 0 then
    raise exception 'trg_aqar_parse: band anchor not found — aborting (function shape changed)';
  end if;
  out := replace(src, needle, '       and (NEW.price_total between 100000000 and 101000000
         or NEW.price_total between 500000000 and 599999999
         or NEW.price_total between 1 and 9999) then');
  if out = src then
    raise exception 'trg_aqar_parse: token-band edit did not apply — aborting';
  end if;
  execute out;
end
$mig$;
