-- An evidence-gated exception for a detector finding that is TRUE but has no available remedy.
--
-- sadin put its full property details behind a lead-capture wall (observed live 2026-09-03, crawls
-- 33773123528 / 33776005183: the «وصف العقار» label is ABSENT, the page carries
-- `detail-card property-details-locked` reading «تفاصيل العقار الكاملة محمية … أدخل اسمك ورقم
-- جوالك», and «ريال» appears ZERO times with no ld+json and no __NEXT_DATA__). sadin's price has
-- always lived only in that description prose. So there is no figure to capture, honest NULL is
-- correct, and detail_capture_collapse can never go green for those two tables — production cannot
-- "prove recovery" for a field the source stopped publishing.
--
-- Leaving a P1 red forever is the stuck-alert pathology §23a/§25a exist to prevent: mon_raise()
-- returns 0 for an already-open dedup key, so a stuck key makes a genuine RE-OCCURRENCE unpageable.
-- But the cure is a DISPOSITION, never a silenced barrier (§G.7). So:
--
--   * the exception is per (source_table), never global — every other platform is unaffected and
--     the detector's thresholds are untouched;
--   * it requires real recorded evidence (>= 80 chars) plus a probe reference, the
--     ops_price_source_verified discipline, so it cannot be granted on a hunch;
--   * it EXPIRES BY ITSELF the moment the source starts publishing again, and the detector then
--     both raises normally AND raises a distinct P1 saying the waiver is stale. It cannot outlive
--     its evidence.
create table if not exists public.ops_source_withheld_field (
  source_table    text primary key,
  fields          text[] not null check (cardinality(fields) > 0),
  evidence        text   not null check (length(evidence) >= 80),
  probe_reference text   not null check (length(probe_reference) >= 8),
  observed_at     timestamptz not null,
  recorded_at     timestamptz not null default now()
);

comment on table public.ops_source_withheld_field is
'Evidence-gated exceptions for detail_capture_collapse: a platform whose SOURCE has stopped '
'publishing a field to anonymous visitors, so the missing value is source truth and not an Ezhalah '
'defect. Never a global silence — scoped to one source_table, requires recorded evidence and a probe '
'reference, and is automatically invalidated the moment the source publishes the field again (see '
'mon_detect_detail_capture_collapse: a waiver whose source has resumed raises source_withhold_waiver_stale).';

create or replace function public.mon_detect_detail_capture_collapse()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  w record;
  n int := 0;
  live_keys text[] := '{}';
  stale_keys text[] := '{}';
  v_fresh bigint; v_lost bigint; v_ever_desc bigint; v_ever_price bigint;
  v_resumed bigint;
  k text;
  has_title boolean; has_scraped boolean; has_cap boolean;
begin
  for r in
    select c.table_name tn
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name = 'description'
       and c.table_name like '%\_listings'
       and exists (select 1 from information_schema.columns d
                    where d.table_schema='public' and d.table_name=c.table_name and d.column_name='price_total')
       and exists (select 1 from information_schema.columns d
                    where d.table_schema='public' and d.table_name=c.table_name and d.column_name='price_annual')
       and exists (select 1 from information_schema.columns d
                    where d.table_schema='public' and d.table_name=c.table_name and d.column_name='last_seen_at')
     order by c.table_name
  loop
    execute format($f$select
        count(*) filter (where active and last_seen_at > now() - interval '3 days'),
        count(*) filter (where active and last_seen_at > now() - interval '3 days'
                           and description is null and price_total is null and price_annual is null),
        count(*) filter (where description is not null),
        count(*) filter (where price_total is not null or price_annual is not null)
      from public.%I$f$, r.tn)
      into v_fresh, v_lost, v_ever_desc, v_ever_price;

    if v_fresh >= 10 and v_ever_desc >= 5 and v_ever_price >= 3
       and v_lost::numeric / v_fresh >= 0.8 then

      -- Is this table covered by an evidence-gated source exception that is STILL VALID?
      -- public.source_withheld_still_holds() fails closed: if it cannot evaluate the question it
      -- returns false, so the barrier keeps alerting rather than going quiet on an unprovable waiver.
      if public.source_withheld_still_holds(r.tn) then
        continue;   -- key deliberately omitted from live_keys, so any open alert RESOLVES below
      end if;

      k := 'detail_capture_collapse:' || r.tn;
      live_keys := live_keys || k;
      n := n + public.mon_raise('P1', 'detail_capture_collapse', r.tn, k,
        jsonb_build_object(
          'table', r.tn,
          'fresh_rows', v_fresh,
          'fresh_rows_with_neither_price_nor_description', v_lost,
          'frac', round((v_lost::numeric / greatest(v_fresh,1)), 3),
          'ever_captured_description', v_ever_desc,
          'ever_captured_price', v_ever_price,
          'why', 'Rows crawled in the last 3 days carry NEITHER a price NOR a description, while '
              || 'this table''s own history proves it captured both. The crawl is still reaching the '
              || 'platform (the rows are fresh and active) so every count/liveness barrier stays '
              || 'green — the loss is in the DETAIL parse, and users are served price-less cards.',
          'adjudicate', 'Find the field the detail parser reads and check whether the source redesigned '
              || 'its markup. Confirm the fetch itself still works before blaming the fetch: a '
              || 'structured field that IS still populated (e.g. area from a dt/dd pair) proves the '
              || 'page is reachable and parsed. If the field is not on the page AT ALL — observe it, '
              || 'do not infer it — the source may have stopped publishing it, which is a source '
              || 'limitation recorded in ops_source_withheld_field, NOT a parser fix. Do NOT backfill '
              || 'a price from prose, cache or arithmetic to clear this (§21/§22).'));
    end if;
  end loop;

  -- Every recorded waiver is re-checked EVERY sweep, independently of whether the cohort above
  -- still trips. That is the limb that makes the exception self-expiring: if the source resumes
  -- publishing, the cohort stops tripping and nobody would otherwise ever look at the waiver again,
  -- leaving dead config that would silence a FUTURE genuine parser regression on this platform.
  for w in select source_table from public.ops_source_withheld_field order by source_table
  loop
    if to_regclass('public.' || quote_ident(w.source_table)) is null then
      continue;
    end if;
    if not public.source_withheld_still_holds(w.source_table) then
      k := 'source_withhold_waiver_stale:' || w.source_table;
      stale_keys := stale_keys || k;
      n := n + public.mon_raise('P1', 'source_withhold_waiver_stale', w.source_table, k,
        jsonb_build_object(
          'table', w.source_table,
          'why', 'This table holds an evidence-gated exception in ops_source_withheld_field saying '
              || 'its SOURCE stopped publishing the description/price — but the source is publishing '
              || 'them again, or the waiver can no longer be evaluated. Either way the exception no '
              || 'longer describes reality, and while it stands it would suppress a genuine parser '
              || 'regression on this platform.',
          'adjudicate', 'Confirm from the rows: a capture whose source_text differs from the title '
              || 'means a crawl actually READ a description, and a row first seen after observed_at '
              || 'carrying a price cannot have retained an old value. If the source has genuinely '
              || 'resumed, DELETE the ops_source_withheld_field row — the detector then guards this '
              || 'platform normally again. Never extend observed_at to keep the waiver alive.'));
    end if;
  end loop;

  -- Resolve on the EVALUATED path, from the keys THIS run re-affirmed (§25a). A table whose waiver
  -- now holds is absent from live_keys, so its open alert resolves here — by evidence, not silence.
  perform public.mon_resolve_stale_keys('detail_capture_collapse', live_keys);
  perform public.mon_resolve_stale_keys('source_withhold_waiver_stale', stale_keys);
  return n;
end
$function$;

-- Does the recorded source exception for this table STILL describe reality?
-- Fails closed: any table it cannot evaluate returns false, so the barrier keeps alerting.
create or replace function public.source_withheld_still_holds(p_table text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  w record;
  v_resumed bigint;
  has_title boolean; has_scraped boolean; has_cap boolean;
begin
  select * into w from public.ops_source_withheld_field where source_table = p_table;
  if not found then
    return false;                       -- no waiver: the detector behaves exactly as before
  end if;
  if to_regclass('public.' || quote_ident(p_table)) is null then
    return false;
  end if;

  select
    bool_or(column_name = 'title'),
    bool_or(column_name = 'scraped_at'),
    bool_or(column_name = 'source_capture')
    into has_title, has_scraped, has_cap
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table;

  -- Both resumption limbs read only data we already hold; SQL cannot fetch a page (§26).
  --  A. source_capture.source_text is rebuilt from the CURRENT payload on every upsert
  --     (`description or title` in db._ensure_capture), so source_text <> title proves the latest
  --     crawl actually READ a description. A value merely RETAINED by known-over-unknown does not
  --     trip it — which is exactly why the one legacy sadin row does not make the waiver stale.
  --  B. a row FIRST SEEN after observed_at carrying a price cannot have retained anything.
  -- If neither limb can be evaluated we cannot prove the waiver still holds, so we fail closed.
  if not (coalesce(has_title,false) and coalesce(has_cap,false)) and not coalesce(has_scraped,false) then
    return false;
  end if;

  execute format($f$select count(*) from public.%I where active and ( %s )$f$, p_table,
      concat_ws(' or ',
        case when coalesce(has_title,false) and coalesce(has_cap,false)
             then format('(last_seen_at > %L and source_capture->>''source_text'' is distinct from title)', w.observed_at)
        end,
        case when coalesce(has_scraped,false)
             then format('(scraped_at > %L and (price_total is not null or price_annual is not null))', w.observed_at)
        end))
    into v_resumed;

  return v_resumed = 0;                 -- still withheld ⇒ the exception holds
end
$function$;

comment on function public.source_withheld_still_holds(text) is
'True only while a recorded ops_source_withheld_field exception STILL describes reality: no crawl '
'since observed_at has read a description (source_capture.source_text <> title, which a merely '
'RETAINED value cannot trip) and no row first seen since observed_at carries a price. Fails closed — '
'no waiver, missing table, or unevaluable columns all return false, so the barrier keeps alerting.';

insert into public.ops_source_withheld_field (source_table, fields, evidence, probe_reference, observed_at)
values
 ('sadin_residential_listings', array['description','price_total','price_annual'],
  'sadin gated its full property details behind a lead-capture wall. Observed live 2026-09-03 from the crawler (the audit container''s egress policy 403s sadin.com.sa, so this was observed where the source IS reachable), identical on both sampled ads: the label «وصف العقار» is ABSENT from the page; the page carries `detail-card property-details-locked` whose text reads «تفاصيل العقار الكاملة محمية — دعنا نتواصل معك. أدخل اسمك ورقم جوالك مرة واحدة، وسيسجل فريق سدين طلبك…»; page signals {«السعر»:7, «ريال»:0, «سعر»:7, ld+json:0, __NEXT_DATA__:0, login_prompt:1}. «ريال» appears ZERO times and there is no JSON payload, so no figure exists in what the source hands an anonymous visitor. sadin''s price has ALWAYS lived only in description prose (its price field publishes «السعر عند الطلب» — the standing declared exception in scripts/verify-no-derived-price.ts), so a gate over the description is a gate over the price. The public dt block still carries الغرض/نوع العقار/المساحة, which is exactly the set that still parses: 85/85 active rows have area and type. Honest NULL is correct; recovering the figure would require submitting a name and phone number to defeat an access control, which is forbidden. Verdict: docs/ops/DATA_INTEGRITY_ENGINEER.md §29.',
  'github-actions runs 33773123528 and 33776005183 (scrapers/sadin _report_description_miss)',
  '2026-09-03T16:02:00Z'),
 ('sadin_commercial_listings', array['description','price_total','price_annual'],
  'Same source gate as sadin_residential_listings, same crawl and same evidence — sadin serves one detail page shape for both verticals and run_commercial shares the enricher, so the lead-capture wall covers both tables. Observed live 2026-09-03: «وصف العقار» ABSENT, `detail-card property-details-locked` reading «تفاصيل العقار الكاملة محمية … أدخل اسمك ورقم جوالك مرة واحدة», page signals {«ريال»:0, ld+json:0, __NEXT_DATA__:0, login_prompt:1}. All 10 active commercial rows keep area and type (10/10) and lose only the gated fields. Honest NULL is correct. Verdict: docs/ops/DATA_INTEGRITY_ENGINEER.md §29.',
  'github-actions runs 33773123528 and 33776005183 (scrapers/sadin _report_description_miss)',
  '2026-09-03T16:02:00Z')
on conflict (source_table) do nothing;