# Dawah.com Facebook Automation — Implementation Status

Last verified: 2026-11-24

## Confirmed working
- Facebook Page: Dawah.com (Page ID: 1474802262379886); published and can_post=true.
- Make Facebook Pages connection is healthy (connection 13348261).
- A controlled test post and comment were created successfully; test post ID: 1474802262379886_122095983891564645.
- Worker API test through Make returned HTTP 200 and `{"status":"paused"}`, confirming the authenticated request reached the worker while automation was disabled.
- Supabase Edge Function `dawah-autopost-worker` is ACTIVE, version 7, verify_jwt=false, protected by the `x-dawah-worker-secret` header.
- Make Scheduled Publisher scenario 8765714 is inactive and contains the guarded photocard lookup → CreatePostWithPhotos → record_post → confirm route, plus a no-card release route. Comment Queue Dispatcher scenario 8766765 is active. Worker verification scenario 8765326 and Facebook test scenarios 8764810, 8764707 and 8764674 are inactive.
- GitHub repository: https://github.com/Shahidullah775/dawah-com

## Safety state — do not enable live publishing yet
- Supabase `private.dawah_settings`: publishing_mode=approval, timezone=Asia/Dhaka, automation_enabled=false.
- Production content queue: 3,788 records (3,785 approved, 2 published, 1 failed). The failed record's Facebook post ID is still present only in its error text; do not retry it until that existing post is independently checked.
- Four DB slots are enabled: quran_stream, bukhari, dhuhr_muslim, tirmidhi.
- `pg_cron` is installed in `pg_catalog`; `pg_net` is installed in `public` and is flagged by the Supabase advisor; `supabase_vault` is installed in `vault`.
- Do not enable automation or create live posts until the complete scheduler, source-verified content, retry/idempotency and end-to-end verification are implemented.
- Never share or commit the worker secret or Supabase service-role key. The worker secret is stored in Supabase Edge Function Secrets and the matching Make API-key connection was approved by the owner.

## Daily schedule (Asia/Dhaka)
- Quran shared sequential stream: 05:45, 16:45, 20:45.
- Sahih al-Bukhari: 09:00.
- Sahih Muslim: 13:45.
- Jami at-Tirmidhi: 18:15.

## Quran publishing specification — owner-approved
- The Quran sequence begins at Surah Al-Fatiha 1:1 and proceeds continuously, verse by verse, across the three daily Quran slots.
- The sequence advances only after the Facebook post and every required comment are successfully created, their actual Facebook IDs are recorded, and the database confirmation succeeds.
- Photo card (when card work resumes): Arabic ayah plus a concise, accurate Bengali tafsir/core message; keep the design readable and uncluttered.
- Main caption: Arabic ayah and surah/ayah reference. Include Bengali translation in the caption if it is short enough; otherwise place it in a comment.
- Required Quran comments, each as a separate Facebook comment:
  1. London Academy Bengali Quran translation.
  2. Tafhim-ul-Quran explanation.
  3. Tafsir Ibn Kathir explanation.
  4. A link to another reliable tafsir/source.
  5. A second separate link to another reliable tafsir/source.
- Do not invent Arabic, translation, tafsir, source attribution or URLs. Verify the source text and reference before queueing.
- Copyright: do not reproduce long protected Bengali translations or tafsir passages verbatim without permission or an open licence. Use permitted short excerpts and accurate summaries with links unless reuse rights are verified. Do not label a summary as a verbatim quotation.

## Hadith publishing specification
- Separate sequential streams for Sahih al-Bukhari, Sahih Muslim and Jami at-Tirmidhi at their respective schedule times.
- Caption: verified Arabic hadith text, Bengali translation, collection and exact reference.
- Hadith comments and commentary must be source-verified and rights-cleared. Do not invent narrations, numbering or source links.

## Worker API (deployed version 4)
Endpoint: `https://hcanzohgtnzhchjnwfdw.supabase.co/functions/v1/dawah-autopost-worker`
Every request is POST JSON and must include `x-dawah-worker-secret`.
- `claim`: accepts slot_id quran_stream, bukhari, dhuhr_muslim or tirmidhi.
- `record_post`: records the real Facebook post ID against queue_id and claim_token.
- `record_comment`: accepts comment_number 1 through 5 and records each real Facebook comment ID.
- `confirm`: requires all five recorded comments for Quran items; requires two recorded comments for hadith items. The sequence advances only after confirmation succeeds.
- `release`: releases a failed claim with an error message.

## Verified database changes (migration 005)
- Added `external_comment_three_id`, `external_comment_four_id`, and `external_comment_five_id` to the private queue.
- Extended the private comment-recording RPC to accept comment numbers 1–5 with claim-token and ID-conflict checks.
- Updated `public.dawah_confirm_publish`: Quran requires all five comment IDs; hadith requires two. It remains SECURITY INVOKER and service_role-only.
- Verification confirmed anon and authenticated cannot execute the confirmation function; service_role can. Function security mode is SECURITY INVOKER.
- The private `dawah_record_comment` RPC retains its pre-existing SECURITY DEFINER mode and service_role-only execution. It was not broadened to public roles.
- RLS is enabled on operational tables. Keep private queue and staff tables inaccessible to anon/authenticated; do not loosen policies to make the worker work.

## Remaining implementation
1. Build the scheduled orchestration for all six daily times using the existing Make Facebook and secure worker connections.
2. Add idempotent retry/recovery behavior so recorded post/comment IDs are reused and never duplicated.
3. Verify Quran and hadith source texts, exact references, translation source and copyright/reuse permissions before seeding records.
4. Run an end-to-end test without publishing to the public Page where possible; then perform a specifically approved controlled test.
5. Keep `automation_enabled=false` until the owner explicitly authorizes launch.

## Security notes
- The worker uses the Supabase service-role key only inside its server-side Edge Function environment; never expose it to Make or the browser.
- The worker's custom secret must remain outside GitHub, chat messages and plain scenario fields.
- Do not change `public.dawah_confirm_publish` to SECURITY DEFINER.

## Admin Panel origin fix — 2026-11-24
- The production site domain `https://dawah-com-source.vercel.app` was missing from the CORS allowlists in the deployed admin API and first-admin bootstrap function.
- Updated and redeployed `dawah-admin-api` to ACTIVE version 8 and `dawah-bootstrap-admin` to ACTIVE version 3. The production origin is now explicitly allowed; the moderator invitation redirect and fallback origin use the current production domain.
- Both deployed Edge Function source files are now version-controlled at `supabase/functions/dawah-admin-api/index.ts` and `supabase/functions/dawah-bootstrap-admin/index.ts`.
- Read-back verification confirmed both deployed functions contain the production domain. A full browser login and dashboard interaction test still requires an authenticated admin session and has not yet been completed.

## Retry recovery improvement — 2026-11-24
- Applied database migration `20261123221750_return_all_recorded_comment_ids_from_worker_claim`.
- The worker claim response now returns previously recorded Facebook comment IDs 1–5, in addition to the existing post ID and first two comment IDs. This is required for a retry workflow to detect completed steps and avoid reposting comments that already succeeded.
- Verified the updated private claim function retains its existing SECURITY DEFINER + empty search_path + service_role guard. anon and authenticated cannot execute it; service_role can.
- The database migration is version-controlled in `supabase/migrations/20261123221750_return_all_recorded_comment_ids_from_worker_claim.sql`.
- This improves the recovery data contract; the full Make publisher flow and end-to-end retry test are still pending.


## Admin content editor update — 2026-11-24
- Added separate Admin Panel inputs for Tafhim-ul-Quran, Tafsir Ibn Kathir, two additional editorial/source notes, external tafsir URLs, Bengali translation provenance, and Arabic text source/version.
- Queue create/update now persists these fields to their matching private queue columns; the dashboard RPC returns them so editors can reopen and revise the full record.
- Database migration: `20261123222832_dawah_admin_content_sources_fields` (applied and verified).
- This closes a data-entry gap: the previous form only saved the generic commentary field and silently omitted the dedicated tafsir/source fields needed by the planned comment workflow.
- No production content was inserted. Queue count remains zero, and automation remains disabled.

## Photo card image for Facebook posts — guarded route configured, scenario inactive
- `dawah-card-for-post` is deployed and read-only. It returns a short-lived signed image URL only for the newest approved card whose source record is unchanged.
- Make scenario 8765714 now calls the lookup after a successful queue claim. When `image_url` exists, module 22 (`facebook-pages:CreatePostWithPhotos`) publishes the image with the Bengali caption; the post ID is recorded and the worker confirmation follows. When no approved image exists, module 23 releases the claim without publishing. The old text-only fallback is not used on this route.
- The scenario is still inactive. There are currently zero photo cards, zero approved photo cards, and no verified end-to-end photocard post. Do not activate or publish until an administrator has created and approved a card and the owner authorizes a controlled test.
- A prior failed queue row contains a Facebook post ID in `error_message` but `external_post_id` is null. Do not retry it until the Facebook post is independently checked and the row is reconciled.


## Comment retry recovery — 2026-11-24
- Applied migration `20261124161108_recover_comment_jobs_with_recorded_external_id`.
- If a comment job is reclaimed after its Facebook comment ID was already persisted, the claim RPC now marks it posted and returns `already_posted`; the Make dispatcher only creates a comment for `status=claimed`, so it will not publish that same comment again.
- The function remains SECURITY DEFINER with an empty search_path and an explicit service_role check. Verification confirmed all 8 existing comment jobs are posted and have a Facebook comment ID.
- This closes the retry window after the external comment ID has been saved. A failure between Facebook accepting a comment and the subsequent ID-persistence request still requires reconciliation; no client-side idempotency key is available from Facebook Pages CreateComment.


## Quran reference normalization — 2026-11-24
- Normalized 3,788 Quran queue references to Bengali surah names and ayah numbers using QuranEnc's official Bengali surah-name endpoint (`sowar_names?iso_code=bn`, all 114 names).
- Arabic Quran text and Bengali translation were not changed by this update; only the reference label was normalized.
- Applied migration `20261124161254_normalize_quran_surah_references` so the change is version-controlled and reproducible.
