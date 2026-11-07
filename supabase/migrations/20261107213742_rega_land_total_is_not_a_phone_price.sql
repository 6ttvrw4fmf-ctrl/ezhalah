-- 🔧 2026-11-07: a price the source's own REGA API field states verbatim is not a phone number captured as a price.
--
-- field_integrity_phone_price:muhaysini_residential_listings raised 11-05, was cleared 11-06 by hand-verifying six
-- rows (ops_price_source_verified), and raised again 11-07 on a NEW ad of the same shape (MHS43202): a land whose
-- seller typed the TOTAL into the per-metre box, so REGA's own AdValidator.advertisement.landTotalPrice is
-- box × area (1,105,637.5 × 514.25 = 568,574,084.38, read live 11-07). The stored price IS that structured API
-- field (source_capture.price_evidence: origin api, field …landTotalPrice, stored = the column) — PRICE = SOURCE —
-- and the served index already shows the box (land_ppm_typed_as_total). The phone/ID arm exists for numbers
-- lifted out of free TEXT (the 2026-07-28 aqar class); an API's typed total field cannot be a phone number. So the
-- arm now skips exactly that evidence shape, instead of waiting for a human to verify each new ad. A text-sourced
-- or unevidenced price in the band still raises.

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);
  if position('landTotalPrice$' in src) > 0 then
    raise notice 'REGA land-total exemption already present';
    return;
  end if;
  out_def := replace(src,
    E'or price_annual between 500000000 and 599999999)\n',
    E'or price_annual between 500000000 and 599999999)\n'
    || E'                            and not (coalesce(source_capture->''price_evidence''->>''origin'', '''') = ''api''\n'
    || E'                                     and coalesce(source_capture->''price_evidence''->>''field'', '''') ~ ''landTotalPrice$''\n'
    || E'                                     and coalesce(source_capture->''price_evidence''->>''stored'', '''') ~ ''^[0-9]+$''\n'
    || E'                                     and (source_capture->''price_evidence''->>''stored'')::numeric\n'
    || E'                                         = coalesce(price_total, price_annual))\n');
  if out_def = src then
    raise exception 'anchor not found — refusing to guess';
  end if;
  if (length(out_def) - length(replace(out_def, 'landTotalPrice$', ''))) / length('landTotalPrice$') <> 1 then
    raise exception 'anchor matched more than once — refusing';
  end if;
  execute out_def;
end $$;

-- PROOF at apply: with MHS43202's hand verification removed, the REGA-field evidence alone keeps it quiet;
-- with that evidence also removed (a price of unknown origin in the band), the arm raises. Both rolled back.
do $$
begin
  begin
    delete from public.ops_price_source_verified
     where source_table = 'muhaysini_residential_listings' and listing_id = 25119517;
    perform public.mon_detect_field_integrity();
    if exists (select 1 from public.alert_event
                where dedup_key = 'field_integrity_phone_price:muhaysini_residential_listings' and resolved_at is null) then
      raise exception 'PROOF: a REGA landTotalPrice row still raised as a phone-shaped price';
    end if;
    update public.muhaysini_residential_listings
       set source_capture = source_capture - 'price_evidence' where id = 25119517;
    perform public.mon_detect_field_integrity();
    if not exists (select 1 from public.alert_event
                    where dedup_key = 'field_integrity_phone_price:muhaysini_residential_listings' and resolved_at is null) then
      raise exception 'PROOF: an unevidenced price in the phone band was not caught';
    end if;
    raise exception '__phone_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__phone_selftest_rollback__' then raise; end if;
  end;
  perform public.mon_detect_field_integrity();
end $$;

-- ── Part 2 (same run): unresolvable_alert_kind:bedrooms_not_captured_fleet ─────────────────────────────────────────
-- mon_detect_bedrooms_not_captured() DOES clear its key, but as mon_resolve_key(k, k) through a constant, and
-- mon_detect_unresolvable_alert_kinds() (STRICT on purpose) only recognises the kind as a literal. Write the literal.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_detect_bedrooms_not_captured()'::regprocedure);
  if position('mon_resolve_key(''bedrooms_not_captured_fleet''' in src) > 0 then
    raise notice 'literal resolver already present';
    return;
  end if;
  if position('k constant text := ''bedrooms_not_captured_fleet''' in src) = 0 then
    raise exception 'k is not the constant this edit assumes — refusing';
  end if;
  out_def := replace(src, 'perform public.mon_resolve_key(k, k);',
    'perform public.mon_resolve_key(''bedrooms_not_captured_fleet'', ''bedrooms_not_captured_fleet'');');
  if out_def = src then raise exception 'anchor not found — refusing to guess'; end if;
  execute out_def;
end $$;

-- PROOF: the meta-detector now recognises the kind, so its unresolvable_alert_kind row clears.
do $$
begin
  perform public.mon_detect_unresolvable_alert_kinds();
  if exists (select 1 from public.alert_event
              where dedup_key = 'unresolvable_alert_kind:bedrooms_not_captured_fleet' and resolved_at is null) then
    raise exception 'PROOF: bedrooms_not_captured_fleet still reads as unresolvable';
  end if;
end $$;
