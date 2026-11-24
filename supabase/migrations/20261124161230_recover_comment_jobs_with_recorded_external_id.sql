create or replace function private.dawah_claim_comment_job()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  j record;
  tok uuid := gen_random_uuid();
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service role required';
  end if;

  select * into j
  from private.dawah_comment_jobs
  where (status = 'pending' and due_at <= now())
     or (status = 'processing' and locked_until < now())
  order by due_at, id
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object('status', 'empty');
  end if;

  -- If Facebook accepted the comment and its ID was already stored, recover
  -- the queue job as posted instead of creating the same comment again.
  if nullif(btrim(coalesce(j.external_comment_id, '')), '') is not null then
    update private.dawah_comment_jobs
    set status = 'posted',
        last_error = null,
        locked_until = null,
        updated_at = now()
    where id = j.id
      and status in ('pending', 'processing');

    return jsonb_build_object(
      'status', 'already_posted',
      'job_id', j.id,
      'external_comment_id', j.external_comment_id
    );
  end if;

  update private.dawah_comment_jobs
  set status = 'processing',
      attempts = attempts + 1,
      locked_until = now() + interval '10 minutes',
      updated_at = now()
  where id = j.id;

  return jsonb_build_object(
    'status', 'claimed',
    'job_id', j.id,
    'queue_id', j.queue_id,
    'facebook_post_id', j.facebook_post_id,
    'comment_number', j.comment_number,
    'comment_text', j.comment_text,
    'attempts', j.attempts + 1
  );
end
$function$;
