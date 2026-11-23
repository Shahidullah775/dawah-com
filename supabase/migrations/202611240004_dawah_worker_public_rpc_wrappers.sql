-- Expose narrowly scoped worker RPC wrappers through the public Data API.
-- The underlying queue tables and private schema remain unexposed.
grant usage on schema private to service_role;

create or replace function public.dawah_worker_claim(p_slot_id text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.dawah_claim_next_content(p_slot_id);
$$;

create or replace function public.dawah_worker_record_post(
  p_queue_id uuid, p_claim_token uuid, p_facebook_post_id text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.dawah_record_post(p_queue_id, p_claim_token, p_facebook_post_id);
$$;

create or replace function public.dawah_worker_record_comment(
  p_queue_id uuid, p_claim_token uuid, p_comment_number integer, p_facebook_comment_id text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.dawah_record_comment(p_queue_id, p_claim_token, p_comment_number, p_facebook_comment_id);
$$;

create or replace function public.dawah_worker_release(
  p_queue_id uuid, p_claim_token uuid, p_error text
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.dawah_release_content_claim(p_queue_id, p_claim_token, p_error);
$$;

revoke all on function public.dawah_worker_claim(text) from public, anon, authenticated;
revoke all on function public.dawah_worker_record_post(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.dawah_worker_record_comment(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.dawah_worker_release(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.dawah_worker_claim(text) to service_role;
grant execute on function public.dawah_worker_record_post(uuid, uuid, text) to service_role;
grant execute on function public.dawah_worker_record_comment(uuid, uuid, integer, text) to service_role;
grant execute on function public.dawah_worker_release(uuid, uuid, text) to service_role;
