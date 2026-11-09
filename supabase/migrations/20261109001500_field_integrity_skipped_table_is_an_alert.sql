-- 🔧 2026-11-09 (CodeRabbit on #11367): mon_detect_field_integrity wrapped each source table's scan in
-- «exception when others then continue», so a table whose scan raised (a division_by_zero, a missing column, a
-- timeout) was skipped in silence and its listings read as clean. A checker's silence must be an alarm
-- (docs/ops/LISTING_LIVENESS.md §9): a skipped table now raises a P2 «field_integrity_table_skipped:<table>»
-- naming the error, and a clean scan resolves it. Every other check, threshold and alert is unchanged.
do $m$
declare v text; n text;
  old_exc constant text := $a$    exception when others then continue;  -- shape mismatch → skip table, never block
    end;
$a$;
  new_exc constant text := $a$    exception when others then
      -- a table the scan could not read is UNKNOWN, never clean: say so (11-09, CodeRabbit on #11367)
      n := n + public.mon_raise('P2','field_integrity', rec.platform,
        'field_integrity_table_skipped:'||rec.tn,
        jsonb_build_object('table', rec.tn, 'sqlstate', SQLSTATE, 'error', left(SQLERRM, 300),
          'why','the field_integrity scan of this table raised an error, so none of its checks ran — its listings are UNKNOWN, not clean'));
      continue;
    end;
    update public.alert_event set resolved_at = now()
    where kind='field_integrity' and resolved_at is null
      and dedup_key = 'field_integrity_table_skipped:'||rec.tn;
$a$;
begin
  v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);
  if (length(v) - length(replace(v, old_exc, ''))) / length(old_exc) <> 1 then
    raise exception 'mon_detect_field_integrity: expected the silent per-table exception handler exactly once';
  end if;
  n := replace(v, old_exc, new_exc);
  execute n;
end
$m$;
