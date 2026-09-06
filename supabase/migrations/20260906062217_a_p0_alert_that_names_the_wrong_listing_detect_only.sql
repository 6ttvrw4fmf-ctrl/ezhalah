-- A P0 TOLD A HUMAN TO GO LOOK AT THE WRONG LISTING.
--
-- mon_detect_deleted_but_source_live() limb 1 iterates cleanup_deletion_verification and emits
--   'deletion_log_id', rec.id
-- but rec.id is the VERIFICATION row's id, not the deletion-log id it names. The true FK is
-- v.deletion_log_id, a different column with a different value. Limb 2 does this correctly
-- ('backaudit_id', rec.id) -- so the bug is one mislabelled key, in the limb that fires most.
--
-- WHY IT MATTERS RATHER THAN BEING COSMETIC. This alert is P0 and its own body instructs a human to
-- decide whether "the pre-delete recheck itself has a bug (repair the recheck logic, not just this
-- row)". That adjudication starts by reading the deletion-log row the alert names. Because
-- cleanup_deletion_log is densely populated with small ids, the wrong id almost always resolves to
-- SOME row -- so it fails silently and plausibly rather than erroring, which is the worst shape.
--
-- Measured on production before this migration: of 2 verification rows with verdict='live', 2 of 2
-- have the mislabelled id resolving to a real but DIFFERENT listing. The currently-open P0
-- (dedup_key deleted_but_source_live:102) describes gathern listing 733769 at
-- gathern.co/view/121907/unit/173391 while naming deletion_log_id 102, which is aqarcity listing
-- 594834 at aqarcity.net/property/27356 -- a different platform, listing, URL and date. The true
-- deletion_log_id is 332.
--
-- DETECT-ONLY ON PURPOSE. This migration adds no repair. The barrier must be seen RAISING on the
-- live defect before the fix exists, so it cannot be a guard that was green the whole time the bug
-- was shipped -- the failure mode AGENTS.md records for the five 2026-09-04 defects whose
-- source-TEXT barriers pinned the defective line as correct. The repair lands in the next migration.
--
-- The predicate is a PURE function taking injected claims through the SAME comparison, so the
-- self-test can EXECUTE it against a known-wrong payload instead of grepping anyone's source.

-- 1. THE PURE PREDICATE -- decides, writes nothing, judges injected claims identically.
create or replace function public.mon_alert_subject_fk_mismatches(p_extra jsonb default '[]'::jsonb)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with scoped as (
    -- Limb-1 keys only: 'deleted_but_source_live:<verification id>'. Limb 2's keys carry a
    -- 'backaudit' segment and a correctly-named 'backaudit_id', so they are out of scope by shape.
    select a.dedup_key as key,
           a.detail->>'deletion_log_id' as claimed,
           case when split_part(a.dedup_key, ':', 2) ~ '^[0-9]+$'
                then split_part(a.dedup_key, ':', 2)::bigint end as verification_id
      from public.alert_event a
     where a.kind = 'deleted_but_source_live'
       and a.resolved_at is null
  ),
  claims as (
    -- REAL: what the detector actually emitted, cross-checked against the row the key names.
    -- This reads the OUTPUT, not the source text, so a future rewrite that reintroduces the
    -- defect is caught by what it emits rather than by how it is written.
    select s.key, s.claimed, v.deletion_log_id::text as truth
      from scoped s
      join public.cleanup_deletion_verification v on v.id = s.verification_id
     where s.verification_id is not null
    union all
    -- INJECTED: judged by exactly the same comparison, which is what lets a self-test ask
    -- "would you notice a payload naming the wrong row?" without corrupting a real alert.
    select x->>'key', x->>'claimed', x->>'truth'
      from jsonb_array_elements(coalesce(p_extra, '[]'::jsonb)) x
  )
  select coalesce(array_agg(key order by key), '{}'::text[])
    from claims
   where claimed is distinct from truth;
$fn$;

revoke all on function public.mon_alert_subject_fk_mismatches(jsonb) from public;

-- 2. THE DETECTOR -- raises on real mismatches, resolves on its evaluated path.
create or replace function public.mon_detect_alert_subject_fk()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare bad text[]; n int := 0; ex jsonb;
begin
  bad := public.mon_alert_subject_fk_mismatches();

  if cardinality(bad) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
             'dedup_key', a.dedup_key,
             'payload_claims_deletion_log_id', a.detail->>'deletion_log_id',
             'true_deletion_log_id', v.deletion_log_id,
             'actual_subject_url', v.listing_url,
             'actual_subject_platform', v.platform,
             'the_row_the_payload_actually_points_at', (
                select jsonb_build_object('platform', l.platform, 'listing_url', l.listing_url)
                  from public.cleanup_deletion_log l
                 where a.detail->>'deletion_log_id' ~ '^[0-9]+$'
                   and l.id = (a.detail->>'deletion_log_id')::bigint)
           ) order by a.dedup_key), '[]'::jsonb)
      into ex
      from public.alert_event a
      join public.cleanup_deletion_verification v
        on v.id = case when split_part(a.dedup_key, ':', 2) ~ '^[0-9]+$'
                       then split_part(a.dedup_key, ':', 2)::bigint end
     where a.kind = 'deleted_but_source_live'
       and a.resolved_at is null
       and a.dedup_key = any (bad);

    n := public.mon_raise('P2', 'alert_payload_wrong_subject', 'all',
      'alert_payload_wrong_subject:deleted_but_source_live',
      jsonb_build_object(
        'mismatches', ex,
        'count', cardinality(bad),
        'why', 'A P0 alert names a foreign key that resolves to a DIFFERENT listing than the one '
            || 'the alert is about. deleted_but_source_live tells a human to decide whether the '
            || 'pre-delete recheck is buggy, and that adjudication starts from the deletion-log row '
            || 'the payload names. cleanup_deletion_log is densely populated, so a wrong id resolves '
            || 'to a real row instead of erroring -- the investigation goes to the wrong platform '
            || 'and the wrong listing, with nothing to signal it.',
        'action', 'Emit the row''s real deletion_log_id and label the verification id as such. Do '
            || 'NOT repair by changing the dedup_key or the close_out ref_id: those correctly '
            || 'reference cleanup_deletion_verification.id, and ops_deleted_but_source_live_'
            || 'adjudication rows already point at it. Only the payload key is wrong.',
        'owner', 'routine-2-production'));
  else
    perform public.mon_resolve_key('alert_payload_wrong_subject',
                                   'alert_payload_wrong_subject:deleted_but_source_live');
  end if;
  return n;
end $fn$;

revoke all on function public.mon_detect_alert_subject_fk() from public;

-- 3. THE SELF-TEST -- proves the predicate can go red AND is not vacuously red. Both directions,
--    every half hour, against injected claims; no writes to any real alert.
create or replace function public.mon_detect_alert_subject_fk_is_blind()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare blind text[] := '{}'; n int := 0;
begin
  -- POSITIVE: the thing it exists to notice -- a payload naming a different row than its subject.
  if not ('probe:mismatch' = any (public.mon_alert_subject_fk_mismatches(
        '[{"key":"probe:mismatch","claimed":"102","truth":"332"}]'::jsonb))) then
    blind := blind || 'an injected payload whose FK names a DIFFERENT row was not reported';
  end if;

  -- NEGATIVE CONTROL: a predicate that reported everything would satisfy the positive half and be
  -- just as useless.
  if 'probe:match' = any (public.mon_alert_subject_fk_mismatches(
        '[{"key":"probe:match","claimed":"332","truth":"332"}]'::jsonb)) then
    blind := blind || 'a payload whose FK is CORRECT was reported as a mismatch -- the predicate flags everything';
  end if;

  -- A NULL claim (key absent from the payload entirely) is a mismatch, not a pass: a payload that
  -- silently stopped emitting the FK must not read as agreement.
  if not ('probe:absent' = any (public.mon_alert_subject_fk_mismatches(
        '[{"key":"probe:absent","truth":"332"}]'::jsonb))) then
    blind := blind || 'a payload MISSING the FK entirely was treated as agreeing';
  end if;

  -- And the raising half must still be attached to the deciding half.
  if position('public.mon_alert_subject_fk_mismatches(' in (
       select pg_get_functiondef(p.oid) from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname = 'mon_detect_alert_subject_fk')) = 0 then
    blind := blind || 'mon_detect_alert_subject_fk() no longer calls the predicate this self-test proves';
  end if;

  if cardinality(blind) > 0 then
    n := public.mon_raise('P1', 'blind_guard', 'all', 'blind_guard:mon_detect_alert_subject_fk',
      jsonb_build_object('blind', to_jsonb(blind),
        'why', 'The guard that proves a P0 alert names its own subject can no longer tell a correct '
            || 'foreign key from one pointing at a different listing.',
        'owner', 'routine-2-production'));
  else
    perform public.mon_resolve_key('blind_guard', 'blind_guard:mon_detect_alert_subject_fk');
  end if;
  return n;
end $fn$;

revoke all on function public.mon_detect_alert_subject_fk_is_blind() from public;

-- 4. ROSTER -- needle-edited from the LIVE body, never rebuilt from a remembered one.
--    "A detector outside the roster is decoration" (AGENTS.md).
do $mig$
declare def text;
  anchor constant text := '''mon_detect_deleted_but_source_live''';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if def is null then
    raise exception 'mon_run_all_detectors() is missing -- refusing to invent a roster';
  end if;
  if position('mon_detect_alert_subject_fk' in def) > 0 then
    return; -- idempotent
  end if;
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the roster anchor % is not unique -- refusing to needle-edit blindly', anchor;
  end if;
  def := replace(def, anchor, anchor || ',' || chr(10)
       || '    ''mon_detect_alert_subject_fk'',' || chr(10)
       || '    ''mon_detect_alert_subject_fk_is_blind''');
  execute def;
end $mig$;