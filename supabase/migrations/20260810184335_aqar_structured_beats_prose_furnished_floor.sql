-- P0: PROSE was overriding the STRUCTURED value on aqar.
--
--   NEW.furnished    := coalesce(public.safe_bool(p->>'furnished'), NEW.furnished);
--   NEW.floor_number := public.safe_int(p->>'floor_number');
--
-- `p` is aqar_parse(source_text) - a regex sweep over the WHOLE page including
-- seller free text. In the first line prose WINS over the structured 0/1 the
-- scraper stored. The second is worse: prose overwrites unconditionally, with no
-- coalesce at all, discarding whatever was there.
--
-- Measured before this fix: 3,504 / 11,127 aqar annual-rent apartments (31.5%) were
-- prose-decided, and 3,445 of the 3,472 visible "Furnished" results (99.2%) came
-- from the regex rather than from aqar's own field.
--
-- Owner rule: "structured source beats prose". Both lines are inverted so the
-- structured value wins and prose can only FILL A GAP, never overwrite. Prose is
-- still not promoted to a source of truth - closing that remaining gap means
-- reading aqar's structured `fl` and furnished flags in the scraper, which is a
-- separate change.
--
-- Needle-edited from the LIVE body (pg_get_functiondef) rather than re-issued from
-- an older definition, so no concurrently-added logic is silently reverted.
do $$
declare src text; out_sql text; n_furn int; n_floor int;
begin
  select pg_get_functiondef(p.oid) into strict src
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='trg_aqar_parse';

  out_sql := src;

  out_sql := replace(out_sql,
    'NEW.furnished       := coalesce(public.safe_bool(p->>''furnished''), NEW.furnished);',
    'NEW.furnished       := coalesce(NEW.furnished, public.safe_bool(p->>''furnished''));  -- structured beats prose');
  out_sql := replace(out_sql,
    'NEW.floor_number    := public.safe_int(p->>''floor_number'');',
    'NEW.floor_number    := coalesce(NEW.floor_number, public.safe_int(p->>''floor_number''));  -- structured beats prose');

  -- refuse to apply a no-op: if neither needle matched, the body changed shape and
  -- silently doing nothing would leave the P0 live while reporting success.
  n_furn  := (select count(*) from regexp_matches(out_sql, 'coalesce\(NEW\.furnished, public\.safe_bool', 'g'));
  n_floor := (select count(*) from regexp_matches(out_sql, 'coalesce\(NEW\.floor_number, public\.safe_int', 'g'));
  if n_furn <> 1 or n_floor <> 1 then
    raise exception 'aqar prose-override needle did not match exactly once (furnished=%, floor=%) - body shape changed, refusing to guess', n_furn, n_floor;
  end if;

  execute out_sql;
end $$;
