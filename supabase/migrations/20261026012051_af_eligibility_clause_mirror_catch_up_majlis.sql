-- af_eligibility_clause mirror catch-up (2026-10-26). Migration 20261026011638 (majlis_advanced_filter_amenity) rebuilt
-- the clause with the majlis whitelist entry and predicate arm; sql/mirrors/af_eligibility_clause.sql now records the
-- digest below. scripts/verify-mirror-md5-is-registered.ts requires every digest a mirror header records to appear as a
-- literal in a committed migration — this file is that literal, and it PROVES the live body matches it at apply time.
do $$
declare live text := md5(pg_get_functiondef('public.af_eligibility_clause()'::regprocedure));
begin
  if live <> '62539dd9f79949bfbb7842182e72e4f7' then
    raise exception 'af_eligibility_clause live md5 % is not the recorded 62539dd9f79949bfbb7842182e72e4f7 — regenerate the mirror', live;
  end if;
end $$;
