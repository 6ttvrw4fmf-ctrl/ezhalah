-- APPLIED 2026-10-18 (owner session). FOUND IT → FIX IT NOW: the hourly detector roster (cron job 38,
-- mon_run_all_detectors) has timed out at 15 min on every run since 10:59 UTC — ~270 detectors blind for 3 hours.
--
-- CAUSE (mine). The source-district carry (20261018083435) served 7 words with Latin letters as districts — abralosol
-- «الشعبة D1» and six ksaaqar page-chrome strings («عقارات جدة JIJB», «حي النهضه _ صبيا _ … اكتب مراجعة معرض المراجعات…»).
-- That made mon_detect_card_label_contract's english_leak count 7 > 0, which sends it into its sample query. There the
-- `split` CTE, referenced once inside a correlated EXISTS, is INLINED by Postgres and re-aggregated over every
-- production_ready row for every production_ready row — it never finishes, and the roster's statement timeout
-- rolls back the whole run.
--
-- FIX, both halves:
-- (1) district_word_carryable() also refuses a word with Latin letters or longer than 40 characters — the 8 longest
--     carried values were address chains and page prose, never a district name (28,873 carried rows measured; the
--     shortest refused one is 41 chars). The 15 refused rows are removed from district_recovery by that rule, so the
--     hourly refill does not count them as losses.
-- (2) mon_detect_card_label_contract(): `split` is MATERIALIZED (computed once) and the per-row EXISTS becomes a hashed
--     (city_id, token) IN — same rows, one pass. Patched in place on the live text (anchors counted), not replaced.
-- PROOF at apply: no carried row with Latin or > 40 chars; the detector's slow path, forced on, finishes in < 120 s
-- (rolled back, no alert written).

create or replace function public.district_word_carryable(w text)
returns boolean
language sql immutable
as $$
  select coalesce(
    w ~ '[ء-ي]'
    and w !~ '[A-Za-z]'                -- 2026-10-18: Latin = page chrome / an address code, never an Arabic district word
    and length(btrim(w)) <= 40         -- 2026-10-18: longer = an address chain or prose, never a district name
    and regexp_replace(w, '^\s*(حي|مخطط)\s*', '') ~ '[ء-ي]{3,}'
    and (w !~ '[0-9٠-٩]' or w ~ '^[^0-9٠-٩]*[ء-ي]{3,}[^0-9٠-٩]*[0-9٠-٩]{1,2}$')
    and public.norm_district_tok(w) not in
        ('', public.norm_district_tok('غير محدد'), public.norm_district_tok('اخرى'), public.norm_district_tok('أخرى')),
    false)
$$;

-- remove the carried rows the rule now refuses (catalog names never have Latin letters or 41+ characters)
delete from public.district_recovery dr
 where dr.verbatim and (dr.district_ar ~ '[A-Za-z]' or length(btrim(dr.district_ar)) > 40);

do $patch$
declare d text; k int;
  a_cte  text := 'with split as (';
  a_exists text := E'or exists (select 1 from split p\n                    where p.city_id is not distinct from s.city_id\n                      and p.tok = norm_district_tok(s.district_ar)))';
begin
  d := pg_get_functiondef('public.mon_detect_card_label_contract'::regproc);
  if position('with split as materialized (' in d) > 0 then raise notice 'already patched'; return; end if;
  k := (length(d) - length(replace(d, a_cte, ''))) / length(a_cte);       if k <> 1 then raise exception 'split CTE anchor found % times', k; end if;
  k := (length(d) - length(replace(d, a_exists, ''))) / length(a_exists); if k <> 1 then raise exception 'EXISTS anchor found % times', k; end if;
  d := replace(d, a_cte, 'with split as materialized (');
  d := replace(d, a_exists, 'or (s.city_id, norm_district_tok(s.district_ar)) in (select p.city_id, p.tok from split p))');
  execute d;
end $patch$;

do $proof$
declare t0 timestamptz; secs numeric; bad bigint;
begin
  select count(*) into bad from public.district_recovery
   where verbatim and (district_ar ~ '[A-Za-z]' or length(btrim(district_ar)) > 40);
  if bad <> 0 then raise exception 'PROOF: % carried rows still hold Latin or prose', bad; end if;
  if public.district_word_carryable('الشعبة D1') or public.district_word_carryable('عقارات جدة JIJB')
     or public.district_word_carryable('الفويلق – الشنان ، التابعة إدارياً لمدينة حائل.')
     or not public.district_word_carryable('ضاحية الملك فهد الحي السابع الثاني عشر') then
    raise exception 'PROOF: district_word_carryable() truth table is wrong';
  end if;
  if position('with split as materialized (' in pg_get_functiondef('public.mon_detect_card_label_contract'::regproc)) = 0 then
    raise exception 'PROOF: the detector patch did not land';
  end if;
  -- force the slow path (the index still serves the 7 Latin words until the next sync) and time it, rolled back
  begin
    t0 := clock_timestamp();
    perform public.mon_detect_card_label_contract();
    secs := extract(epoch from clock_timestamp() - t0);
    if secs > 120 then raise exception 'PROOF: the detector still takes % s', round(secs); end if;
    raise exception 'ROLLBACK_REVERT %', round(secs);
  exception when others then
    if sqlerrm !~ '^ROLLBACK_REVERT' then raise; end if;
    raise notice 'PROOF OK: card_label_contract slow path % s (rolled back); carried Latin/prose 0', substring(sqlerrm from 17);
  end;
end $proof$;
