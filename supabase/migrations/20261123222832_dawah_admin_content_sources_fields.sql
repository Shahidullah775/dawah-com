-- Extend the admin content editor's database contract to retain all approved Quran commentary and source fields.
CREATE OR REPLACE FUNCTION public.dawah_queue_mutate(p_actor uuid, p_action text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_role text;
  v_mode text;
  v_id uuid;
  v_row private.dawah_content_queue%rowtype;
  v_status text;
  v_source_links text[];
  v_now timestamptz := now();
begin
  select role into v_role from private.dawah_staff_roles where user_id = p_actor;
  if v_role not in ('admin','moderator') then
    raise exception 'staff access required' using errcode = '42501';
  end if;

  if p_payload ? 'source_links' and jsonb_typeof(p_payload->'source_links') <> 'array' then
    raise exception 'source_links must be an array of URLs' using errcode = '22023';
  end if;
  if p_payload ? 'source_links' then
    select coalesce(array_agg(value), '{}'::text[]) into v_source_links
    from jsonb_array_elements_text(p_payload->'source_links') as x(value)
    where trim(value) <> '';
  end if;

  if p_action = 'create' then
    if coalesce(p_payload->>'content_type','') not in ('quran','hadith')
       or nullif(trim(p_payload->>'source_name'),'') is null
       or coalesce((p_payload->>'sequence_no')::integer,0) < 1
       or nullif(trim(p_payload->>'arabic_text'),'') is null
       or nullif(trim(p_payload->>'bengali_translation'),'') is null
       or nullif(trim(p_payload->>'reference_text'),'') is null then
      raise exception 'required content fields missing' using errcode = '22023';
    end if;
    select publishing_mode into v_mode from private.dawah_settings where id=1;
    v_status := case when v_mode='approval' then 'pending_approval' else 'approved' end;
    insert into private.dawah_content_queue(
      content_type, source_name, sequence_no, arabic_text, bengali_translation,
      commentary, reference_text, card_text, status, created_by,
      tafsir_ibn_kathir, tafhimul_quran, explanation_one, explanation_two,
      source_links, translation_source, arabic_source
    ) values (
      p_payload->>'content_type', trim(p_payload->>'source_name'),
      (p_payload->>'sequence_no')::integer, p_payload->>'arabic_text',
      p_payload->>'bengali_translation', nullif(p_payload->>'commentary',''),
      trim(p_payload->>'reference_text'), nullif(p_payload->>'card_text',''),
      v_status, p_actor,
      nullif(p_payload->>'tafsir_ibn_kathir',''),
      nullif(p_payload->>'tafhimul_quran',''),
      nullif(p_payload->>'explanation_one',''),
      nullif(p_payload->>'explanation_two',''),
      coalesce(v_source_links, '{}'::text[]),
      nullif(p_payload->>'translation_source',''),
      nullif(p_payload->>'arabic_source','')
    ) returning * into v_row;
    insert into private.dawah_moderator_activity(actor_user_id,content_id,action,details)
    values (p_actor,v_row.id,'create',jsonb_build_object('status',v_status));
    return to_jsonb(v_row);

  elsif p_action = 'update' then
    v_id := (p_payload->>'id')::uuid;
    select * into v_row from private.dawah_content_queue where id=v_id for update;
    if not found then raise exception 'content not found' using errcode='P0002'; end if;
    if v_row.status in ('published') then raise exception 'published content is locked' using errcode='42501'; end if;
    update private.dawah_content_queue set
      content_type = coalesce(p_payload->>'content_type',content_type),
      source_name = coalesce(nullif(trim(p_payload->>'source_name'),''),source_name),
      sequence_no = coalesce((p_payload->>'sequence_no')::integer,sequence_no),
      arabic_text = coalesce(p_payload->>'arabic_text',arabic_text),
      bengali_translation = coalesce(p_payload->>'bengali_translation',bengali_translation),
      commentary = case when p_payload ? 'commentary' then nullif(p_payload->>'commentary','') else commentary end,
      reference_text = coalesce(nullif(trim(p_payload->>'reference_text'),''),reference_text),
      card_text = case when p_payload ? 'card_text' then nullif(p_payload->>'card_text','') else card_text end,
      tafsir_ibn_kathir = case when p_payload ? 'tafsir_ibn_kathir' then nullif(p_payload->>'tafsir_ibn_kathir','') else tafsir_ibn_kathir end,
      tafhimul_quran = case when p_payload ? 'tafhimul_quran' then nullif(p_payload->>'tafhimul_quran','') else tafhimul_quran end,
      explanation_one = case when p_payload ? 'explanation_one' then nullif(p_payload->>'explanation_one','') else explanation_one end,
      explanation_two = case when p_payload ? 'explanation_two' then nullif(p_payload->>'explanation_two','') else explanation_two end,
      source_links = case when p_payload ? 'source_links' then coalesce(v_source_links, '{}'::text[]) else source_links end,
      translation_source = case when p_payload ? 'translation_source' then nullif(p_payload->>'translation_source','') else translation_source end,
      arabic_source = case when p_payload ? 'arabic_source' then nullif(p_payload->>'arabic_source','') else arabic_source end,
      updated_at = v_now
    where id=v_id returning * into v_row;
    insert into private.dawah_moderator_activity(actor_user_id,content_id,action,details)
    values (p_actor,v_row.id,'edit','{}'::jsonb);
    return to_jsonb(v_row);

  elsif p_action in ('approve','reject') then
    v_id := (p_payload->>'id')::uuid;
    v_status := case when p_action='approve' then 'approved' else 'rejected' end;
    update private.dawah_content_queue set status=v_status, reviewed_by=p_actor,
      reviewed_at=v_now, updated_at=v_now
    where id=v_id and status in ('draft','pending_approval','rejected')
    returning * into v_row;
    if not found then raise exception 'content cannot be reviewed in its current state' using errcode='22023'; end if;
    insert into private.dawah_moderator_activity(actor_user_id,content_id,action,details)
    values (p_actor,v_row.id,p_action,jsonb_build_object('status',v_status));
    return to_jsonb(v_row);

  elsif p_action = 'schedule' then
    v_id := (p_payload->>'id')::uuid;
    if nullif(p_payload->>'scheduled_at','') is null then
      raise exception 'scheduled_at is required' using errcode='22023';
    end if;
    update private.dawah_content_queue set status='scheduled',
      scheduled_at=(p_payload->>'scheduled_at')::timestamptz, updated_at=v_now
    where id=v_id and status in ('approved','draft')
    returning * into v_row;
    if not found then raise exception 'only draft or approved content can be scheduled' using errcode='22023'; end if;
    insert into private.dawah_moderator_activity(actor_user_id,content_id,action,details)
    values (p_actor,v_row.id,'schedule',jsonb_build_object('scheduled_at',v_row.scheduled_at));
    return to_jsonb(v_row);
  else
    raise exception 'unsupported action' using errcode='22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dawah_queue_dashboard(p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_role text;
  v_result jsonb;
begin
  select role into v_role from private.dawah_staff_roles where user_id = p_actor;
  if v_role not in ('admin','moderator') then
    raise exception 'staff access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
      from (
        select id, content_type, source_name, sequence_no, arabic_text,
               bengali_translation, commentary, reference_text, card_text,
               status, created_by, reviewed_by, reviewed_at, scheduled_at,
               published_at, external_post_id, error_message, created_at, updated_at,
               tafsir_ibn_kathir, tafhimul_quran, explanation_one, explanation_two,
               source_links, translation_source, arabic_source
        from private.dawah_content_queue
        order by created_at desc
        limit 100
      ) q
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'draft', (select count(*) from private.dawah_content_queue where status='draft'),
      'pending_approval', (select count(*) from private.dawah_content_queue where status='pending_approval'),
      'approved', (select count(*) from private.dawah_content_queue where status='approved'),
      'scheduled', (select count(*) from private.dawah_content_queue where status='scheduled'),
      'published', (select count(*) from private.dawah_content_queue where status='published'),
      'failed', (select count(*) from private.dawah_content_queue where status='failed')
    ),
    'slots', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.schedule_time)
      from public.autopost_slots s
    ), '[]'::jsonb),
    'recent_logs', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc)
      from (
        select id, slot_id, sequence_no, reference, status, error, created_at
        from public.autopost_log
        order by created_at desc
        limit 20
      ) l
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;