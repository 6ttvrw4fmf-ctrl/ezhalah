-- suspicious_listing_facts:age_as_bedrooms tells a coincidence from a misread (fields-and-filters, 2026-11-04).
--
-- The one row it flagged is the very ad its own text names as the bug — sakan 100289 (listing 18951706):
-- «العمر : + 10» AND, in the same ad, «10 غرف نوم - صالات معيشة واسعة», with the site's spec table «غرف: 10».
-- The ad states ten bedrooms in words, so the stored 10 is the site's own count, not the age. A row is now
-- a suspect only when the age equals the bedrooms AND the ad does NOT itself state that many rooms
-- («N غرف / غرفة / غرفه»). Proven both ways on literals: «العمر : + 10 … فيلا دورين» still hits;
-- «العمر : + 10 … 10 غرف نوم» does not; «عمر العقار: 7 - 17 غرفة» still hits (17 ≠ 7).
do $do$
declare
  v_def text := pg_get_functiondef('public.mon_detect_suspicious_listing_facts()'::regprocedure);
  v_old text := E'select t, id, bedrooms from recent\n     where translate(';
  v_new text := E'select t, id, bedrooms from recent\n'
             || E'     -- the ad itself states that many rooms → the count is the site''s, not a misread age\n'
             || E'     where translate(coalesce(d, \'\'), \'٠١٢٣٤٥٦٧٨٩\', \'0123456789\')\n'
             || E'           !~ (\'(^|\\D)\' || bedrooms::text || \'\\s*(غرف|غرفة|غرفه)\')\n'
             || E'       and translate(';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'mon_detect_suspicious_listing_facts: anchor not found exactly once — re-read the live function';
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;

select public.mon_detect_suspicious_listing_facts();
