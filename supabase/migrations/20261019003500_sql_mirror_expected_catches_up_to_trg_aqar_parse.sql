-- 2026-10-18. Register the regenerated sql/mirrors/trg_aqar_parse.sql digest in the live drift registry.
-- Production's trg_aqar_parse() changed twice today, both by in-place guarded edits:
--   20261018234721 — the Buy total is written only when the row's own price_evidence unit is not per_meter;
--   20261018235847 — NEW.direction := public.aqar_facade(...), the closed facade vocabulary.
-- The registry still expected the 2026-08-11 digest (e94517e6…), so the mirror is regenerated from production and
-- this records the same digest. Refuses to register unless it equals the LIVE body and both edits are present.
update public.ops_sql_mirror_expected
   set expected_md5 = '947fd49be1e4914667714cd5da89a6fb',
       recorded_at = now(),
       note = 'Regenerated 2026-10-18 after 20261018234721 (rate-headline gate) and 20261018235847 (closed facade).'
 where object_name = 'trg_aqar_parse';

do $verify$
declare v_md5 text; v_live text; v_body text;
begin
  select expected_md5 into strict v_md5 from public.ops_sql_mirror_expected where object_name = 'trg_aqar_parse';
  v_body := pg_get_functiondef('public.trg_aqar_parse()'::regprocedure);
  v_live := md5(v_body);
  if v_md5 <> v_live then
    raise exception 'registered digest % does not match the LIVE trg_aqar_parse %', v_md5, v_live;
  end if;
  if position('aqar_facade(' in v_body) = 0 or position('price_evidence' in v_body) = 0 then
    raise exception 'the live trg_aqar_parse lacks one of today''s two edits - refusing to register this digest';
  end if;
  raise notice 'ops_sql_mirror_expected now matches the live trg_aqar_parse (%)', v_live;
end $verify$;
