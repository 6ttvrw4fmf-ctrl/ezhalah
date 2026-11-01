-- PROVEN-SILENT DISTRICT PROOF ROWS, batch 5 (2026-10-19): haraj, the 117 posts re-read by run 39175157914.
-- The current parser re-read every one of them from its own page on 2026-10-19 00:41-00:44 UTC and found no deed «الحي:»,
-- no Haraj post-neighbourhood anchor and no licence-location district for the precedence to take. Only the posts whose
-- REGA licence location ALSO names no district are proven here: the line is absent or «-», reads «Not Determined» /
-- «غير محدد», names the village twice («Hail Region, Alshiyhiuh, Alshiyhiuh»), or is a plot/plan/centre text with no
-- «حي». Rendered 2026-10-19: 11188397766 (licence location «-»), 11189162537 («منطقة عسير, المعلمات, غير محدد»),
-- 11188420584 (a plot text «… بمدينة المخواه»), 11189118171 («Alfwylq No. 1, Alfwylq No. 1»): no neighbourhood anchor,
-- no «الحي:» in the deed block. The 56 whose licence location DOES name a district are NOT here (owner question).
-- Seller prose is never a district (owner 2026-10-18). Rows are excused per listing; a new blank row is not.
set local lock_timeout = '5s';

do $silent$
declare n int;
begin
  insert into public.ops_district_silent_source (platform, source_table, listing_id, cohort, selector_checked, proof, decided_by)
  select 'haraj', a.tbl, a.id,
         'haraj: no deed «الحي:», no licence-location district, no post-neighborhood anchor (seller prose is never a district)',
         'rendered ad page: REGA licence «وصف موقع العقار» line, deed block lines, data-testid=post-neighborhood anchor',
         '2026-10-19 re-read (run 39175157914) found no deed «الحي:», no neighbourhood anchor, and a licence location naming '
           || 'no district: «' || coalesce(a.loc, '-') || '». Rendered: 11188397766, 11189162537, 11188420584, 11189118171. '
           || 'This post: /' || substr(a.ad_number, 4) || '/',
         'district engineer 2026-10-19 (page read)'
    from (select 'haraj_residential_listings' tbl, id, ad_number, neighborhood, active, last_seen_at,
                 nullif(btrim(additional_info->>'licence_location'), '') loc
            from public.haraj_residential_listings
          union all
          select 'haraj_commercial_listings', id, ad_number, neighborhood, active, last_seen_at,
                 nullif(btrim(additional_info->>'licence_location'), '')
            from public.haraj_commercial_listings) a
   where a.ad_number = any (select 'HRJ' || x from unnest(array['11188458816','11188454913','11188689317','11188643081','11188445611','11188445742','11188485082','11188745142','11188436865','11188420584','11188420921','11188434913','11188418885','11188983474','11188986076','11188934674','11188977924','11188968068','11188936311','11188940124','11188803773','11188888824','11188746200','11188741919','11188883146','11188834813','11188810455','11188774664','11188771088','11188751379','11190790741','11188722281','11188626362','11188701840','11188705103','11188637576','11188715618','11188516403','11188564626','11188589683','11188469974','11188470537','11188472011','11188649941','11188644549','11188615028','11188582930','11188583048','11188583165','11188583289','11188537097','11188537498','11188476716','11188479034','11188373729','11188512368','11188535936','11188518208','11190821630','11188511059','11188500548','11188501125','11190817232','11188539548','11188357662','11189202631','11189189038','11189183984','11189125677','11189174734','11189176480','11189162537','11189048740','11189010612','11189157379','11189131879','11189103417','11189103046','11189109899','11189088530','11188995162','11189084452','11189092928','11189068680','11189086939','11189061901','11189063578','11189063763','11189038287','11189084989','11189056629','11189080449','11189024182','11189023114','11189007992','11188433302','11188441802','11188362846','11188397766','11188355929','11188400261','11188362109','11188361038','11188371403','11189197888','11188502980','11188366134','11188631276','11188554371','11190824690','11188543274','11190799247','11188843519','11188931400','11188862838','11189126253','11189118171']) x)
     and a.active and coalesce(a.neighborhood, '') = ''
     and a.last_seen_at > timestamptz '2026-10-19 00:40+00'
     and (a.loc is null or a.loc = '-'
          or lower(btrim(split_part(a.loc, ',', 3))) in ('not determined', 'غير محدد')
          or (array_length(string_to_array(a.loc, ','), 1) = 3
              and lower(regexp_replace(split_part(a.loc, ',', 3), '\s', '', 'g'))
                = lower(regexp_replace(split_part(a.loc, ',', 2), '\s', '', 'g')))
          or (a.loc !~ '[,،]' and a.loc !~ '(^|[^ء-ي])(ب|و|ل|ف)?(حي|الحي|حى|حية)([^ء-ي]|$)'))
     and not public.district_blank_is_excused('haraj', a.tbl, a.id);
  get diagnostics n = row_count;
  if n not between 55 and 65 then raise exception 'haraj batch 5 proved % rows, expected 55-65: stop and look', n; end if;
  raise notice 'haraj batch 5: % rows proven silent', n;
end $silent$;
