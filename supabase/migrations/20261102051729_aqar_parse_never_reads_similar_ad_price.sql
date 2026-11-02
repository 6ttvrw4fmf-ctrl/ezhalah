-- Aqar: a page with no «تفاصيل الإعلان» block (aqar's soft-closed ad) must not take its price from the
-- «إعلانات مشابهة» cards of OTHER ads (⚡ 2026-11-02, alert 466 / run 93591).
--
-- Measured 2026-11-02: ad 6944911 (aqar_residential_listings 23096982, Riyadh حي الربوة land) — the page
-- prints «مغلق», no spec block and no price; the scraper stored the payload's verdict «no price»
-- (price_evidence.authoritative_absent = true), and trg_aqar_parse then overwrote price_total with
-- 2,040,000, the FIRST similar-ad card's price («أرض للبيع في شارع وادي الأعشاب … 2,040,000 § ريال 408م²»).
-- aqar_parse's `head` is split_part(txt,'تفاصيل الإعلان',1) = the whole page when the anchor is absent.
-- 30 active residential + 2 active commercial rows were served with a neighbour's price this way
-- (32 of 32: the stored figure appears nowhere before «إعلانات مشابهة»; 29 show the «مغلق» banner).
-- «إعلانات مشابهة» never precedes «تفاصيل الإعلان» on a page that has both (0 of 2,725 recent captures),
-- so cutting there is a no-op on every normal page.
--
-- Needle edits of the LIVE bodies (no retyped copy, no DROP):
--   1. aqar_parse: head also stops at «إعلانات مشابهة».
--   2. trg_aqar_parse: a Buy price is never written over the scraper's authoritative «no price».
--   3. Repair: the 32 active rows the scraper marked authoritative-no-price whose page has no
--      «تفاصيل الإعلان» block go back to NULL (PRICE = SOURCE; before-values in the :proof row).
do $mig$
declare d text; n int;
begin
  d := pg_get_functiondef('public.aqar_parse(text)'::regprocedure);
  if position($x$head   := split_part(txt, 'تفاصيل الإعلان', 1);$x$ in d) = 0 then
    raise exception 'aqar_parse: head anchor line not found — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$head   := split_part(txt, 'تفاصيل الإعلان', 1);$x$,
    $x$head   := split_part(split_part(txt, 'تفاصيل الإعلان', 1), 'إعلانات مشابهة', 1);  -- never another ad's card (2026-11-02)$x$);
  execute d;

  d := pg_get_functiondef('public.trg_aqar_parse()'::regprocedure);
  if position($x$<> 'per_meter' then$x$ in d) = 0 then
    raise exception 'trg_aqar_parse: per_meter guard line not found — body changed, re-derive the edit';
  end if;
  d := replace(d, $x$<> 'per_meter' then$x$,
    $x$<> 'per_meter'
       -- the scraper read aqar's payload and it says NO price: prose never supplies one (2026-11-02)
       and coalesce(NEW.source_capture->'price_evidence'->>'authoritative_absent', '') <> 'true' then$x$);
  execute d;

  update aqar_residential_listings
     set price_total = null
   where active and transaction_type = 'Buy' and price_total is not null
     and source_capture->'price_evidence'->>'authoritative_absent' = 'true'
     and strpos(source_capture->>'source_text', 'تفاصيل الإعلان') = 0;
  get diagnostics n = row_count;
  if n > 40 then raise exception 'residential repair touched % rows, expected ~30', n; end if;

  update aqar_commercial_listings
     set price_total = null
   where active and transaction_type = 'Buy' and price_total is not null
     and source_capture->'price_evidence'->>'authoritative_absent' = 'true'
     and strpos(source_capture->>'source_text', 'تفاصيل الإعلان') = 0;
  get diagnostics n = row_count;
  if n > 10 then raise exception 'commercial repair touched % rows, expected ~2', n; end if;
end
$mig$;

-- check block: executed, not grepped.
do $chk$
declare p jsonb;
begin
  -- the closed page: own header shows «مغلق», only a similar card carries a price → no price.
  p := public.aqar_parse('أرض للبيع في شارع الفقهاء مغلق خيارات البحث إعلانات مشابهة أرض للبيع في شارع وادي الأعشاب 2,040,000 § ريال 408م²');
  if p ? 'price' then raise exception 'aqar_parse still reads a similar-ad price: %', p; end if;
  -- a normal page keeps its own header price.
  p := public.aqar_parse('شقة للبيع 950,000 § تفاصيل الإعلان المساحة 120 م² إعلانات مشابهة شقة 700,000 §');
  if (p->>'price')::bigint is distinct from 950000 then raise exception 'aqar_parse lost the own price: %', p; end if;
  if position('authoritative_absent' in pg_get_functiondef('public.trg_aqar_parse()'::regprocedure)) = 0 then
    raise exception 'trg_aqar_parse guard missing';
  end if;
  if exists (select 1 from aqar_residential_listings where id = 23096982 and price_total is not null) then
    raise exception 'repair did not reach 23096982';
  end if;
end
$chk$;
