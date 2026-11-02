-- listing_embeddings — free multilingual text vectors of each ad (owner's VECTOR COMBO, 2026-10-24).
--
-- A FREE word checker (scrapers/facts/word_checker.py) decides yes/no for a fact, with the ad's words as
-- proof, into public.listing_facts. These vectors only help FIND ads and words the checker missed (the
-- finder loop in scrapers/facts/words.py) — a vector never writes a yes or a no. Embedded on the GitHub
-- Actions CPU with intfloat/multilingual-e5-small (384-d, pinned revision); zero paid AI calls.
-- Text = title + description, PDPL-sanitised by the same sanitizer the facts test used.
--
-- halfvec(384) = 776 bytes a row, stored inline. No HNSW index yet: add one when dedupe needs it.
-- NOT a product surface: RLS on, no policies, anon/authenticated revoked — service-role only (public-key
-- lockdown, 2026-10-18). Touches no *_listings table, no RPC, no scraper, no edge function.
create extension if not exists vector with schema extensions;

create table if not exists public.listing_embeddings (
  platform     text        not null,
  table_name   text        not null,
  listing_key  text        not null,   -- the source table's ad_number
  model        text        not null,   -- short model name, e.g. e5-small
  embedding    extensions.halfvec(384) not null,
  text_hash    text        not null,   -- md5 of the exact text embedded (skip unchanged ads on re-runs)
  embedded_at  timestamptz not null default now(),
  constraint listing_embeddings_pkey primary key (table_name, listing_key, model)
);
alter table public.listing_embeddings enable row level security;
revoke all on table public.listing_embeddings from public, anon, authenticated;
comment on table public.listing_embeddings is
  'Free multilingual text vectors of each ad (title+description, PDPL-sanitised) for the facts finder loop. Service-role only; nothing serves it; vectors never decide a fact.';
