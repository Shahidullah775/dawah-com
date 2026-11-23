-- Require real Facebook post and both required comments before advancing a Dawah.com sequence.
create or replace function public.dawah_confirm_publish(p_queue_id uuid, p_slot_id text, p_facebook_post_id text)
returns jsonb language plpgsql set search_path = '' as $$
declare q record; s record; v_now timestamptz := pg_catalog.now();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'service role required'; end if;
  if p_facebook_post_id is null or pg_catalog.length(pg_catalog.btrim(p_facebook_post_id)) = 0 then
    raise exception 'Facebook post ID is required';
  end if;
  select * into q from private.dawah_content_queue where id=p_queue_id for update;
  if not found then raise exception 'Queue item not found'; end if;
  if q.status='published' and q.external_post_id=p_facebook_post_id then
    return pg_catalog.jsonb_build_object('success',true,'already_published',true,'queue_id',q.id);
  end if;
  if q.status not in ('approved','scheduled') then raise exception 'Only approved or scheduled content can be published'; end if;
  if q.external_post_id is distinct from p_facebook_post_id then raise exception 'Facebook post ID has not been recorded for this queue item'; end if;
  if q.external_comment_one_id is null or q.external_comment_two_id is null then
    raise exception 'Both required Facebook comments must be recorded before confirming publication';
  end if;
  select * into s from public.autopost_slots where id=p_slot_id for update;
  if not found then raise exception 'Publishing slot not found'; end if;
  if s.enabled is not true then raise exception 'Publishing slot is disabled'; end if;
  if q.source_name<>s.source_name or q.sequence_no<>s.next_sequence then
    raise exception 'Sequence mismatch: expected % for %, got %',s.next_sequence,s.source_name,q.sequence_no;
  end if;
  if exists(select 1 from public.dawah_public_content where source_name=q.source_name and sequence_no=q.sequence_no and is_published=true) then
    raise exception 'This sequence has already been published';
  end if;
  insert into public.dawah_public_content(content_type,source_name,sequence_no,arabic_text,bengali_translation,commentary,reference_text,card_text,is_published,published_at)
  values(q.content_type,q.source_name,q.sequence_no,q.arabic_text,q.bengali_translation,
    pg_catalog.concat_ws(E'\n\n',q.tafsir_ibn_kathir,q.tafhimul_quran,q.explanation_one,q.explanation_two),
    q.reference_text,q.card_text,true,v_now)
  on conflict(source_name,sequence_no) do update set is_published=true,published_at=excluded.published_at
    where public.dawah_public_content.is_published=false;
  update private.dawah_content_queue set status='published',published_at=v_now,worker_claim_token=null,worker_claimed_at=null,updated_at=v_now where id=p_queue_id;
  update public.autopost_slots set next_sequence=next_sequence+1,updated_at=v_now where id=p_slot_id;
  insert into public.autopost_log(slot_id,sequence_no,reference,post_text,commentary,facebook_post_id,status,created_at)
  values(p_slot_id,q.sequence_no,q.reference_text,q.card_text,
    pg_catalog.concat_ws(E'\n\n',q.tafsir_ibn_kathir,q.tafhimul_quran,q.explanation_one,q.explanation_two),
    p_facebook_post_id,'success',v_now);
  return pg_catalog.jsonb_build_object('success',true,'queue_id',p_queue_id,'slot_id',p_slot_id,'sequence_no',q.sequence_no,'facebook_post_id',p_facebook_post_id);
end; $$;
revoke all on function public.dawah_confirm_publish(uuid,text,text) from public,anon,authenticated;
grant execute on function public.dawah_confirm_publish(uuid,text,text) to service_role;
