# Dawah.com Facebook Automation — Implementation Status

Last verified: 2026-11-24

## Confirmed working
- Facebook Page: Dawah.com (Page ID: 1474802262379886).
- Authorized Make Facebook Pages connection is healthy.
- Page info check confirms can_post=true and is_published=true.
- Test post exists: 1474802262379886_122095983891564645.
- Comment successfully created on that post: 122095983891564645_1642715614007170.
- Make scenario 8764810 ("Dawah.com – Approved Test Post and Comment") is on-demand only; it is a test, not the production scheduler.
- Supabase Edge Function `dawah-autopost-worker` is deployed (version 1), with `verify_jwt=false` and mandatory custom header authentication.

## Current safety state
- Supabase private.dawah_settings: publishing_mode=auto, timezone=Asia/Dhaka, automation_enabled=false.
- Production content queue currently has no verified seed records (must be populated and reviewed before launch).
- autopost_slots are enabled in the database, but they do not schedule or publish on their own.
- pg_cron and pg_net are not enabled in the Supabase project.
- Worker currently fails closed until the owner configures `DAWAH_WORKER_SECRET` (minimum 32 characters) in Supabase Edge Function Secrets and stores the same value in a secure Make HTTP connection/header. Do not send the secret through chat or commit it.
- Do not turn on automation until the scheduled orchestration, secure server-side Facebook credential path, verified content, comments, sequence confirmation and failure recovery are implemented and tested.
- Queue currently contains 0 records; no real Quran/Hadith content has been inserted.

## Intended daily schedule (Asia/Dhaka)
- Quran shared stream: 05:45, 16:45, 20:45.
- Sahih al-Bukhari: 09:00.
- Sahih Muslim: 13:45.
- Jami at-Tirmidhi: 18:15.

## Worker API
Endpoint: `https://hcanzohgtnzhchjnwfdw.supabase.co/functions/v1/dawah-autopost-worker`

Every request must be POST JSON and include `x-dawah-worker-secret`. Supported operations:
- `{"op":"claim","slot_id":"quran_stream"}` (also `bukhari`, `dhuhr_muslim`, `tirmidhi`). Claim RPC only returns an item when automation is enabled and the exact Asia/Dhaka slot time matches.
- `{"op":"record_post","queue_id":"...","claim_token":"...","facebook_post_id":"..."}`
- `{"op":"record_comment","queue_id":"...","claim_token":"...","comment_number":1,"facebook_comment_id":"..."}` (comment_number 1 or 2)
- `{"op":"confirm","queue_id":"...","slot_id":"...","facebook_post_id":"..."}` (only succeeds after both comment IDs are recorded)
- `{"op":"release","queue_id":"...","claim_token":"...","error_message":"..."}`

The Worker uses the server-side Supabase service-role key from the Edge Function environment; no service-role credential is exposed to Make or the browser. It rejects requests until `DAWAH_WORKER_SECRET` is set. Never put the secret in source control or chat.

## Required implementation before launch
1. Configure `DAWAH_WORKER_SECRET` in Supabase Dashboard > Edge Functions > Secrets. Use a long random value (at least 32 characters). Add the same value to a secure Make HTTP API-key/header connection for the Dawah worker; do not paste it into scenario text fields or Git.
2. Build and activate the scheduled Make orchestration for the six daily times, using the existing Facebook Pages connection 13348261.
3. Publish the Page post, then publish the planned tafsir/sharh and source-link comments. Reuse recorded post/comment IDs on retries; never create duplicates when an ID is already recorded.
4. Call `public.dawah_confirm_publish` only after the post and required comments succeed; never fabricate a Facebook post ID.
5. Add idempotency, retry/backoff, run locking, error logging and pause/resume checks. Database claim/record/release primitives are in place; scheduled orchestration and full retry flow remain to be built.
6. Seed verified Quran and hadith source records with provenance and permitted translation/commentary use.
7. Run a controlled end-to-end test, verify the sequence advances only after full success, then explicitly enable automation.

## Editorial rules
- Never invent Quran text, hadith text, translations, references, tafsir or attribution.
- Quran caption: full Arabic verse and full Bengali translation with surah/ayah reference.
- Quran comments: Tafsir Ibn Kathir and Tafhim-ul-Quran explanations/authorized excerpts, plus two source links; other reputable tafsir links may be added occasionally.
- Hadith caption: full Arabic and Bengali translation with collection/reference.
- Hadith comments: two reliable sharh/explanation comments and two source links.
- Respect copyright/licensing; do not reproduce long copyrighted translations/commentaries without permission.
- Photo-card work is deferred. Keep the approved minimal white editorial style and subject-relevant imagery when resumed.

## Current database findings
- Queue columns now additionally include tafsir_ibn_kathir, tafhimul_quran, explanation_one, explanation_two, source_links, translation_source, arabic_source, external_comment_one_id, external_comment_two_id, worker_claim_token, worker_claimed_at, publish_attempts and last_publish_attempt_at.
- Added private RPCs: dawah_claim_next_content, dawah_record_post, dawah_record_comment and dawah_release_content_claim. They are executable by service_role only; authenticated users cannot execute them.
- Strengthened public.dawah_confirm_publish: it now requires a real recorded Facebook post ID and both recorded comment IDs before marking the item published or advancing the sequence. It is service_role-only.
- Current schedule slots are enabled: Quran 05:45,16:45,20:45; Bukhari 09:00; Muslim 13:45; Tirmidhi 18:15.
- The confirmation RPC public.dawah_confirm_publish exists and must only be called with a genuine Facebook post ID after successful publication.
- Security audit: public.dawah_confirm_publish runs as SECURITY INVOKER, owned by postgres; service_role has the required table privileges and can execute it, while authenticated cannot. Do not change it to SECURITY DEFINER.
