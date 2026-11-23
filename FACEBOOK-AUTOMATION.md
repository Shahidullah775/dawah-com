# Dawah.com Facebook Automation — Implementation Status

Last verified: 2026-11-24

## Confirmed working
- Facebook Page: Dawah.com (Page ID: 1474802262379886).
- Authorized Make Facebook Pages connection is healthy.
- Page info check confirms can_post=true and is_published=true.
- Test post exists: 1474802262379886_122095983891564645.
- Comment successfully created on that post: 122095983891564645_1642715614007170.
- Make scenario 8764810 ("Dawah.com – Approved Test Post and Comment") is on-demand only; it is a test, not the production scheduler.

## Current safety state
- Supabase private.dawah_settings: publishing_mode=auto, timezone=Asia/Dhaka, automation_enabled=false.
- Production content queue currently has no verified seed records (must be populated and reviewed before launch).
- autopost_slots are enabled in the database, but they do not schedule or publish on their own.
- pg_cron and pg_net are not enabled in the Supabase project.
- Do not turn on automation until the scheduled worker, secure server-side Facebook credential path, verified content, comments, sequence confirmation and failure recovery are implemented and tested.
- Queue currently contains 0 records; no real Quran/Hadith content has been inserted.

## Intended daily schedule (Asia/Dhaka)
- Quran shared stream: 05:45, 16:45, 20:45.
- Sahih al-Bukhari: 09:00.
- Sahih Muslim: 13:45.
- Jami at-Tirmidhi: 18:15.

## Required implementation before launch
1. Configure a secure server-side Facebook Page credential for the publisher. Never put tokens in browser code, Git, logs or chat.
2. Implement an authenticated scheduled worker that reads only reviewed/approved content for the exact next sequence.
3. Publish the Page post, then publish the planned tafsir/sharh and source-link comments.
4. Call public.dawah_confirm_publish only after the post and required comments succeed; never fabricate a Facebook post ID.
5. Add idempotency, retry/backoff, run locking, error logging and pause/resume checks. (Database claim/record/release primitives have now been added; the scheduled orchestration and full retry flow remain to be built.)
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
