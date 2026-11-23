-- Dawah.com worker queue metadata and guarded claim/record RPCs
alter table private.dawah_content_queue
  add column if not exists tafsir_ibn_kathir text,
  add column if not exists tafhimul_quran text,
  add column if not exists explanation_one text,
  add column if not exists explanation_two text,
  add column if not exists source_links text[] not null default '{}',
  add column if not exists translation_source text,
  add column if not exists arabic_source text,
  add column if not exists external_comment_one_id text,
  add column if not exists external_comment_two_id text,
  add column if not exists worker_claim_token uuid,
  add column if not exists worker_claimed_at timestamptz,
  add column if not exists publish_attempts integer not null default 0,
  add column if not exists last_publish_attempt_at timestamptz;

create index if not exists dawah_queue_worker_pick_idx
  on private.dawah_content_queue (source_name, sequence_no, status, scheduled_at);

create or replace function private.dawah_claim_next_content(p_slot_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_slot record;
  v_item record;
  v_now timestamptz := pg_catalog.now();
  v_clock text := pg_catalog.to_char(pg_catalog.now() at time zone 'Asia/Dhaka', 'HH24:MI');
  v_token uuid := pg_catalog.gen_random_uuid();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service role required'; end if;
  if not exists (select 1 from private.dawah_settings where automation_enabled = true and timezone = 'Asia/Dhaka') then
    return pg_catalog.jsonb_build_object('status', 'paused');
  end if;
  select * into v_slot from public.autopost_slots where id = p_slot_id and enabled = true for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'slot_disabled_or_missing'); end if;
  if not (v_clock = any(pg_catalog.string_to_array(v_slot.schedule_time, ','))) then
    return pg_catalog.jsonb_build_object('status', 'not_scheduled_now', 'clock', v_clock);
  end if;
  select * into v_item from private.dawah_content_queue q
  where q.source_name = v_slot.source_name and q.sequence_no = v_slot.next_sequence
    and q.status in ('approved', 'scheduled') and (q.scheduled_at is null or q.scheduled_at <= v_now)
    and (q.worker_claimed_at is null or q.worker_claimed_at < v_now - interval '15 minutes')
  order by q.created_at limit 1 for update skip locked;
  if not found then return pg_catalog.jsonb_build_object('status', 'no_approved_content', 'expected_sequence', v_slot.next_sequence); end if;
  update private.dawah_content_queue set worker_claim_token = v_token, worker_claimed_at = v_now,
    publish_attempts = publish_attempts + 1, last_publish_attempt_at = v_now, error_message = null, updated_at = v_now
  where id = v_item.id;
  return pg_catalog.jsonb_build_object(
    'status','claimed','queue_id',v_item.id,'claim_token',v_token,'slot_id',p_slot_id,
    'content_type',v_item.content_type,'source_name',v_item.source_name,'sequence_no',v_item.sequence_no,
    'arabic_text',v_item.arabic_text,'bengali_translation',v_item.bengali_translation,
    'reference_text',v_item.reference_text,'card_text',v_item.card_text,
    'tafsir_ibn_kathir',v_item.tafsir_ibn_kathir,'tafhimul_quran',v_item.tafhimul_quran,
    'explanation_one',v_item.explanation_one,'explanation_two',v_item.explanation_two,
    'source_links',v_item.source_links,'translation_source',v_item.translation_source,
    'arabic_source',v_item.arabic_source,'external_post_id',v_item.external_post_id,
    'external_comment_one_id',v_item.external_comment_one_id,'external_comment_two_id',v_item.external_comment_two_id
  );
end; $$;

create or replace function private.dawah_record_post(p_queue_id uuid,p_claim_token uuid,p_facebook_post_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_facebook_post_id is null or pg_catalog.btrim(p_facebook_post_id) = '' then raise exception 'Facebook post ID required'; end if;
  update private.dawah_content_queue set external_post_id=p_facebook_post_id,updated_at=pg_catalog.now()
  where id=p_queue_id and worker_claim_token=p_claim_token and status in ('approved','scheduled')
    and (external_post_id is null or external_post_id=p_facebook_post_id);
  if not found then raise exception 'Claim missing, expired, or post ID conflict'; end if;
  return true;
end; $$;

create or replace function private.dawah_record_comment(p_queue_id uuid,p_claim_token uuid,p_comment_number integer,p_facebook_comment_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_comment_number not in (1,2) or p_facebook_comment_id is null or pg_catalog.btrim(p_facebook_comment_id) = '' then
    raise exception 'Valid comment number and Facebook comment ID required';
  end if;
  if p_comment_number=1 then
    update private.dawah_content_queue set external_comment_one_id=p_facebook_comment_id,updated_at=pg_catalog.now()
    where id=p_queue_id and worker_claim_token=p_claim_token and status in ('approved','scheduled')
      and (external_comment_one_id is null or external_comment_one_id=p_facebook_comment_id);
  else
    update private.dawah_content_queue set external_comment_two_id=p_facebook_comment_id,updated_at=pg_catalog.now()
    where id=p_queue_id and worker_claim_token=p_claim_token and status in ('approved','scheduled')
      and (external_comment_two_id is null or external_comment_two_id=p_facebook_comment_id);
  end if;
  if not found then raise exception 'Claim missing, expired, or comment ID conflict'; end if;
  return true;
end; $$;

create or replace function private.dawah_release_content_claim(p_queue_id uuid,p_claim_token uuid,p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service role required'; end if;
  update private.dawah_content_queue set worker_claim_token=null,worker_claimed_at=null,
    error_message=pg_catalog.left(coalesce(p_error,'Publishing attempt failed'),1000),updated_at=pg_catalog.now()
  where id=p_queue_id and worker_claim_token=p_claim_token and status in ('approved','scheduled');
  return found;
end; $$;

revoke all on function private.dawah_claim_next_content(text) from public,anon,authenticated;
revoke all on function private.dawah_record_post(uuid,uuid,text) from public,anon,authenticated;
revoke all on function private.dawah_record_comment(uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function private.dawah_release_content_claim(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.dawah_claim_next_content(text) to service_role;
grant execute on function private.dawah_record_post(uuid,uuid,text) to service_role;
grant execute on function private.dawah_record_comment(uuid,uuid,integer,text) to service_role;
grant execute on function private.dawah_release_content_claim(uuid,uuid,text) to service_role;
