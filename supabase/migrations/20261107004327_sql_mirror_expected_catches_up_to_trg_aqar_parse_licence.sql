-- Regenerating a mirror is a TWO-PLACE edit (verify-mirror-md5-is-registered). 20261106214548 (the Aqar trigger keeps
-- the payload ad licence) rebuilt trg_aqar_parse(); sql/mirrors/trg_aqar_parse.sql was refreshed to it in #10935, and
-- this row catches the registry up to the same digest.
update public.ops_sql_mirror_expected
   set expected_md5 = 'fa440fd873b46ba1b284ae209c8b455c',
       recorded_at = now(),
       note = 'Regenerated 2026-11-07 after the trigger began keeping the payload ad licence (Aqar licence on the card).'
 where object_name = 'trg_aqar_parse';

do $verify$
declare v_md5 text; v_live text;
begin
  select expected_md5 into strict v_md5 from public.ops_sql_mirror_expected where object_name = 'trg_aqar_parse';
  select md5(pg_get_functiondef('public.trg_aqar_parse()'::regprocedure)) into v_live;
  if v_md5 <> v_live then
    raise exception 'registered digest % does not match the LIVE trg_aqar_parse %', v_md5, v_live;
  end if;
  if position('ad_license_number' in pg_get_functiondef('public.trg_aqar_parse()'::regprocedure)) = 0 then
    raise exception 'the live trigger does not read the payload licence - refusing to register this digest';
  end if;
end $verify$;
