-- Website publishing for approved photo cards (additive; does not touch the publishing queue,
-- worker or Facebook flow).
alter table private.dawah_photocards
  add column if not exists website_published_at timestamptz,
  add column if not exists website_published_by uuid;

-- A card leaves the website automatically if it stops being approved or its exported files change.
create or replace function private.dawah_card_clear_website()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  if new.status <> 'approved'
     or new.png_path is distinct from old.png_path
     or new.jpg_path is distinct from old.jpg_path then
    new.website_published_at := null;
    new.website_published_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists dawah_card_clear_website on private.dawah_photocards;
create trigger dawah_card_clear_website
  before update on private.dawah_photocards
  for each row execute function private.dawah_card_clear_website();

create or replace function public.dawah_card_website_publish(p_actor uuid, p_id uuid, p_publish boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_card private.dawah_photocards%rowtype;
  v_q private.dawah_content_queue%rowtype;
begin
  perform private.dawah_card_assert_staff(p_actor);
  select * into v_card from private.dawah_photocards where id = p_id for update;
  if not found then
    raise exception 'photo card not found' using errcode = 'P0002';
  end if;
  if p_publish then
    select * into v_q from private.dawah_content_queue where id = v_card.content_id;
    if v_card.status <> 'approved' then
      raise exception 'only an approved card can be published on the website' using errcode = '22023';
    end if;
    if v_card.content_hash is distinct from private.dawah_card_content_hash(v_q) then
      raise exception 'the source record changed after export; re-save and re-approve the card' using errcode = '22023';
    end if;
    update private.dawah_photocards set website_published_at = pg_catalog.now(), website_published_by = p_actor
      where id = p_id returning * into v_card;
  else
    update private.dawah_photocards set website_published_at = null, website_published_by = null
      where id = p_id returning * into v_card;
  end if;
  insert into private.dawah_moderator_activity (actor_user_id, content_id, action, details)
  values (p_actor, v_card.content_id, 'edit',
          pg_catalog.jsonb_build_object('area', 'photocard', 'card_id', p_id, 'website_publish', p_publish));
  return pg_catalog.to_jsonb(v_card);
end;
$$;

-- Public listing, called only by the dawah-public-cards Edge Function (service role).
create or replace function public.dawah_public_cards(p_limit integer default 24)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.website_published_at desc), '[]'::jsonb)
  from (
    select c.id, c.size_key, c.png_path, c.jpg_path, c.website_published_at,
           q.content_type, q.source_name, q.sequence_no, q.reference_text, q.arabic_text, q.bengali_translation
    from private.dawah_photocards c
    join private.dawah_content_queue q on q.id = c.content_id
    where c.status = 'approved' and c.website_published_at is not null
      and c.content_hash = private.dawah_card_content_hash(q)
    order by c.website_published_at desc
    limit least(greatest(coalesce(p_limit, 24), 1), 60)
  ) x;
$$;

-- Same list as before plus the website flag.
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
           c.png_path, c.jpg_path, c.error_message, c.attempts, c.approved_at, c.website_published_at,
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

revoke all on function private.dawah_card_clear_website() from public, anon, authenticated;
revoke all on function public.dawah_card_website_publish(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.dawah_public_cards(integer) from public, anon, authenticated;
revoke all on function public.dawah_card_list(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.dawah_card_website_publish(uuid, uuid, boolean) to service_role;
grant execute on function public.dawah_public_cards(integer) to service_role;
grant execute on function public.dawah_card_list(uuid, uuid, integer) to service_role;
