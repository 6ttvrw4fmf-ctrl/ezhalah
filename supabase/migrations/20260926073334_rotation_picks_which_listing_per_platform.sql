-- ROTATION NOW DECIDES *WHICH* LISTING REPRESENTS EACH PLATFORM, NOT JUST THE PLATFORM ORDER.
-- Owner rule 2026-09-26: "I do a search, it shows عقار first. I refresh — the same exact one
-- shouldn't show عقار first. It changes and shows another website." And: "عقار has so much in our
-- database. Don't always show me the exact one."
--
-- WHAT WAS ACTUALLY WRONG. Controlled rotation has existed since 2026-08-29 (tier 4) and could
-- never satisfy either half of that. The served ORDER BY is
--   div_rank -> photo_rank -> rot_key -> recency, source_table, listing_id
-- and `div_rank` is a per-platform row_number() ordered by (photo tier, recency DESC, source_table,
-- listing_id) — FULLY DETERMINISTIC. So a platform's slot-1 row is always its newest photo-having
-- listing, forever. `rot_key` sits BELOW div_rank, so it can only reorder rows already tied on
-- div_rank: it shuffles WHICH PLATFORM leads, never WHICH LISTING represents that platform. On top
-- of that the client seed was hash(device + ISO week), so even the platform order only re-rolled
-- once a week — which is why a refresh looked frozen. Measured against production the day this
-- shipped: 0% of 52 platforms changed their front listing between two different seeds.
--
-- THE FIX, one term. Inside div_rank's OWN per-platform window, between the photo tier and recency:
--   case when p_rotation_seed is not null
--        then hashtext(m.source_table || ':' || m.listing_id::text || ':' || p_rotation_seed)
--   end asc nulls last
-- Now each platform's slot-1/2/3 picks vary with the seed, so a different house from عقار's whole
-- eligible pool fronts each search, and the platform order varies with it.
--
-- WHAT IS PRESERVED, BY CONSTRUCTION (not by promise):
--   · PHOTO PREFERENCE still ranks FIRST inside the window — the exact 2026-08-29 bug (a
--     most-recent-but-no-photo row outranking the same platform's real-photo row) cannot come back.
--   · PLATFORM DIVERSITY unchanged — still one row per platform per round; a platform with 1
--     eligible listing contributes exactly 1 and the larger ones continue (owner, same day).
--   · ELIGIBILITY / total_count untouched — the `matched` CTE is not edited; this only reorders
--     row_number() WITHIN a platform. Rehearsed live: 55,858 = 55,858 across two different seeds.
--   · PAGINATION stays gap-free and duplicate-free — the key chain still ends in the unconditional
--     (source_table, listing_id) total order, and one seed is held for a whole browse walk.
--   · OBJECTIVE SORTS untouched — the whole row_number() is already wrapped in the
--     price_asc/price_desc/area_*/beds_desc/oldest CASE, so those keep exact semantics.
--   · NO SEED -> today's exact behaviour (every row NULL, ties fall through to recency), so every
--     caller that passes no seed is 100% backward compatible.
--
-- WHY THE TEMPLATE ROUTE AND NOT A HAND EDIT. rebuild_af_filter_rpcs() DROPS EVERY OVERLOAD and
-- re-creates each function from af_rpc_templates. A hand edit to the live function would (a) be
-- reverted by the next rebuild and (b) leave the P1 af_parity_hand_edit alert open — exactly what
-- happened on 2026-08-29 and had to be repaired by 20260830134244. So the TEMPLATE is edited and
-- the sanctioned rebuild does the DDL, which also updates af_rpc_build_state itself, keeping
-- live == built == template by construction. af_rebuild_would_revert() is asserted empty FIRST, so
-- a rebuild can never silently drop semantics some other function carries.
--
-- FAIL-CLOSED. Every precondition and postcondition below raises, and DDL is transactional in
-- Postgres, so this migration can only fully succeed or change nothing at all. Rehearsed in full
-- against production inside a rolled-back transaction before being written: 6 functions rebuilt,
-- 1 overload, template/live parity byte-for-byte, photo ranked before rotation, identical totals,
-- different listings AND different platform order across two seeds, and no measurable slowdown
-- (403ms before / 381ms after on الرياض/بيع, 55,858 matched rows, p_limit 1500).

do $rot$
declare
  hits int;
  n_overload int;
  v_bad text;
  live_def text;
  built text;
  needle constant text := 'order by \(case when m\.has_photo is true then 0 when m\.has_photo is null then 1 else 2 end\) asc,\s+m\.recency_at desc nulls last, m\.source_table, m\.listing_id';
  repl constant text := $r$order by (case when m.has_photo is true then 0 when m.has_photo is null then 1 else 2 end) asc,
                                    case when p_rotation_seed is not null
                                         then hashtext(m.source_table || ':' || m.listing_id::text || ':' || p_rotation_seed)
                                    end asc nulls last,
                                    m.recency_at desc nulls last, m.source_table, m.listing_id$r$;
begin
  -- PRE 1: a rebuild must not be capable of dropping anything the live functions carry.
  select string_agg(w.o_fn_name, ', ') into v_bad from public.af_rebuild_would_revert() w;
  if v_bad is not null then
    raise exception 'refusing: a rebuild would revert semantics on [%] — reconcile those templates first', v_bad;
  end if;

  -- PRE 2: the needle must identify EXACTLY ONE site in the template (the div_rank window of the
  -- p_per_platform-is-null branch, which is the branch the served search uses). The second
  -- `partition by m.platform` window in this function is the p_per_platform path and is untouched.
  select count(*) into hits from regexp_matches(
    (select template from public.af_rpc_templates where fn_name = 'location_search_candidates_ar'),
    needle, 'g');
  if hits <> 1 then
    raise exception 'refusing: expected exactly 1 div_rank ORDER BY in the template, found %', hits;
  end if;

  update public.af_rpc_templates
     set template = regexp_replace(template, needle, repl)
   where fn_name = 'location_search_candidates_ar';

  -- The sanctioned DDL path: drops overloads, rebuilds all templates, asserts 1 overload each,
  -- updates af_rpc_build_state, and reloads the PostgREST schema cache.
  perform public.rebuild_af_filter_rpcs();

  -- POST 1: exactly one overload (the PGRST203 outage signature is a SECOND one).
  select count(*) into n_overload
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname = 'location_search_candidates_ar' and p.prokind = 'f';
  if n_overload <> 1 then
    raise exception 'refusing: location_search_candidates_ar has % overloads (must be exactly 1)', n_overload;
  end if;

  select pg_get_functiondef(p.oid) into live_def
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.proname = 'location_search_candidates_ar' and p.prokind = 'f';
  select replace(template, '__AF_ELIGIBILITY_WHERE__', public.af_eligibility_clause())
    into built from public.af_rpc_templates where fn_name = 'location_search_candidates_ar';

  -- POST 2: template renders BYTE FOR BYTE to what is now live, so the next rebuild is a no-op and
  -- af_parity_hand_edit cannot fire on this change.
  if built is distinct from live_def then
    raise exception 'refusing: template does not render byte-for-byte to the live definition';
  end if;

  -- POST 3: the rotation term is present, and photo preference is still ranked BEFORE it.
  if position('then hashtext(m.source_table' in live_def) = 0 then
    raise exception 'refusing: the rotation term is not present in the rebuilt definition';
  end if;
  if position('m.has_photo is true then 0' in live_def) > position('then hashtext(m.source_table' in live_def) then
    raise exception 'refusing: rotation is ranked ABOVE photo preference (the 2026-08-29 bug)';
  end if;
end
$rot$;
