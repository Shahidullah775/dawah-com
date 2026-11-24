-- Read-only lookup used by the dawah-card-for-post Edge Function (service role only).
-- Returns the newest APPROVED photo card for a queue item whose source record has not changed since
-- export. It never modifies anything and does not touch the claim/record/confirm flow.
create or replace function public.dawah_worker_card_for_queue(p_queue_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce((
    select pg_catalog.jsonb_build_object('card_id', c.id, 'png_path', c.png_path, 'jpg_path', c.jpg_path,
                                         'size_key', c.size_key, 'approved_at', c.approved_at)
    from private.dawah_photocards c
    join private.dawah_content_queue q on q.id = c.content_id
    where c.content_id = p_queue_id and c.status = 'approved' and c.png_path is not null
      and c.content_hash = private.dawah_card_content_hash(q)
    order by c.approved_at desc nulls last
    limit 1
  ), '{}'::jsonb);
$$;
revoke all on function public.dawah_worker_card_for_queue(uuid) from public, anon, authenticated;
grant execute on function public.dawah_worker_card_for_queue(uuid) to service_role;
