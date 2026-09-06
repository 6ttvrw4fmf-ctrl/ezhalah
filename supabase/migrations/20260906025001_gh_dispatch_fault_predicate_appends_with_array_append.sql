-- FOLLOW-UP to 20260906024816 (ops_incident #74), caught by that migration's own production
-- mutation run before the detector had ever swept.
--
-- WHAT WAS WRONG. `v_faults := v_faults || 'dispatcher_missing';` does NOT append a string to a
-- text[]. With an untyped literal Postgres resolves `||` to anycompatiblearray || anycompatiblearray
-- and tries to parse 'dispatcher_missing' as an array literal, so EVERY fault path raised
--     22P02 malformed array literal: "dispatcher_missing"
-- The predicate was therefore fine on the healthy path (empty array, no append) and threw on every
-- single path that had something to report. mon_run_all_detectors would have caught the throw in
-- its per-detector exception block and raised detector_crash, so it was never going to be silent
-- -- but a detector that cannot report the fault it exists to report is not a detector.
--
-- Found by EXECUTING the predicate against injected definitions rather than by reading it. A green
-- offline barrier said nothing about this, and could not: it asserts SQL shape, and the shape was
-- correct. array_append() has one meaning and is not resolvable to anything else.

create or replace function public.mon_gh_dispatch_faults(p_def text, p_tok text, p_jobs integer)
returns text[]
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_code   text;
  v_post   integer;
  v_ret    integer;
  v_faults text[] := '{}';
begin
  if p_def is null then
    if coalesce(p_jobs, 0) > 0 then
      v_faults := array_append(v_faults, 'dispatcher_missing');
    end if;
    return v_faults;
  end if;

  -- Strip comments at the READER, trailing ones included. A prose header that quotes the old
  -- silent body must never be able to satisfy, or trip, a check about the executed code path.
  v_code := regexp_replace(p_def, '/\*.*?\*/', ' ', 'gs');
  v_code := regexp_replace(v_code, '--.*$', '', 'gn');

  v_post := position('net.http_post' in v_code);
  if v_post = 0 then
    v_faults := array_append(v_faults, 'no_dispatch_call');
  else
    -- A `return;` AFTER the post is harmless; one BEFORE it is the defect itself, which is why
    -- this compares positions instead of merely asking whether the token appears.
    v_ret := regexp_instr(v_code, '\mreturn\s*;', 1, 1, 0, 'i');
    if v_ret > 0 and v_ret < v_post then
      v_faults := array_append(v_faults, 'returns_before_dispatch');
    end if;
  end if;

  if v_code !~* '\mraise\s+exception' then
    v_faults := array_append(v_faults, 'no_loud_failure');
  end if;

  if coalesce(p_jobs, 0) > 0 and (p_tok is null or btrim(p_tok) = '') then
    v_faults := array_append(v_faults, 'credential_missing');
  end if;

  return v_faults;
end $function$;

comment on function public.mon_gh_dispatch_faults(text, text, integer) is
  'Decides whether the pg_cron to GitHub dispatch seam can silently do nothing. Pure and injectable '
  'so the predicate can be executed against a mutated definition; mon_detect_gh_dispatch_silently_skipped() raises on it.';
