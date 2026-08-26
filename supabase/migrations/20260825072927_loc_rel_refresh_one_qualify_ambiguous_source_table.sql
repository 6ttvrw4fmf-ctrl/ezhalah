-- Same-run correction. The batch_limit lookup added minutes earlier read
--     select coalesce(batch_limit, 2500) into v_limit
--       from loc_rel_refresh_state where source_table = p_src;
-- but loc_rel_refresh_one() RETURNS TABLE(source_table text, ...), so `source_table`
-- resolves ambiguously against that OUT parameter: "column reference source_table is
-- ambiguous". It would have failed EVERY table on the next tick, not just aqarcity.
--
-- It surfaced immediately and harmlessly because the function's own exception handler
-- recorded status='error' with the message instead of swallowing it -- which is the
-- behaviour worth keeping, and the reason this cost one manual call rather than a
-- silent night of skipped refreshes.
do $do$
declare src text; o text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'loc_rel_refresh_one';

  o := '  select coalesce(batch_limit, 2500) into v_limit
    from loc_rel_refresh_state where source_table = p_src;';
  if position(o in src) = 0 then
    raise exception 'batch_limit lookup not in the expected shape - refusing to patch blindly';
  end if;

  src := replace(src, o,
'  select coalesce(s.batch_limit, 2500) into v_limit
    from loc_rel_refresh_state s where s.source_table = p_src;');

  execute src;
end
$do$;
