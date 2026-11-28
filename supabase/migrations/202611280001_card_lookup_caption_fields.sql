-- Also return the Bengali text and reference so the caption can be built server-side (cleaned there).
create or replace function public.dawah_worker_card_for_queue(p_queue_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, public, private as $$
  select coalesce((
    select pg_catalog.jsonb_build_object('card_id', c.id, 'png_path', c.png_path, 'jpg_path', c.jpg_path,
                                         'size_key', c.size_key, 'approved_at', c.approved_at,
                                         'bengali', q.bengali_translation, 'reference', q.reference_text)
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
