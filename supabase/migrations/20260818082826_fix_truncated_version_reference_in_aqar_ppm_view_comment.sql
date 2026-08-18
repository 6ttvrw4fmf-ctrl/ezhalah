-- Cosmetic but permanent: the retraction comment applied in 20260818082800 referred to itself as
-- "20260818082... " because the version is minted server-side and was not known while writing it.
-- A comment that names a version nobody can grep is worse than no reference at all.

comment on view public.mon_aqar_ppm_as_total is
  'aqar Buy rows whose stored price_total equals the page''s published سعر المتر while a labelled '
  '«السعر: N ريال» in the same capture says otherwise - i.e. the rate stored as the total. '
  'EXPENSIVE BY NATURE: aqar_published_ppm() plus an Arabic-digit regex over every active aqar Buy '
  'source_text. Measured 2026-08-18: 20,989 ms idle, 22.1 s and 26.8 s in scheduled runs, against '
  'the cluster''s 120 s statement_timeout - roughly 4x headroom, so no timeout override is needed. '
  'The single cancellation at 07:25 that day was contention from the data-integrity run itself, not '
  'a config gap: run #29 briefly "fixed" it with an explicit 120 s that was already the cluster '
  'default (migration 20260818075438) and retracted that in 20260818082800. If this ever reads '
  '60 s+, treat it as a real regression.';
