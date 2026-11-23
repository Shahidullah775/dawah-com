-- Dawah.com public read model.
-- Public clients can read only rows explicitly marked as published.
create table if not exists public.dawah_public_content (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('quran','hadith')),
  source_name text not null,
  sequence_no integer not null check (sequence_no > 0),
  arabic_text text not null,
  bengali_translation text not null,
  commentary text,
  reference_text text not null,
  card_text text,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_name, sequence_no)
);
alter table public.dawah_public_content enable row level security;
drop policy if exists "Public can read published Dawah content" on public.dawah_public_content;
create policy "Public can read published Dawah content"
  on public.dawah_public_content for select
  to anon, authenticated
  using (is_published = true);
grant select on public.dawah_public_content to anon, authenticated;
create index if not exists dawah_public_content_published_idx
  on public.dawah_public_content (is_published, published_at desc);
create index if not exists dawah_public_content_source_sequence_idx
  on public.dawah_public_content (source_name, sequence_no);
