-- THE REPAIR for the defect the previous migration's barrier is currently RAISING.
--
-- mon_detect_deleted_but_source_live() limb 1 emitted 'deletion_log_id', rec.id where rec.id is
-- cleanup_deletion_verification.id. The real foreign key is v.deletion_log_id. Fixed by NEEDLE-
-- EDITING the LIVE body -- never by pasting a remembered one (the rule earned by four roster
-- clobbers) -- and asserting each anchor is unique before touching it.
--
-- WHAT IS DELIBERATELY NOT CHANGED. The dedup_key ('deleted_but_source_live:<verification id>') and
-- the close_out instruction (ref_id = that same verification id) are CORRECT: the adjudication
-- table ops_deleted_but_source_live_adjudication keys on scope='verification', ref_id=v.id, and a
-- row already exists on that contract (ref_id 73, written 2026-08-30). Changing the key would
-- orphan that row and re-raise a P0 a human already closed with real evidence. Only the payload
-- label was wrong; the identity was always right.
--
-- The verification id does not simply disappear from the payload either -- it is emitted under its
-- own true name, so both ids are readable and neither can be mistaken for the other.

-- 1. THE DETECTOR -- needle-edited from the LIVE body.
do $mig$
declare def text;
  sel_anchor constant text :=
    'select v.id, v.platform, v.source_table, v.listing_id, v.listing_url, v.deleted_at, v.verified_at';
  pay_anchor constant text :=
    '''deletion_log_id'', rec.id, ''source_table'', rec.source_table, ''listing_id'', rec.listing_id,';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'mon_detect_deleted_but_source_live';
  if def is null then
    raise exception 'mon_detect_deleted_but_source_live() is missing -- refusing to invent one';
  end if;
  if position('''verification_id'', rec.id' in def) > 0 then
    return; -- already repaired; idempotent
  end if;

  if (length(def) - length(replace(def, sel_anchor, ''))) / length(sel_anchor) <> 1 then
    raise exception 'limb-1 SELECT anchor is not unique -- refusing to needle-edit blindly';
  end if;
  if (length(def) - length(replace(def, pay_anchor, ''))) / length(pay_anchor) <> 1 then
    raise exception 'limb-1 payload anchor is not unique -- refusing to needle-edit blindly';
  end if;

  -- carry the real FK out of the row...
  def := replace(def, sel_anchor,
    'select v.id, v.deletion_log_id, v.platform, v.source_table, v.listing_id, v.listing_url, v.deleted_at, v.verified_at');
  -- ...and emit each id under its own true name.
  def := replace(def, pay_anchor,
    '''deletion_log_id'', rec.deletion_log_id, ''verification_id'', rec.id,' || chr(10)
    || '        ''source_table'', rec.source_table, ''listing_id'', rec.listing_id,');

  execute def;
end $mig$;

-- 2. REPAIR THE ALERT ALREADY SITTING IN THE QUEUE.
--    Operational logging only -- no listing row is touched. Every value written here is READ FROM
--    cleanup_deletion_verification rather than typed in, so this cannot introduce a third number.
update public.alert_event a
   set detail = a.detail
              || jsonb_build_object('deletion_log_id', v.deletion_log_id,
                                    'verification_id', v.id,
                                    'payload_fk_repaired_at', now(),
                                    'payload_fk_repair_note',
                                    'The deletion_log_id key previously carried the verification '
                                 || 'row id. Corrected in place from cleanup_deletion_verification; '
                                 || 'the dedup_key and close_out ref_id were already correct and '
                                 || 'are unchanged.')
  from public.cleanup_deletion_verification v
 where a.kind = 'deleted_but_source_live'
   and a.resolved_at is null
   and split_part(a.dedup_key, ':', 2) ~ '^[0-9]+$'
   and v.id = split_part(a.dedup_key, ':', 2)::bigint
   and (a.detail->>'deletion_log_id') is distinct from v.deletion_log_id::text;