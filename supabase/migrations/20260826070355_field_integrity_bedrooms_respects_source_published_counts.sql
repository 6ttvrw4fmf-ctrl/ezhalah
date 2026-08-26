-- Senior Production Engineer, 2026-08-26.
--
-- A MONITOR THAT FIRES ON CORRECT DATA IS ITSELF A DEFECT (AGENT_AUTHORITY.md).
--
-- field_integrity_bedrooms:sanadak_commercial_listings has been P2-open since 2026-08-11 —
-- 15 days — flagging 22 rows as "parse-artifact repair candidates". They are not artifacts.
-- sanadak.sa publishes the number ITSELF, in its own listing title AND its own URL slug:
--
--   title:   «مكتب للإيجار في الرياض الروضة 23000 غرفة 10 حمام»
--   url:     .../مكتب-للإيجار-في-الرياض-الروضة-23000-غرفة-10-حمام-7201073599
--   stored:  bedrooms = 23000
--
-- Measured across every active suspect row on that table: 53/53 corroborated by title AND 53/53
-- by URL. Ezhalah captured the source exactly. Under the owner's absolute rule — never change a
-- real source value because it looks weird — the DATA is right and the BARRIER was wrong.
--
-- THE FIX TEACHES THE BARRIER, IT DOES NOT SILENCE IT. A parse artifact is a number that appears
-- in our column and NOWHERE in the source's own published text; a source-published count appears
-- in both. bedrooms_source_corroborated() draws exactly that line, per row, from captured evidence
-- — not a hand-maintained waiver list that would rot (contrast ops_price_source_verified, which is
-- right for prices because a price is not repeated in the title).
--
-- MEASURED EFFECT, and this is the point — it stays discriminating:
--   sanadak_commercial_listings   22 flagged -> 0   (all source-published; alert clears)
--   wasalt_residential_listings    8 flagged -> 2   (SIX clear, TWO SURVIVE)
-- The two survivors are exactly the shape the barrier exists for, and are left flagged:
--   WST5874630  Villa, 217 m2, bedrooms=700  title "Villa 217 SQM Facing North..." — no bedroom count
--   WST5882708  Villa, 750 m2, bedrooms=74   title "Villa 750 SQM Facing West..."  — no bedroom count
-- Neither is repaired here: proving what wasalt publishes needs its detail page, which is behind
-- the Cloudflare challenge tracked in issue #1019. Honest NULL beats a guess, and so does an
-- honest open flag.
--
-- NEEDLE-EDIT, not a restatement. mon_detect_field_integrity() is a large function covering seven
-- checks over 57 tables; restating it here would risk silently reverting another session's edit to
-- an unrelated check. This reads the LIVE definition and rewrites one predicate, refusing to
-- proceed unless the anchor appears exactly once (same idiom as the detector-roster migrations).

create or replace function public.bedrooms_source_corroborated(
  p_title text, p_url text, p_bedrooms integer)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  -- TRUE when the source's own published text carries this exact bedroom count. Anchored on a
  -- non-digit boundary so 700 is not "corroborated" by a title containing 1700, and matched
  -- case-insensitively for the latin forms (wasalt publishes "Apartment with 29800 Bedrooms").
  select p_bedrooms is not null and (
       coalesce(p_title, '') ~* ('(^|[^0-9])' || p_bedrooms::text || '\s*(غرفة|غرف|bedroom|bedrooms)')
    or coalesce(p_url,   '') ~* ('(^|[^0-9])' || p_bedrooms::text || '[-_ ]*(غرفة|غرف|bedroom|bedrooms)')
  );
$$;

comment on function public.bedrooms_source_corroborated(text, text, integer) is
  'Per-row source corroboration for mon_detect_field_integrity''s bedrooms check (2026-08-26): '
  'true when the source''s own title or URL publishes this exact bedroom count. Distinguishes a '
  'parse artifact from a genuinely odd but source-published value.';

do $mig$
declare
  v_def    text;
  v_anchor text := 'count(*) filter (where active and (bedrooms > 1000'
                || E'\n                                          or (bedrooms > 50 and coalesce(property_type,'''') <> all(%L::text[])))),';
  v_new    text := 'count(*) filter (where active and (bedrooms > 1000'
                || E'\n                                          or (bedrooms > 50 and coalesce(property_type,'''') <> all(%L::text[])))'
                || E'\n                            and not public.bedrooms_source_corroborated(title, listing_url, bedrooms)),';
  v_hits   int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_field_integrity';

  if v_def is null then
    raise exception 'mon_detect_field_integrity() not found — refusing to proceed';
  end if;

  -- Idempotence: if the corroboration guard is already present, this migration is a no-op.
  if position('bedrooms_source_corroborated' in v_def) > 0 then
    raise notice 'bedrooms corroboration already present — no-op';
    return;
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / nullif(length(v_anchor), 0);
  if v_hits <> 1 then
    raise exception 'bedrooms anchor matched % times, expected exactly 1 — refusing to needle-edit', v_hits;
  end if;

  execute replace(v_def, v_anchor, v_new);
end
$mig$;
