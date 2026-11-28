-- Quran comment #1 becomes the Arabic original + links (Bengali is already the full caption).
-- Only the first comment text changes; every other behaviour of confirm_publish_core is unchanged.
create or replace function private.dawah_confirm_publish_core(p_queue_id uuid, p_slot_id text, p_facebook_post_id text)
 returns jsonb language plpgsql set search_path to '' as $function$
declare
  q record; s record; v_now timestamptz := pg_catalog.now(); v_comments text[]; v_commentary text;
  v_translation_url text;
  v_london_translation_url text := 'https://d1.islamhouse.com/data/bn/ih_books/single/bn_bengali_easy_translation_of_holy_quran.pdf';
  v_ibn_kathir_url text; v_tafhim_url text; v_ref_parts text[]; v_ayah_url text; v_first text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'service role required'; end if;
  if p_facebook_post_id is null or pg_catalog.length(pg_catalog.btrim(p_facebook_post_id)) = 0 then
    raise exception 'Facebook post ID is required'; end if;
  select * into q from private.dawah_content_queue where id = p_queue_id for update;
  if not found then raise exception 'Queue item not found'; end if;
  if q.status = 'published' and q.external_post_id = p_facebook_post_id then
    return pg_catalog.jsonb_build_object('success',true,'already_published',true,'queue_id',q.id); end if;
  if q.status not in ('approved','scheduled') then raise exception 'Only approved or scheduled content can be published'; end if;
  if q.external_post_id is distinct from p_facebook_post_id then
    raise exception 'Facebook post ID has not been recorded for this queue item'; end if;
  select * into s from public.autopost_slots where id = p_slot_id for update;
  if not found then raise exception 'Publishing slot not found'; end if;
  if s.enabled is not true then raise exception 'Publishing slot is disabled'; end if;
  if q.source_name <> s.source_name or q.sequence_no <> s.next_sequence then
    raise exception 'Sequence mismatch: expected % for %, got %',s.next_sequence,s.source_name,q.sequence_no; end if;
  if exists(select 1 from public.dawah_public_content
            where source_name=q.source_name and sequence_no=q.sequence_no and is_published=true) then
    raise exception 'This sequence has already been published'; end if;

  if q.content_type = 'quran' then
    select x into v_translation_url from unnest(coalesce(q.source_links, array[]::text[])) as x
      where x ilike '%quranenc.com/api/v1/translation%' limit 1;
    v_ref_parts := pg_catalog.regexp_match(
      pg_catalog.translate(q.reference_text, '০১২৩৪৫৬৭৮৯', '0123456789'), '([0-9]+)[^0-9]+([0-9]+)');
    if v_ref_parts is not null then
      v_ibn_kathir_url := 'https://quran.com/bn/' || v_ref_parts[1] || '%3A' || v_ref_parts[2] || '/tafsirs/bn-tafseer-ibn-e-kaseer';
      v_ayah_url := 'https://quran.com/' || v_ref_parts[1] || ':' || v_ref_parts[2];
    else
      v_ibn_kathir_url := 'https://quran.com/bn/tafsirs';
      v_ayah_url := 'https://quran.com/';
    end if;
    select x into v_tafhim_url from unnest(coalesce(q.source_links, array[]::text[])) as x
      where x ilike '%tafheemulquranbangla.com%' limit 1;
    v_tafhim_url := coalesce(v_tafhim_url, 'https://tafheemulquranbangla.com/tafheem-online/');

    if nullif(pg_catalog.btrim(coalesce(q.arabic_text,'')),'') is not null then
      v_first := q.arabic_text || E'\n\nআরবি মূল পাঠ ও আয়াতের পাতা: ' || v_ayah_url
                 || E'\nঅনুবাদের উৎস: ' || coalesce(v_translation_url,'https://quranenc.com/');
    else  -- never block publishing on a missing Arabic field; keep the previous comment text
      v_first := q.bengali_translation || E'\n\nউৎস: ' || coalesce(v_translation_url,'https://quranenc.com/');
    end if;

    v_comments := array[
      v_first,
      'লন্ডন একাডেমির বাংলা অনুবাদ (হাফেজ মুনির উদ্দিন আহমদ)। প্রকাশকের অনুবাদটি এখানে পড়ুন: ' || v_london_translation_url,
      coalesce(nullif(q.tafsir_ibn_kathir,''),'তাফসির ইবনে কাসিরের আয়াতভিত্তিক ব্যাখ্যা পড়ুন:') || E'\n\nআরও পড়ুন: ' || v_ibn_kathir_url,
      coalesce(nullif(q.tafhimul_quran,''),'তাফহীমুল কুরআনের আয়াতভিত্তিক ব্যাখ্যা পড়ুন:') || E'\n\nআরও পড়ুন: ' || v_tafhim_url
    ];
  else
    v_comments := array[q.explanation_one,q.explanation_two];
  end if;

  perform private.dawah_enqueue_comment_jobs(q.id,p_facebook_post_id,v_comments);
  v_commentary := pg_catalog.concat_ws(E'\n\n',q.tafsir_ibn_kathir,q.tafhimul_quran,q.explanation_one,q.explanation_two);
  insert into public.dawah_public_content(content_type,source_name,sequence_no,arabic_text,bengali_translation,commentary,reference_text,card_text,is_published,published_at)
  values(q.content_type,q.source_name,q.sequence_no,q.arabic_text,q.bengali_translation,v_commentary,q.reference_text,q.card_text,true,v_now)
  on conflict(source_name,sequence_no) do update set is_published=true,published_at=excluded.published_at
    where public.dawah_public_content.is_published=false;
  update private.dawah_content_queue set status='published',published_at=v_now,worker_claim_token=null,worker_claimed_at=null,updated_at=v_now where id=p_queue_id;
  update public.autopost_slots set next_sequence=next_sequence+1,updated_at=v_now where id=p_slot_id;
  insert into public.autopost_log(slot_id,sequence_no,reference,post_text,commentary,facebook_post_id,status,created_at)
  values(p_slot_id,q.sequence_no,q.reference_text,q.card_text,v_commentary,p_facebook_post_id,'success',v_now);
  return pg_catalog.jsonb_build_object('success',true,'queue_id',p_queue_id,'slot_id',p_slot_id,'sequence_no',q.sequence_no,'facebook_post_id',p_facebook_post_id);
end;
$function$;
