-- Auto-approved cards carry approval evidence (approved_by = sole admin; flagged auto=true) so they pass private.dawah_validate_card.
-- commit: stores an automatically rendered, gate-passed card as approved. Refuses if the source
-- changed since rendering, if the gate did not pass, or if paths are outside cards/<content_id>/.
create or replace function public.dawah_auto_card_commit(
  p_content_id uuid, p_png_path text, p_jpg_path text, p_expected_hash text, p_gate jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_q private.dawah_content_queue%rowtype; v_card private.dawah_photocards%rowtype; v_admin uuid;
begin
  select user_id into v_admin from private.dawah_staff_roles where role = 'admin' order by user_id limit 1;
  if v_admin is null then raise exception 'no admin to attribute auto-approval' using errcode = '22023'; end if;
  select * into v_q from private.dawah_content_queue where id = p_content_id for update;
  if not found or v_q.status <> 'approved' or v_q.source_name <> 'Quran' then
    raise exception 'content not eligible' using errcode = '22023'; end if;
  if private.dawah_card_content_hash(v_q) is distinct from p_expected_hash then
    raise exception 'source changed during rendering' using errcode = '22023'; end if;
  if coalesce(p_gate->>'ok', '') <> 'true' then raise exception 'gate did not pass' using errcode = '22023'; end if;
  if p_png_path is null or p_jpg_path is null
     or p_png_path not like 'cards/' || p_content_id::text || '/%.png'
     or p_jpg_path not like 'cards/' || p_content_id::text || '/%.jpg' then
    raise exception 'invalid export paths' using errcode = '22023'; end if;
  insert into private.dawah_photocards (content_id, status, template, size_key, layout, png_path, jpg_path,
    content_hash, approved_by, approved_at, attempts)
  values (p_content_id, 'approved', 'auto-bengali', 'square',
    pg_catalog.jsonb_build_object('auto', true, 'gate', p_gate), p_png_path, p_jpg_path,
    private.dawah_card_content_hash(v_q), v_admin, pg_catalog.now(), 0) returning * into v_card;
  insert into private.dawah_moderator_activity (actor_user_id, content_id, action, details)
  values (v_admin, p_content_id, 'approve', pg_catalog.jsonb_build_object('area', 'photocard', 'card_id', v_card.id, 'auto', true));
  return pg_catalog.jsonb_build_object('card_id', v_card.id);
end; $$;
revoke all on function public.dawah_auto_card_commit(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.dawah_auto_card_commit(uuid, text, text, text, jsonb) to service_role;
