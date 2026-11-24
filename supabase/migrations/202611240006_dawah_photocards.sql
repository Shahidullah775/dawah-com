-- Dawah.com photo-card studio: additive schema only.
--
-- Safety contract:
--   * Does NOT modify private.dawah_content_queue, the worker claim/record/confirm functions,
--     autopost_slots, dawah_settings, cron jobs or any existing policy.
--   * New tables live in the private schema with RLS enabled and no policies, exactly like the
--     existing operational tables; they are reachable only through the service-role RPCs below.
--   * Storage buckets are private. No storage.objects policies are added, so browsers cannot read
--     or write directly; the dawah-card-api Edge Function issues short-lived signed URLs.
--   * Card text is never stored as an AI output. A card only records which queue record it renders,
--     the layout settings, the (AI/uploaded) background image and the exported file paths.

create table if not exists private.dawah_image_library (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  source text not null check (source in ('ai', 'upload')),
  subject text,
  prompt text,
  model text,
  content_id uuid references private.dawah_content_queue(id) on delete set null,
  width integer,
  height integer,
  mime_type text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists private.dawah_photocards (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references private.dawah_content_queue(id) on delete cascade,
  status text not null default 'draft' check (status in (
    'draft', 'generating_image', 'designing', 'ready_for_review',
    'approved', 'scheduled', 'published', 'failed'
  )),
  template text not null default 'ivory',
  size_key text not null default 'square' check (size_key in ('square', 'portrait', 'landscape')),
  layout jsonb not null default '{}'::jsonb,
  image_id uuid references private.dawah_image_library(id) on delete set null,
  png_path text,
  jpg_path text,
  content_hash text,
  error_message text,
  attempts integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dawah_photocards_content_idx
  on private.dawah_photocards (content_id, updated_at desc);
create index if not exists dawah_photocards_status_idx
  on private.dawah_photocards (status, updated_at desc);
create index if not exists dawah_image_library_created_idx
  on private.dawah_image_library (created_at desc);
create index if not exists dawah_image_library_content_idx
  on private.dawah_image_library (content_id);

alter table private.dawah_image_library enable row level security;
alter table private.dawah_photocards enable row level security;
revoke all on private.dawah_image_library from public, anon, authenticated;
revoke all on private.dawah_photocards from public, anon, authenticated;

-- Private buckets (no storage.objects policies: access only through service-role signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('dawah-card-images', 'dawah-card-images', false, 12582912, array['image/png', 'image/jpeg', 'image/webp']),
  ('dawah-cards', 'dawah-cards', false, 12582912, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create or replace function private.dawah_card_assert_staff(p_actor uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_role text;
begin
  select role into v_role from private.dawah_staff_roles where user_id = p_actor;
  if v_role is null or v_role not in ('admin', 'moderator') then
    raise exception 'staff access required' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- Change-detection hash of every field a card can render. If the editorial record changes after
-- a card is exported, the card is reported as stale and cannot be approved until re-saved.
create or replace function private.dawah_card_content_hash(q private.dawah_content_queue)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select pg_catalog.md5(
    coalesce(q.arabic_text, '') || '|' || coalesce(q.bengali_translation, '') || '|' ||
    coalesce(q.commentary, '') || '|' || coalesce(q.card_text, '') || '|' ||
    coalesce(q.reference_text, '') || '|' || coalesce(q.arabic_source, '') || '|' ||
    coalesce(q.translation_source, '')
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Content lookup (read-only; the queue can hold thousands of rows, the dashboard shows 100)
-- ---------------------------------------------------------------------------------------------
create or replace function public.dawah_card_content_search(
  p_actor uuid, p_source text, p_sequence integer, p_query text, p_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  perform private.dawah_card_assert_staff(p_actor);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), '[]'::jsonb) into v_result
  from (
    select q.id, q.content_type, q.source_name, q.sequence_no, q.reference_text, q.status,
           pg_catalog.left(q.bengali_translation, 140) as translation_preview,
           (select pg_catalog.count(*) from private.dawah_photocards c where c.content_id = q.id) as card_count
    from private.dawah_content_queue q
    where (nullif(p_source, '') is null or q.source_name = p_source)
      and (p_sequence is null or q.sequence_no = p_sequence)
      and (nullif(p_query, '') is null
           or q.reference_text ilike '%' || p_query || '%'
           or q.bengali_translation ilike '%' || p_query || '%')
    order by q.source_name, q.sequence_no
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) r;
  return v_result;
end;
$$;

create or replace function public.dawah_card_content_get(p_actor uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  q private.dawah_content_queue%rowtype;
begin
  perform private.dawah_card_assert_staff(p_actor);
  select * into q from private.dawah_content_queue where id = p_id;
  if not found then
    raise exception 'content not found' using errcode = 'P0002';
  end if;
  return pg_catalog.jsonb_build_object(
    'id', q.id, 'content_type', q.content_type, 'source_name', q.source_name,
    'sequence_no', q.sequence_no, 'arabic_text', q.arabic_text,
    'bengali_translation', q.bengali_translation, 'commentary', q.commentary,
    'card_text', q.card_text, 'reference_text', q.reference_text, 'status', q.status,
    'arabic_source', q.arabic_source, 'translation_source', q.translation_source,
    'content_hash', private.dawah_card_content_hash(q)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Image library
-- ---------------------------------------------------------------------------------------------
create or replace function public.dawah_card_library_add(p_actor uuid, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row private.dawah_image_library%rowtype;
begin
  perform private.dawah_card_assert_staff(p_actor);
  if nullif(p_row->>'storage_path', '') is null or coalesce(p_row->>'source', '') not in ('ai', 'upload') then
    raise exception 'storage_path and a valid source are required' using errcode = '22023';
  end if;
  insert into private.dawah_image_library (
    storage_path, source, subject, prompt, model, content_id, width, height, mime_type, created_by
  ) values (
    p_row->>'storage_path', p_row->>'source', nullif(p_row->>'subject', ''),
    nullif(p_row->>'prompt', ''), nullif(p_row->>'model', ''),
    nullif(p_row->>'content_id', '')::uuid,
    nullif(p_row->>'width', '')::integer, nullif(p_row->>'height', '')::integer,
    nullif(p_row->>'mime_type', ''), p_actor
  )
  on conflict (storage_path) do update set subject = excluded.subject
  returning * into v_row;
  return pg_catalog.to_jsonb(v_row);
end;
$$;

create or replace function public.dawah_card_library_list(
  p_actor uuid, p_limit integer default 60, p_content_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  perform private.dawah_card_assert_staff(p_actor);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select i.*, q.reference_text as content_reference
    from private.dawah_image_library i
    left join private.dawah_content_queue q on q.id = i.content_id
    where (p_content_id is null or i.content_id = p_content_id)
    order by i.created_at desc
    limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ) l;
  return v_result;
end;
$$;

-- Cost guard: number of AI images this account generated in the last hour.
create or replace function public.dawah_card_ai_recent_count(p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_count integer;
begin
  perform private.dawah_card_assert_staff(p_actor);
  select pg_catalog.count(*)::integer into v_count
  from private.dawah_image_library
  where source = 'ai' and created_by = p_actor and created_at > pg_catalog.now() - interval '1 hour';
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Photo cards
-- ---------------------------------------------------------------------------------------------
create or replace function public.dawah_card_save(p_actor uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_content uuid := nullif(p_payload->>'content_id', '')::uuid;
  v_status text := coalesce(nullif(p_payload->>'status', ''), 'draft');
  v_card private.dawah_photocards%rowtype;
  v_q private.dawah_content_queue%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  perform private.dawah_card_assert_staff(p_actor);
  -- scheduled/published/approved are reached only through dedicated paths, never via save.
  if v_status not in ('draft', 'generating_image', 'designing', 'ready_for_review', 'failed') then
    raise exception 'status % cannot be set by save', v_status using errcode = '22023';
  end if;
  if coalesce(p_payload->>'size_key', 'square') not in ('square', 'portrait', 'landscape') then
    raise exception 'invalid size_key' using errcode = '22023';
  end if;

  if v_id is null then
    if v_content is null then
      raise exception 'content_id is required' using errcode = '22023';
    end if;
    select * into v_q from private.dawah_content_queue where id = v_content;
    if not found then
      raise exception 'content not found' using errcode = 'P0002';
    end if;
    insert into private.dawah_photocards (
      content_id, status, template, size_key, layout, image_id, png_path, jpg_path,
      content_hash, error_message, attempts, created_by
    ) values (
      v_content, v_status, coalesce(nullif(p_payload->>'template', ''), 'ivory'),
      coalesce(p_payload->>'size_key', 'square'),
      coalesce(p_payload->'layout', '{}'::jsonb),
      nullif(p_payload->>'image_id', '')::uuid,
      nullif(p_payload->>'png_path', ''), nullif(p_payload->>'jpg_path', ''),
      private.dawah_card_content_hash(v_q),
      case when v_status = 'failed' then nullif(p_payload->>'error', '') else null end,
      case when v_status = 'generating_image' then 1 else 0 end,
      p_actor
    ) returning * into v_card;
    insert into private.dawah_moderator_activity (actor_user_id, content_id, action, details)
    values (p_actor, v_content, 'create', pg_catalog.jsonb_build_object('area', 'photocard', 'card_id', v_card.id));
  else
    select * into v_card from private.dawah_photocards where id = v_id for update;
    if not found then
      raise exception 'photo card not found' using errcode = 'P0002';
    end if;
    if v_card.status in ('scheduled', 'published') then
      raise exception 'a scheduled or published card is locked' using errcode = '42501';
    end if;
    select * into v_q from private.dawah_content_queue where id = v_card.content_id;
    update private.dawah_photocards set
      status = v_status,
      template = coalesce(nullif(p_payload->>'template', ''), template),
      size_key = coalesce(nullif(p_payload->>'size_key', ''), size_key),
      layout = case when p_payload ? 'layout' then p_payload->'layout' else layout end,
      image_id = case when p_payload ? 'image_id' then nullif(p_payload->>'image_id', '')::uuid else image_id end,
      png_path = case when p_payload ? 'png_path' then nullif(p_payload->>'png_path', '') else png_path end,
      jpg_path = case when p_payload ? 'jpg_path' then nullif(p_payload->>'jpg_path', '') else jpg_path end,
      content_hash = case when v_status = 'ready_for_review' then private.dawah_card_content_hash(v_q) else content_hash end,
      error_message = case when v_status = 'failed' then nullif(p_payload->>'error', '') else null end,
      attempts = case when v_status = 'generating_image' then attempts + 1 else attempts end,
      approved_by = null, approved_at = null,   -- any edit requires a fresh approval
      updated_at = v_now
    where id = v_id returning * into v_card;
    insert into private.dawah_moderator_activity (actor_user_id, content_id, action, details)
    values (p_actor, v_card.content_id, 'edit',
            pg_catalog.jsonb_build_object('area', 'photocard', 'card_id', v_card.id, 'status', v_status));
  end if;
  return pg_catalog.to_jsonb(v_card);
end;
$$;

create or replace function public.dawah_card_set_status(
  p_actor uuid, p_id uuid, p_status text, p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_card private.dawah_photocards%rowtype;
  v_q private.dawah_content_queue%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  perform private.dawah_card_assert_staff(p_actor);
  if p_status not in ('approved', 'ready_for_review', 'failed', 'draft') then
    raise exception 'status % cannot be set here', p_status using errcode = '22023';
  end if;
  select * into v_card from private.dawah_photocards where id = p_id for update;
  if not found then
    raise exception 'photo card not found' using errcode = 'P0002';
  end if;
  if v_card.status in ('scheduled', 'published') then
    raise exception 'a scheduled or published card is locked' using errcode = '42501';
  end if;
  select * into v_q from private.dawah_content_queue where id = v_card.content_id;

  if p_status = 'approved' then
    if v_card.status <> 'ready_for_review' then
      raise exception 'only a card that is ready for review can be approved' using errcode = '22023';
    end if;
    if v_card.png_path is null or v_card.jpg_path is null then
      raise exception 'export files are missing; save the card first' using errcode = '22023';
    end if;
    if v_card.content_hash is distinct from private.dawah_card_content_hash(v_q) then
      raise exception 'the source record changed after this card was exported; re-save the card' using errcode = '22023';
    end if;
    update private.dawah_photocards set status = 'approved', approved_by = p_actor, approved_at = v_now,
      error_message = null, updated_at = v_now where id = p_id returning * into v_card;
    insert into private.dawah_moderator_activity (actor_user_id, content_id, action, details)
    values (p_actor, v_card.content_id, 'approve', pg_catalog.jsonb_build_object('area', 'photocard', 'card_id', p_id));
  else
    update private.dawah_photocards set status = p_status, approved_by = null, approved_at = null,
      error_message = case when p_status = 'failed' then nullif(p_error, '') else null end,
      updated_at = v_now where id = p_id returning * into v_card;
    insert into private.dawah_moderator_activity (actor_user_id, content_id, action, details)
    values (p_actor, v_card.content_id, case when p_status = 'draft' then 'retry' else 'edit' end,
            pg_catalog.jsonb_build_object('area', 'photocard', 'card_id', p_id, 'status', p_status));
  end if;
  return pg_catalog.to_jsonb(v_card);
end;
$$;

create or replace function public.dawah_card_list(
  p_actor uuid, p_content_id uuid default null, p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  perform private.dawah_card_assert_staff(p_actor);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
  into v_result
  from (
    select c.id, c.content_id, c.status, c.template, c.size_key, c.layout, c.image_id,
           c.png_path, c.jpg_path, c.error_message, c.attempts, c.approved_at,
           c.created_at, c.updated_at,
           q.source_name, q.sequence_no, q.reference_text,
           (c.content_hash is distinct from private.dawah_card_content_hash(q)) as stale
    from private.dawah_photocards c
    join private.dawah_content_queue q on q.id = c.content_id
    where (p_content_id is null or c.content_id = p_content_id)
    order by c.updated_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) x;
  return v_result;
end;
$$;

-- Lock everything down: service role only (called by the dawah-card-api Edge Function).
revoke all on function private.dawah_card_assert_staff(uuid) from public, anon, authenticated;
revoke all on function private.dawah_card_content_hash(private.dawah_content_queue) from public, anon, authenticated;
revoke all on function public.dawah_card_content_search(uuid, text, integer, text, integer) from public, anon, authenticated;
revoke all on function public.dawah_card_content_get(uuid, uuid) from public, anon, authenticated;
revoke all on function public.dawah_card_library_add(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dawah_card_library_list(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.dawah_card_ai_recent_count(uuid) from public, anon, authenticated;
revoke all on function public.dawah_card_save(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dawah_card_set_status(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.dawah_card_list(uuid, uuid, integer) from public, anon, authenticated;

grant usage on schema private to service_role;
grant execute on function private.dawah_card_assert_staff(uuid) to service_role;
grant execute on function private.dawah_card_content_hash(private.dawah_content_queue) to service_role;
grant execute on function public.dawah_card_content_search(uuid, text, integer, text, integer) to service_role;
grant execute on function public.dawah_card_content_get(uuid, uuid) to service_role;
grant execute on function public.dawah_card_library_add(uuid, jsonb) to service_role;
grant execute on function public.dawah_card_library_list(uuid, integer, uuid) to service_role;
grant execute on function public.dawah_card_ai_recent_count(uuid) to service_role;
grant execute on function public.dawah_card_save(uuid, jsonb) to service_role;
grant execute on function public.dawah_card_set_status(uuid, uuid, text, text) to service_role;
grant execute on function public.dawah_card_list(uuid, uuid, integer) to service_role;
