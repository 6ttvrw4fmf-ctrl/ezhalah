-- type_ar canonicalization: purge non-type leaks and unify duplicate spellings
-- (daily-audit 2026-07-27, owner-instructed).
--
-- FOUND LIVE (20 rows total across 47 distinct type_ar values):
--   'إيجار' ×4 (eastabha)            — a DEAL word stored as a property type (the scraper's raw
--                                      category was purely deal/status words; its fallback dressed
--                                      the deal word up as a type — scraper fix ships in the same
--                                      PR, this migration heals the stored rows)
--   'الدخول أو إنشاء حساب' ×1 (sadin) — a LOGIN-WALL page title captured as a type (same PR fixes
--                                      the scraper to skip that page entirely)
--   'إستراحة' ×11 (aqarcity)          — hamza-spelling duplicate of استراحة (3,018 rows): the
--                                      استراحة filter button literal-matches type_ar, so these 11
--                                      were UNREACHABLE by the filter they belong to
--   'ستوديو' ×2 (dealapp)             — spelling duplicate of استوديو (22 rows), same unreachability
--   'محطة بنزين' ×2 (dealapp)         — synonym duplicate of محطة وقود (119 rows)
--   'محطة' ×2 (aldarim)               — bare "station", same bucket as محطة وقود (owner-directed)
--
-- WHERE THE FIX LIVES: sync_search_listings_ar copies raw Arabic property_type into type_ar with
-- only NFC normalization, and re-upserts on every raw churn — so fixing rows in search_listings_ar
-- alone would revert on the next sync. canon_type_ar() is applied INSIDE the sync's type_ar
-- expression (durable for all future syncs) plus a one-time backfill of the existing rows below.
-- RAW platform tables are NOT rewritten (capture fidelity — raw stores what the source published;
-- canonicalization happens at the ingest boundary, the same place the en→ar type_label_ar mapping
-- already lives). Deal words map to 'غير معروف' — never guess a real type from zero signal; these
-- rows drop out of the renderable-card set (the type gate) instead of showing a fake type.
--
-- The sync edit is a GUARDED IN-PLACE REPLACEMENT (assert needle occurs exactly once, RAISE
-- otherwise): sync's last repo issue (20260717_price_fidelity_guarantee.sql) predates later live
-- changes, so a full-body paste from repo would silently revert them (PR#120 failure mode).

-- ── 1. The canonical mapping, one place ─────────────────────────────────────────────────────────
create or replace function public.canon_type_ar(t text)
returns text
language sql
immutable
parallel safe
as $$
  select case t
    -- spelling / synonym duplicates → the canonical spelling the filter buttons use
    when 'إستراحة'    then 'استراحة'
    when 'ستوديو'     then 'استوديو'
    when 'محطة بنزين' then 'محطة وقود'
    when 'محطة'       then 'محطة وقود'
    -- deal/status words and captured UI text are NOT property types — never dress them up as one
    when 'إيجار'  then 'غير معروف'
    when 'بيع'    then 'غير معروف'
    when 'للإيجار' then 'غير معروف'
    when 'للبيع'  then 'غير معروف'
    when 'الدخول أو إنشاء حساب' then 'غير معروف'
    else t
  end;
$$;

comment on function public.canon_type_ar(text) is
  'Arabic clean-type canonicalizer applied at the sync ingest boundary (sync_search_listings_ar) and in one-time backfills. Maps duplicate spellings to the filter-canonical form and deal-words/UI-text leaks to غير معروف. Extend HERE when a new duplicate spelling appears — never with per-row UPDATEs alone (sync re-upserts on raw churn and would revert them).';

-- ── 2. Apply it inside sync_search_listings_ar's type_ar expression ─────────────────────────────
do $$
declare
  v_def text;
  v_n1 int; v_n2 int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'sync_search_listings_ar';

  if v_def is null then
    raise exception 'sync_search_listings_ar not found';
  end if;
  if position('canon_type_ar' in v_def) > 0 then
    raise notice 'canon_type_ar already wired into sync — skipping (idempotent re-run)';
    return;
  end if;

  v_n1 := (length(v_def) - length(replace(v_def, 'normalize(case', ''))) / length('normalize(case');
  v_n2 := (length(v_def) - length(replace(v_def, 'end, NFC)', ''))) / length('end, NFC)');
  if v_n1 <> 1 or v_n2 <> 1 then
    raise exception 'sync type_ar expression needles found %/% times (expected 1/1) — function drifted, refusing blind edit', v_n1, v_n2;
  end if;

  v_def := replace(v_def, 'normalize(case', 'canon_type_ar(normalize(case');
  v_def := replace(v_def, 'end, NFC)', 'end, NFC))');
  execute v_def;
end $$;

-- ── 3. One-time backfill of the rows already stored ─────────────────────────────────────────────
-- Self-describing predicate: touches exactly the rows the canonicalizer would change (20 live as
-- of 2026-07-27). Idempotent.
update public.search_listings_ar
set type_ar = canon_type_ar(type_ar)
where type_ar is not null
  and type_ar <> canon_type_ar(type_ar);
