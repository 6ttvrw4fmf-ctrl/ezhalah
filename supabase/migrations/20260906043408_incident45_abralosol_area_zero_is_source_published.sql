-- INCIDENT #45 — abralosol area_m2 = 0 is SOURCE-PUBLISHED. Nothing is repaired; the finding is
-- recorded here and barriered by mon_detect_area_contradicts_capture() below.
--
-- WHAT WAS ASKED. Two searchable abralosol rows carry area_m2 = 0 — ABR6396 (id 10301921,
-- https://abralosol.com/6396) and ABR6243 (id 10301955, https://abralosol.com/6243), both
-- Residential Land for sale. The incident recorded the fetch that would have settled it as FAILED
-- (abralosol.com 403s that egress) and correctly refused to touch the rows on an unproven guess.
--
-- WHAT THE EVIDENCE SAYS. No re-fetch was needed. abralosol's own text is already stored on both
-- rows, from two independent places on its own pages:
--     source_capture->'index'->>'area_cell'  =  «المساحة 0م»       (the index table cell)
--     source_capture->'detail_blocks'        ∋  «🟨 المساحة 0 م»   (the detail page block)
-- Both are raw source text: scrapers/abralosol/run.py::_flat() only strips tags and collapses
-- whitespace, so the «0» is abralosol's own character, not ours. _AREA (المساحة\s*([\d,.]+)\s*م)
-- lifts it to area_raw = "0" and normalize.to_int("0") = 0. The stored 0 IS what the source
-- published. The parser is also demonstrably NOT using 0 as a missing-value sentinel: 117 of the
-- 2,667 abralosol rows (103 residential + 14 commercial) publish no area figure at all and are
-- stored NULL.
--
-- WHY THE SOURCE PUBLISHES 0. Both ads are multi-plot bundles — 4 adjoining plots on one deed set
-- («أرض انصاف اراضي متجاورات») and 12 plots respectively — so the seller left the single area field
-- at 0 and wrote the per-plot areas into the description (219.69 / 215.33 …, and 306.78 / 250×9 /
-- 263 / 304.60). Weird does not mean wrong.
--
-- THEREFORE NOTHING IS CHANGED, and specifically none of these is permitted:
--   * 0 -> NULL. That erases a value the source did publish (SOURCE IS TRUTH runs both ways: silent
--     becomes NULL, but published becomes stored — including a published zero).
--   * summing the description's per-plot figures into an area. 866 m2 / 3,124 m2 would be OUR
--     arithmetic over prose, i.e. a fabricated size on a searchable card.
--   * deactivating the rows. A surprising value is not a dead listing (UNKNOWN IS NOT DEAD).
--
-- NO DOWNSTREAM HARM, checked rather than assumed. search_listings_ar.price_total_effective refuses
-- to derive a total from a zero area (its `area_m2 > 0` guard, migration 20260903230451), so these
-- two rows carry price_total_effective = NULL and no 0-SAR total exists anywhere. Every client
-- consumer already gates on `area > 0` (src/components/ResultCard.tsx:294, src/data/search.ts area
-- filter / ppm / relevance), so nothing renders «0 م²» and no area filter matches them.
--
-- THE BARRIER, AND WHY IT IS AN INVARIANT AND NOT AN ALLOWLIST. An allowlist of these two ids would
-- pin the SYMPTOM, protect nothing else, and go stale the moment abralosol edits either ad.
-- mon_detect_area_contradicts_capture() instead asserts the RULE — the area we serve is the area the
-- source published — over every abralosol row, in BOTH directions:
--     fabricated  the capture holds no area figure, but we store one    (unknown -> a value)
--     erased      the capture holds an area figure, but we store NULL   (published -> unknown; this
--                 is the clause that fires if anyone "repairs" these two rows to NULL)
--     rewritten   we store a different number than the source published (e.g. a summed area)
-- Measured over all of production before shipping: area_raw NULL <=> area_m2 NULL with zero
-- exceptions in either direction, and area_m2 = the integer part of area_raw on all 2,550 rows that
-- have one (389 carry a decimal, none carries 3+ decimal digits or a second dot, so the integer part
-- is exactly what to_int() produces). The detector is green on arrival, and green because the
-- invariant holds — not because it was fitted to the current data.

create or replace function public.mon_detect_area_contradicts_capture()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n    int := 0;
  live text[] := '{}';
  r    record;
begin
  for r in
    with captured as (
      select 'abralosol_residential_listings'::text as tbl, id, area_m2,
             source_capture->>'area_raw' as raw
        from public.abralosol_residential_listings
      union all
      select 'abralosol_commercial_listings', id, area_m2,
             source_capture->>'area_raw'
        from public.abralosol_commercial_listings
    ),
    judged as (
      -- The published figure, as an integer, WITHOUT ever raising: commas are thousands separators,
      -- anything after the first '.' is the fraction to_int() truncates, and any residual non-digit
      -- collapses to NULL rather than a cast error (a detector that crashes protects nothing).
      select tbl, id, area_m2, raw,
             nullif(regexp_replace(split_part(replace(raw, ',', ''), '.', 1), '[^0-9]', '', 'g'), '')::bigint
               as published
        from captured
    ),
    bad as (
      select tbl, id, area_m2, raw, published,
             case
               when raw is null     and area_m2 is not null then 'fabricated'
               when raw is not null and area_m2 is null     then 'erased'
               when raw is not null and area_m2 is distinct from published then 'rewritten'
             end as kind
        from judged
    )
    select tbl,
           count(*)                                    as bad_rows,
           count(*) filter (where kind = 'fabricated') as fabricated,
           count(*) filter (where kind = 'erased')     as erased,
           count(*) filter (where kind = 'rewritten')  as rewritten,
           (array_agg(id order by id))[1:20]           as sample_ids
      from bad
     where kind is not null
     group by tbl
  loop
    live := live || ('area_contradicts_capture:' || r.tbl);
    n := n + public.mon_raise('P1', 'area_contradicts_capture',
      regexp_replace(r.tbl, '_(residential|commercial)_listings$', ''),
      'area_contradicts_capture:' || r.tbl,
      jsonb_build_object(
        'source_table', r.tbl,
        'bad_rows', r.bad_rows,
        'fabricated', r.fabricated,
        'erased', r.erased,
        'rewritten', r.rewritten,
        'sample_listing_ids', to_jsonb(r.sample_ids),
        'why', 'The area served for these rows is not the area the source published, judged '
            || 'against the raw source text this row already carries in source_capture->>''area_raw''. '
            || 'fabricated = we invented an area the source never stated. erased = the source stated '
            || 'an area and we now store NULL. rewritten = we store a different number. All three '
            || 'break SOURCE IS TRUTH.',
        'action', 'Do NOT make this green by editing the listing. Read source_capture on the named '
            || 'rows first. If the served value drifted from the capture, the WRITER changed - find '
            || 'it. Incident #45: abralosol publishes «المساحة 0 م» on ids 10301921 and 10301955 '
            || '(multi-plot bundle ads), so area_m2 = 0 is CORRECT there and must be preserved; '
            || 'nulling it, or summing the per-plot areas out of the description, is the regression '
            || 'this detector exists to catch.'));
  end loop;

  perform public.mon_resolve_stale_keys('area_contradicts_capture', live);
  return n;
end
$fn$;

comment on function public.mon_detect_area_contradicts_capture() is
  'Incident #45. The area we serve must equal the area the source published, for every abralosol '
  'row, in both directions: a captured figure may not be erased to NULL (which is what "repairing" '
  'a source-published 0 would do), silence may not become a number, and a captured figure may not '
  'be rewritten. Judged against source_capture->>''area_raw'', the raw text the scraper stored, so '
  'the check needs no allowlist and stays true when the ads change. Scope is abralosol because '
  'area_raw is abralosol''s capture key; extending it to another platform means naming that '
  'platform''s own captured-area key, never guessing one.';

-- ── roster ──────────────────────────────────────────────────────────────────────────────────────
-- A detector outside mon_run_all_detectors() is decoration, and mon_detect_orphaned_detectors()
-- fires on it (AGENTS.md). Needle edit rather than pasting the body back: five routines append to
-- this one array, and a wholesale CREATE OR REPLACE built from a body read minutes earlier would
-- silently drop a concurrent session's detector. Same shape as migration 20260904144346, including
-- its attribute set — the live function is SECURITY INVOKER with no search_path, and this migration
-- deliberately preserves that rather than changing security posture as a side effect of a roster
-- append.
--
-- THE ANCHOR IS THE ARRAY TERMINATOR, NOT THE LAST DETECTOR'S NAME. 20260904144346 anchored on the
-- name then sitting last, and this migration's first apply attempt did the same and was REFUSED —
-- routine #11 had appended four lifecycle detectors in the minutes between reading the body and
-- applying. The guard worked; the anchor was the problem. Anchoring on `\n  ];` survives any
-- concurrent append, and requiring it to occur EXACTLY ONCE keeps it failing closed if the
-- function's shape ever changes. Fails closed four ways: exactly one anchor, the name must be
-- absent before and present after, and the roster must grow by exactly one.
do $mig$
declare
  v_src        text;
  v_new        text;
  v_anchor     text := E'\n  ];';
  v_replace    text := ',' || E'\n' || '    ''mon_detect_area_contradicts_capture''' || E'\n  ];';
  v_hits       int;
  v_before_cnt int;
  v_after_cnt  int;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_src is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to guess';
  end if;

  if position('mon_detect_area_contradicts_capture' in v_src) > 0 then
    raise notice 'already on the roster; nothing to do';
    return;
  end if;

  v_hits := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'expected exactly ONE roster terminator, found % -- the function changed shape. '
                    'Re-derive the anchor from pg_proc.prosrc rather than forcing this edit.', v_hits;
  end if;

  v_before_cnt := (length(v_src) - length(replace(v_src, 'mon_detect_', ''))) / length('mon_detect_');

  v_new := replace(v_src, v_anchor, v_replace);

  execute format(
    'create or replace function public.mon_run_all_detectors() returns jsonb language plpgsql as %L',
    v_new);

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  v_after_cnt := (length(v_src) - length(replace(v_src, 'mon_detect_', ''))) / length('mon_detect_');

  if position('mon_detect_area_contradicts_capture' in v_src) = 0 then
    raise exception 'post-edit verification failed: the new detector is not on the roster';
  end if;
  if v_after_cnt <> v_before_cnt + 1 then
    raise exception 'roster changed by % entries, expected exactly 1 -- possible clobber of a concurrent append',
                    v_after_cnt - v_before_cnt;
  end if;

  raise notice 'roster grew % -> %', v_before_cnt, v_after_cnt;
end $mig$;
