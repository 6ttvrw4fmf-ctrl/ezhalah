-- Aqar REGA advertisement licence: trg_aqar_parse keeps the licence aqar publishes in its own payload.
-- Blind spot 1356 (new-listings engineer, 2026-11-06): 0 of 999 aqar arrivals in 24 h served a licence
-- (Deal App 1,489 of 1,489). aqar renders the licence block client-side, so the stored visible text never
-- holds it, and this trigger set license_number from that text alone, on every write. The scraper now
-- stores the payload field listing.ad_license_number in source_capture.ad_license_number (CI re-read
-- 42298616610: 96046 -> 7200958887, 102675 -> 7200887930). Needle edit of the live definition: the
-- payload's licence first, the text parse as before when the payload is silent. Nothing else changes.
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.trg_aqar_parse()'::regprocedure);
  d2 := replace(d,
    $o$NEW.license_number  := p->>'license_number';$o$,
    $n$NEW.license_number  := coalesce(NEW.source_capture->>'ad_license_number', p->>'license_number');  -- aqar's payload licence first (1356)$n$);
  if d2 = d then raise exception 'needle not found in trg_aqar_parse'; end if;
  execute d2;
end $mig$;

-- Check block: the new line is live AND the trigger really runs with it (rolled back, no row changes).
do $chk$
declare v text; t text;
begin
  if pg_get_functiondef('public.trg_aqar_parse()'::regprocedure) not like '%NEW.source_capture->>''ad_license_number''%' then
    raise exception 'trg_aqar_parse does not read source_capture.ad_license_number';
  end if;
  begin
    update public.aqar_residential_listings
       set source_capture = source_capture || '{"ad_license_number":"7200887930"}'::jsonb
     where id = (select id from public.aqar_residential_listings
                  where source_capture->>'source_text' is not null order by id desc limit 1)
    returning license_number into v;
    raise exception 'chk_rollback:%', coalesce(v, 'NULL');
  exception when raise_exception then
    get stacked diagnostics t = message_text;
    if t not like 'chk_rollback:%' then raise; end if;
    if t <> 'chk_rollback:7200887930' then raise exception 'trigger did not keep the payload licence: %', t; end if;
  end;
end $chk$;
