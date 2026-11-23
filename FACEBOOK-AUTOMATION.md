# Dawah.com Facebook Automation — Implementation Status

Last verified: 2026-11-24

## Confirmed working
- Facebook Page: Dawah.com (Page ID: 1474802262379886); published and can_post=true.
- Make Facebook Pages connection is healthy (connection 13348261).
- A controlled test post and comment were created successfully; test post ID: 1474802262379886_122095983891564645.
- Worker API test through Make returned HTTP 200 and `{"status":"paused"}`, confirming the authenticated request reached the worker while automation was disabled.
- Supabase Edge Function `dawah-autopost-worker` is ACTIVE, version 3, verify_jwt=false, protected by the `x-dawah-worker-secret` header.
- Make worker verification scenario 8765326 is active and on-demand. Facebook test scenarios 8764810, 8764707 and 8764674 are inactive. Existing unrelated Make scenario 8543045 remains active and was not changed.
- GitHub repository: https://github.com/Shahidullah775/dawah-com

## Safety state — do not enable live publishing yet
- Supabase `private.dawah_settings`: publishing_mode=auto, timezone=Asia/Dhaka, automation_enabled=false.
- Production content queue: 0 records. Published content: 0 records.
- Four DB slots are enabled: quran_stream, bukhari, dhuhr_muslim, tirmidhi.
- `pg_cron` and `pg_net` are not currently installed/enabled; only `supabase_vault` was found among the checked extensions.
- Do not enable automation or create live posts until the five-comment Quran workflow, source-verified content, complete scheduler, retry/idempotency and end-to-end verification are implemented.
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
- Comments and commentary must be source-verified and rights-cleared. Do not invent narrations, numbering or source links.

## Worker API (current deployed contract)
Endpoint: `https://hcanzohgtnzhchjnwfdw.supabase.co/functions/v1/dawah-autopost-worker`
Every request is POST JSON and must include `x-dawah-worker-secret`.
- `claim`: accepts slot_id quran_stream, bukhari, dhuhr_muslim or tirmidhi.
- `record_post`: records the real Facebook post ID against queue_id and claim_token.
- `record_comment`: currently accepts comment_number 1 or 2 only.
- `confirm`: currently confirms only after both recorded comment IDs exist.
- `release`: releases a failed claim with an error message.
The current worker/database confirmation path supports only two comments. It must be extended to record and require all five Quran comments before the Quran workflow can be considered implemented. Do not work around this by merging comments or skipping items.

## Verified current database structure
- `private.dawah_content_queue` has Arabic text, Bengali translation, tafsir_ibn_kathir, tafhimul_quran, explanation fields, source_links, translation_source, arabic_source, two external comment ID fields, claim token/timestamp and retry counters.
- Public wrappers `dawah_worker_claim`, `dawah_worker_record_post`, `dawah_worker_record_comment`, `dawah_worker_release` exist and are restricted to service_role. The confirmation function is service_role-only and SECURITY INVOKER; do not change it to SECURITY DEFINER.
- Admin API currently validates exactly four schedule slots and the worker has four allowed slot IDs. The public schedule remains six daily posting times because the Quran slot carries three times.
- RLS is enabled on operational tables. Keep private queue and staff tables inaccessible to anon/authenticated; do not loosen policies to make the worker work.

## Remaining implementation
1. Extend queue comment-ID storage and database RPCs/confirmation logic to support all five Quran comments, with appropriate per-stream requirements for hadith.
2. Update worker API to record each required comment idempotently and confirm only after all required comments succeed.
3. Update admin API/dashboard schedule and content validation only where needed; preserve the four logical stream IDs and six daily times.
4. Implement the scheduled orchestrator and failure/retry/idempotency behavior; use the existing Make Facebook connection and secure worker connection.
5. Install/configure supported scheduling extensions and securely store any invocation credentials; verify current Supabase Cron guidance before scheduling.
6. Verify Quran and hadith source texts, exact references, translation source and copyright/reuse permissions before seeding records.
7. Run an end-to-end test without publishing to the public Page where possible; then perform a specifically approved controlled test. Keep `automation_enabled=false` until the owner explicitly authorizes launch.

## Security notes
- The worker uses the Supabase service-role key only inside its server-side Edge Function environment; never expose it to Make or the browser.
- The worker's custom secret must remain outside GitHub, chat messages and plain scenario fields.
- `public.dawah_confirm_publish` must remain SECURITY INVOKER and service_role-only.
