-- PDPL: the hourly capture scanner (cron job 65, mon_scan_pii_capture_batch) learns the phone shapes.
--
-- Companion to 20260928101315_pdpl_redact_phone_shapes_arabic_digits_and_separators. The private raw
-- captures carried the same shapes the card text did — Arabic-Indic digits, spaced/dashed/dotted
-- mobiles, «+966 (0) 5…», landlines, «واتس اب : …» — in 1,474 rows across 19 tables (aqar
-- source_text alone: 1,098 + 153), and this scanner reported ZERO because its pattern shared the
-- old blind spots. Those captures were scrubbed with _redact_pii_sql (same pattern, in place); this
-- migration makes the scanner see the shapes so any recurrence is reported, not silent. The added
-- alternative is scrapers/common/pii.py _PHONE_SHAPES_RE byte-for-byte.
do $do$
declare d text := pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc);
  o text := $x$\.[A-Za-z]{2,})';$x$;
  n text := $x$\.[A-Za-z]{2,}|واتس\S*(?:\s+اب)?\s*[:\-]?\s*\+?[0-9٠-٩](?:[\s\-]?[0-9٠-٩]){7,11}|(?<![0-9٠-٩])(?:(?:\+|00)?(?:966|٩٦٦)[\s.\-]*(?:\([0٠]\))?[\s.\-]*[0٠]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|[0٠][\s.\-]?[5٥](?:[\s.\-]?[0-9٠-٩]){8}|٥[٠-٩]{8}|[0٠][\s.\-]?[1١][1-7١-٧](?:[\s.\-]?[0-9٠-٩]){7})(?![0-9٠-٩]))';$x$;
begin
  if (length(d) - length(replace(d, o, ''))) / length(o) <> 1 then
    raise exception 'ABORT: mon_scan_pii_capture_batch no longer has the expected pattern tail';
  end if;
  execute replace(d, o, n);
  if pg_get_functiondef('public.mon_scan_pii_capture_batch'::regproc) not like '%٩٦٦%' then
    raise exception 'ABORT: the capture scanner did not learn the new shapes';
  end if;
end $do$;
