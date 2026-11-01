-- 2026-10-18 (follow-up of #7585). trg_aqar_parse «fully owns» the Buy total: on every insert/upsert it re-parses
-- source_capture.source_text and writes the FIRST §-marked figure as price_total. When aqar's headline IS the
-- per-metre rate (6891249: «100 §» on 102,000 m²; the enricher's headline_is_rate() now sends AUTHORITATIVE_NULL and
-- records price_evidence.unit = per_meter), the trigger put the rate straight back as the total — the stub-recovery
-- write of 2026-10-18 23:55 UTC logged «price_total 100 → NULL» and the row still read 100.
-- The trigger now leaves the total alone when the row's own evidence says the headline is a per-metre figure.
-- Edited in place (guarded replace of one condition), so a concurrent change to any other line is kept.
set local lock_timeout = '5s';

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.trg_aqar_parse()'::regprocedure);
  if position('price_evidence' in src) > 0 then
    raise notice 'trg_aqar_parse already honours price_evidence';
    return;
  end if;
  out_def := replace(src,
    E'    if parsed_price is not null then\n      NEW.price_total := parsed_price;',
    E'    if parsed_price is not null\n       and coalesce(NEW.source_capture->''price_evidence''->>''unit'', '''') <> ''per_meter'' then\n      NEW.price_total := parsed_price;');
  if out_def = src then
    raise exception 'trg_aqar_parse: the Buy-total anchor was not found — refusing to guess where the gate belongs';
  end if;
  execute out_def;
end $$;

-- PROOF at apply, on a real rate-headline row, rolled back: with per_meter evidence the trigger keeps the NULL total;
-- without it the trigger still writes the parsed headline (it keeps owning every other Buy total).
do $$
declare v_id bigint; v_total bigint;
begin
  select id into v_id from public.aqar_commercial_listings
   where ad_number = '6891249' and source_capture ? 'source_text';
  if v_id is null then
    raise notice 'PROOF skipped: 6891249 not present';
    return;
  end if;
  begin
    update public.aqar_commercial_listings
       set source_capture = jsonb_set(source_capture, '{price_evidence}', '{"unit": "per_meter", "proof": 1}'::jsonb),
           price_total = null
     where id = v_id;
    select price_total into v_total from public.aqar_commercial_listings where id = v_id;
    if v_total is not null then
      raise exception 'PROOF: per_meter evidence did not keep the total NULL (got %)', v_total;
    end if;
    update public.aqar_commercial_listings
       set source_capture = (source_capture - 'price_evidence') || '{"proof": 2}'::jsonb,
           price_total = null, price_per_meter = null      -- so the price==ppm artifact guard stays out of it
     where id = v_id;
    select price_total into v_total from public.aqar_commercial_listings where id = v_id;
    if v_total is null then
      raise exception 'PROOF: without per_meter evidence the trigger no longer owns the Buy total';
    end if;
    raise exception 'proof-rollback';
  exception when others then
    if sqlerrm <> 'proof-rollback' then raise; end if;
  end;
end $$;
