-- Add covering indexes for foreign keys flagged by Supabase performance advisors.
create index if not exists dawah_content_queue_created_by_idx
  on private.dawah_content_queue (created_by);
create index if not exists dawah_content_queue_reviewed_by_idx
  on private.dawah_content_queue (reviewed_by);
create index if not exists dawah_image_library_created_by_idx
  on private.dawah_image_library (created_by);
create index if not exists dawah_moderator_activity_actor_user_id_idx
  on private.dawah_moderator_activity (actor_user_id);
create index if not exists dawah_moderator_activity_content_id_idx
  on private.dawah_moderator_activity (content_id);
create index if not exists dawah_photocards_approved_by_idx
  on private.dawah_photocards (approved_by);
create index if not exists dawah_photocards_created_by_idx
  on private.dawah_photocards (created_by);
create index if not exists dawah_photocards_image_id_idx
  on private.dawah_photocards (image_id);
create index if not exists autopost_log_slot_id_idx
  on public.autopost_log (slot_id);

-- The unique constraint already owns an identical index; this extra standalone index is redundant.
drop index if exists private.dawah_content_queue_source_sequence_uidx;
