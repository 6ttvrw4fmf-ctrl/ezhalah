-- 🔧 Quality & Repair 2026-11-07 — card_parity_card_missing ×3 (13573 shomou, 13560 gomenassat, 13557 hajer, raised
-- 06:59–07:59 UTC) are the OLD licence reader's misreads, not missing licences: the «licence» it found on those pages is
-- an OFFICE or FAL number beside the label (shomou 2100000432 = its stored office_licence, gomenassat 2100000284, hajer
-- 1200029306), never the REGA ad-licence shape 71/72xxxxxxxx. #11054 (merged 09:53 UTC) taught the reader that only the
-- REGA shape counts, but the detector sums the last 7 nights of ops_card_parity rows, so the old rows keep the three
-- alerts open for a week while the real five (fahadalshahri 7201073069, aqargate 7100267912, amaall 7200661580,
-- akariyoun 7201006705, abeea 7201121833 — ⚡ backlog 1518) sit beside them. Needle-edit of the live detector: a
-- we_miss built ONLY from non-REGA page values is not a missing licence (skipped; its key is then resolved as stale).
-- A row with any REGA-shaped page value, a card_missing or a mismatch is judged exactly as before.
do $$
declare src text; out_def text;
  anchor constant text := E'    v_kind := ''card_parity_card_missing'';\n    if r.mm > v_wrong then';
  needle constant text := E'    v_kind := ''card_parity_card_missing'';\n'
    || E'    -- 2026-11-07 (🔧): a «licence» the page shows that is NOT the REGA ad-licence shape (71/72xxxxxxxx) is an office or\n'
    || E'    -- FAL number beside the label (#11054); a we_miss built only from such pages is not a missing licence.\n'
    || E'    if r.field = ''licence'' and r.cm = 0 and r.mm = 0 and r.wm > 0 and r.sample is not null\n'
    || E'       and not exists (select 1 from jsonb_array_elements(r.sample) s where coalesce(s->>''page'', '''') ~ ''^7[12][0-9]{8}$'') then\n'
    || E'      continue;\n'
    || E'    end if;\n'
    || E'    if r.mm > v_wrong then';
begin
  src := pg_get_functiondef('public.mon_detect_card_parity()'::regprocedure);
  if position('is not the REGA ad-licence shape' in src) > 0 then
    raise notice 'mon_detect_card_parity already skips non-REGA licence pages';
    return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'detector text is not where it was (expected exactly one anchor) — refusing to guess';
  end if;
  out_def := replace(src, anchor, needle);
  execute out_def;
end $$;

-- PROOF, both directions, on the live rows: the three office-licence alerts close, the REGA-shaped one stays open.
do $$
declare before_n int; after_n int; r int;
begin
  select count(*) into before_n from public.alert_event where kind = 'card_parity_card_missing' and resolved_at is null;
  r := public.mon_detect_card_parity();
  select count(*) into after_n from public.alert_event where kind = 'card_parity_card_missing' and resolved_at is null;
  if exists (select 1 from public.alert_event where resolved_at is null
              and dedup_key in ('card_parity_card_missing:shomou:licence', 'card_parity_card_missing:gomenassat:licence',
                                'card_parity_card_missing:hajer:licence')) then
    raise exception 'PROOF: an office-licence misread is still open (before %, after %)', before_n, after_n;
  end if;
  if not exists (select 1 from public.alert_event where resolved_at is null
                  and dedup_key = 'card_parity_card_missing:fahadalshahri:licence') then
    raise exception 'PROOF: the REGA-shaped fahadalshahri licence gap was wrongly closed — the rule is too wide';
  end if;
  raise notice 'PROOF: card_parity_card_missing open % -> %; fahadalshahri (REGA 7201073069) still open', before_n, after_n;
end $$;
