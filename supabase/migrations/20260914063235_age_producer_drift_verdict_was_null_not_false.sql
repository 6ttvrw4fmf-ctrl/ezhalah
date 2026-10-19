-- THE DETECTOR THAT COULD NEVER FIRE, CAUGHT BY ITS OWN VERIFICATION (routine #2, 2026-09-14).
--
-- 20260914063120 added mon_detect_age_producer_view_drift(). Reading its output in production immediately
-- after applying it returned:
--
--   {"drift": null, "have_arms": 22, "want_arms": 22, "only_in_view": [], "only_in_registry": [],
--    "missing_jsonb_keys": []}
--
-- `drift` was NULL, not false. Cause: the verdict is a four-term OR whose last term was
-- `array_length(v_missing_keys, 1) > 0`, and array_length() of an EMPTY array returns NULL, not 0. So
-- `false or false or false or NULL` = NULL. Postgres treats NULL as not-true in `if`, so the detector read
-- as clean -- and would have read as clean over a genuine drift in the two terms that can be NULL-poisoned,
-- because `NULL or true` is only true when a DIFFERENT term fires.
--
-- The migration's own mutation proof PASSED over this. It asserted "drift is true" on a perturbation that
-- made only_in_view non-empty (true or NULL = true, so that half was real), and asserted "not drift" on the
-- clean state -- which NULL satisfies vacuously. A proof whose clean direction accepts NULL is not proving
-- the clean direction at all. That is the exact shape AGENTS.md warns about: a barrier that reads green
-- because it cannot express its own question.
--
-- Fix: coalesce the array_length terms, and strengthen the proof so it asserts the verdict is STRICTLY
-- false / STRICTLY true (is false / is true, never a truthiness test), plus a third direction that
-- perturbs ONLY the jsonb key so the previously NULL-poisoned term is the sole cause of the verdict.

create or replace function public.age_producer_view_drift()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_def          text;
  v_want         text[];
  v_have         text[];
  v_want_arms    int;
  v_have_arms    int;
  v_missing_keys text[] := '{}';
  r              record;
begin
  if to_regclass('public.listing_age_resolved') is null then
    return jsonb_build_object('drift', true, 'reason', 'view_absent');
  end if;
  v_def := pg_get_viewdef('public.listing_age_resolved'::regclass, true);

  select array_agg(source_table order by source_table), count(*)
    into v_want, v_want_arms
  from (
    select reg.source_table
      from age_source_registry reg
      join public.age_source_health() h on h.source_table = reg.source_table
     where reg.strategy = 'canonical_column' and reg.trusted and h.verdict = 'ok'
    union all
    select reg.source_table from age_source_registry reg
     where reg.strategy = 'jsonb_text' and reg.trusted and reg.jsonb_key is not null
    union all
    select reg.source_table from age_source_registry reg
     where reg.strategy = 'from_extra_attrs' and reg.trusted
  ) w;
  v_want := coalesce(v_want, '{}');

  select array_agg(distinct t order by t) into v_have
  from (select (regexp_matches(v_def, '''([a-z0-9_]+)''::text AS source_table', 'g'))[1] as t) s;
  v_have := coalesce(v_have, '{}');

  -- one arm == one `AS source_table` alias in the rendered definition
  v_have_arms := (length(v_def) - length(replace(v_def, 'AS source_table', ''))) / length('AS source_table');

  -- a strategy can change without the table set changing, so each jsonb arm's key must still be present
  for r in select source_table, jsonb_key from age_source_registry
            where strategy = 'jsonb_text' and trusted and jsonb_key is not null loop
    if position(quote_literal(r.jsonb_key) in v_def) = 0 then
      v_missing_keys := v_missing_keys || (r.source_table || ':' || r.jsonb_key);
    end if;
  end loop;

  -- every term coalesced: array_length() of an empty array is NULL, and one NULL term made the whole
  -- verdict NULL, which reads as clean. A verdict must be true or false, never unknown.
  return jsonb_build_object(
    'drift', coalesce((select count(*) from (select unnest(v_want) except select unnest(v_have)) a), 0) > 0
          or coalesce((select count(*) from (select unnest(v_have) except select unnest(v_want)) b), 0) > 0
          or coalesce(v_want_arms, -1) <> coalesce(v_have_arms, -1)
          or coalesce(array_length(v_missing_keys, 1), 0) > 0,
    'want_arms', v_want_arms,
    'have_arms', v_have_arms,
    'only_in_registry', coalesce((select jsonb_agg(x) from (select unnest(v_want) except select unnest(v_have)) t(x)), '[]'::jsonb),
    'only_in_view',     coalesce((select jsonb_agg(x) from (select unnest(v_have) except select unnest(v_want)) t(x)), '[]'::jsonb),
    'missing_jsonb_keys', to_jsonb(v_missing_keys));
end $function$;

-- ---------------------------------------------------------------------------------------------------
-- Three EXECUTED directions. Every assertion tests the verdict STRICTLY (is false / is true), so a
-- NULL verdict now fails the proof instead of satisfying it.
-- ---------------------------------------------------------------------------------------------------
do $$
declare
  v     jsonb;
  v_tbl text;
begin
  -- A. clean state: strictly FALSE, not null
  v := public.age_producer_view_drift();
  if (v -> 'drift') is null or jsonb_typeof(v -> 'drift') <> 'boolean' then
    raise exception 'VERDICT IS NOT A BOOLEAN on the clean state: %', v::text;
  end if;
  if ((v ->> 'drift')::boolean) is not false then
    raise exception 'CLEAN DIRECTION FAILED: verdict is not strictly false: %', v::text;
  end if;
  raise notice 'A. clean verdict is strictly false (want_arms=%, have_arms=%)',
    v ->> 'want_arms', v ->> 'have_arms';

  -- B. a source disappears from the registry: strictly TRUE (drives only_in_view)
  begin
    select source_table into v_tbl from age_source_registry
     where trusted and strategy = 'jsonb_text' and jsonb_key is not null order by source_table limit 1;
    update age_source_registry set trusted = false where source_table = v_tbl;
    v := public.age_producer_view_drift();
    if ((v ->> 'drift')::boolean) is not true then
      raise exception 'DIRECTION B FAILED: untrusting % did not yield a strictly-true verdict: %', v_tbl, v::text;
    end if;
    if jsonb_array_length(v -> 'only_in_view') = 0 then
      raise exception 'DIRECTION B fired for the wrong reason: only_in_view empty: %', v::text;
    end if;
    raise notice 'B. untrusting % -> strictly true, only_in_view=%', v_tbl, v -> 'only_in_view';
    raise exception 'ezhalah_rollback_b';
  exception when others then
    if sqlerrm <> 'ezhalah_rollback_b' then raise; end if;
  end;

  -- C. ONLY the jsonb key moves. The table set and the arm count are untouched, so the ONLY term that
  --    can fire is missing_jsonb_keys -- the term that was NULL-poisoned. This is the direction the
  --    original proof could not express.
  begin
    select source_table into v_tbl from age_source_registry
     where trusted and strategy = 'jsonb_text' and jsonb_key is not null order by source_table limit 1;
    update age_source_registry set jsonb_key = 'zzz_key_that_is_not_in_the_view' where source_table = v_tbl;
    v := public.age_producer_view_drift();
    if ((v ->> 'drift')::boolean) is not true then
      raise exception 'DIRECTION C FAILED: a moved jsonb key did not yield a strictly-true verdict: %', v::text;
    end if;
    if jsonb_array_length(v -> 'missing_jsonb_keys') = 0 then
      raise exception 'DIRECTION C fired for the wrong reason: missing_jsonb_keys empty: %', v::text;
    end if;
    if jsonb_array_length(v -> 'only_in_view') <> 0 or jsonb_array_length(v -> 'only_in_registry') <> 0
       or (v ->> 'want_arms')::int <> (v ->> 'have_arms')::int then
      raise exception 'DIRECTION C is not isolated -- another term also fired: %', v::text;
    end if;
    raise notice 'C. moved jsonb key on % -> strictly true via missing_jsonb_keys ALONE: %',
      v_tbl, v -> 'missing_jsonb_keys';
    raise exception 'ezhalah_rollback_c';
  exception when others then
    if sqlerrm <> 'ezhalah_rollback_c' then raise; end if;
  end;

  -- D. both perturbations rolled back
  v := public.age_producer_view_drift();
  if ((v ->> 'drift')::boolean) is not false then
    raise exception 'PERTURBATIONS DID NOT ROLL BACK: %', v::text;
  end if;
  raise notice 'D. rolled back, verdict strictly false again';
end $$;
