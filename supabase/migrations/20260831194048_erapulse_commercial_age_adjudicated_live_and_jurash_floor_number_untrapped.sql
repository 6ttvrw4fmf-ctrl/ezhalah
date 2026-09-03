-- Two source-truth items the 2026-08-31 Part 4 sweep left open, now closed with real evidence.
-- Owner approved acting on both (2026-08-31).
--
-- ── 1. erapulse_commercial_listings: age adjudicated against the LIVE source ──────────────────
-- mon_detect_age_resolver_platform_gap (20260831114938) flagged this table as withheld by SILENCE:
-- served, publishing a plausible property_age, and absent from age_source_registry entirely.
-- AGENTS.md permanent rule #2 forbids resolving that from absence of evidence, so it was probed.
--
-- LIVE PROBE, 2026-08-31, listing 648093
-- https://erapulse.sa/property/buraydah-commercial-rent-ref-mke92y15-ckgxj (301 -> the Arabic
-- canonical URL, HTTP 200, 213,754 bytes). The detail page renders age in its OWN structured stat
-- block, beside area, not in prose:
--     «١٤٤ المساحة (م²)   1 العمر (سنة)»
-- and the underlying payload carries "age":1. Our stored property_age = 1 matches exactly.
--
-- This independently re-confirms, for the COMMERCIAL half, the same «العمر (سنة)» stat block that
-- the 2026-07-29 spot-check already cleared for erapulse_residential_listings (3/3 rows). Same
-- site, same field, same block -- so the semantics are established, not assumed.
--
-- NOTE THIS CHANGES NOTHING SERVED TODAY, deliberately. age_source_health() scores this table
-- verdict = 'too_small' (n_aged = 1), and rebuild_age_producer() admits canonical_column sources
-- only at verdict = 'ok'. The registry row records the ADJUDICATION; the health gate keeps deciding
-- ADMISSION on its own. If the table grows past the threshold the age is admitted automatically,
-- on semantics already proven, instead of waiting to be rediscovered.

begin;

insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at, jsonb_key)
values (
  'erapulse_commercial_listings', 'canonical_column', true,
  'TRUSTED 2026-08-31 (routine #5): live probe of listing 648093 '
  || 'https://erapulse.sa/property/buraydah-commercial-rent-ref-mke92y15-ckgxj -- the detail page '
  || 'publishes «العمر (سنة)» as a structured stat beside «المساحة (م²)» (payload "age":1) and our '
  || 'stored property_age = 1 matches exactly. Re-confirms for the commercial half the same stat '
  || 'block cleared for erapulse_residential on 2026-07-29. Still withheld by age_source_health() '
  || 'verdict=too_small (n_aged=1) -- registered so admission is automatic once it grows, and so '
  || 'mon_detect_age_resolver_platform_gap stops reading a decided source as undecided.',
  now(), null
);

-- The registry row must not change what is served while the health gate still withholds it.
do $chk$
declare tabs int; has_it boolean;
begin
  perform public.rebuild_age_producer();
  select count(distinct source_table) into tabs from public.listing_age_resolved;
  select position('erapulse_commercial_listings' in
                  pg_get_viewdef('public.listing_age_resolved'::regclass, true)) > 0 into has_it;
  if has_it then
    raise exception 'erapulse_commercial entered the age view despite verdict too_small -- the health gate did not hold';
  end if;
  if tabs <> 18 then
    raise exception 'age view source_table count moved to % (expected 18, unchanged)', tabs;
  end if;
end
$chk$;

-- ── 2. jurash floor_number: a source-published value trapped in additional_info ────────────────
-- jurash publishes `pt_floor` as a native field in its own server-side property-record dump, and
-- scrapers/jurash/run.py captures it verbatim (`floor_no = _to_int(f.get("pt_floor"))` ->
-- additional_info.floor_number). Real per-listing variance in production: 2, 2, 3, 3.
--
-- But listing_extra_attrs hard-codes `NULL::integer AS floor_number` for both jurash branches, so
-- the captured value never reaches the search index -- "trapping" under
-- docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md §1, the same shape the age sweep hunted.
--
-- Unlike listing_age_resolved, listing_extra_attrs has NO generator: the only rebuild_* functions
-- in the database are rebuild_af_filter_rpcs and rebuild_age_producer, and neither builds it. That
-- was checked FIRST this time -- editing a generated view directly is what went wrong earlier
-- today (see 20260831114938). Editing this one directly is correct.
--
-- The replacement uses the view's OWN established idiom for JSON-sourced floor numbers (a regex
-- guard before the cast, ELSE NULL) rather than a new one, so a malformed value stays an honest
-- unknown instead of becoming a fabricated 0.
do $mig$
declare
  cur text; parts text[]; i int; changed int := 0; newdef text;
  tgt text := 'NULL::integer AS floor_number';
  repl text := E'CASE\n            WHEN (x.additional_info ->> ''floor_number''::text) ~ ''^[0-9]{1,2}$''::text THEN (x.additional_info ->> ''floor_number''::text)::integer\n            ELSE NULL::integer\n        END AS floor_number';
  before_rows bigint; after_rows bigint; before_fn bigint; after_fn bigint; jur bigint;
begin
  select count(*), count(floor_number) into before_rows, before_fn from public.listing_extra_attrs;

  cur := pg_get_viewdef('public.listing_extra_attrs'::regclass, true);
  parts := string_to_array(cur, E'UNION ALL');

  -- Scoped to the two jurash branches only; every other branch is preserved byte-exactly.
  for i in 1 .. array_length(parts, 1) loop
    if (parts[i] like '%FROM jurash_residential_listings%' or parts[i] like '%FROM jurash_commercial_listings%')
       and position(tgt in parts[i]) > 0 then
      parts[i] := replace(parts[i], tgt, repl);
      changed := changed + 1;
    end if;
  end loop;

  if changed <> 2 then
    raise exception 'expected exactly 2 jurash branches to change, changed %', changed;
  end if;

  newdef := rtrim(array_to_string(parts, 'UNION ALL'), E' \n\t;');
  execute 'create or replace view public.listing_extra_attrs as ' || newdef;

  select count(*), count(floor_number) into after_rows, after_fn from public.listing_extra_attrs;
  select count(floor_number) into jur from public.listing_extra_attrs where source_table like 'jurash%';

  -- Fail closed on anything but the exact intended change.
  if after_rows <> before_rows then
    raise exception 'row count moved % -> %', before_rows, after_rows;
  end if;
  if after_fn - before_fn <> 4 then
    raise exception 'floor_number gained % values, expected exactly 4', after_fn - before_fn;
  end if;
  if jur <> 4 then
    raise exception 'jurash floor_number rows = %, expected 4', jur;
  end if;

  raise notice 'listing_extra_attrs: floor_number % -> % (+4, all jurash), rows unchanged at %',
    before_fn, after_fn, after_rows;
end
$mig$;

commit;
