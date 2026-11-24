# Dawah.com deployment status

## Source repository
- GitHub: https://github.com/Shahidullah775/dawah-com
- Production branch: main
- Source of truth: repository files, not manual edits in Vercel.

## Git-connected Vercel project
- Project: dawah-com-source
- Project ID: prj_LgnP1sDakvU3GujQQK3dwpVPUdZG
- Repository: Shahidullah775/dawah-com
- Branch: main
- Preview/production-branch deployment: https://dawah-com-source.vercel.app/
- Initial deployment: READY
- Future pushes to main automatically trigger deployments for this linked project.

## Existing public project
- Project: dawah-com
- Project ID: prj_ZkZSV5n4ANIYs6oiWREdR9EHTg4n
- Public URL: https://dawah-com.vercel.app/
- This existing project is not Git-linked. Its current public domain remains attached here.
- Do not assume Git pushes update this existing project until the domain/project migration is deliberately completed and verified.

## Supabase
- Project ref: hcanzohgtnzhchjnwfdw
- Public content is served from public.dawah_public_content.
- The public read policy permits SELECT only for rows where is_published = true.
- Admin operations are performed by the authenticated Edge Function and service-role database routines. Never expose the service-role key in browser code or source control.

## Current publishing state
- Quran stream: 05:45, 16:45, 20:45 Asia/Dhaka
- Sahih al-Bukhari: 09:00
- Sahih Muslim: 13:45
- Jami at-Tirmidhi: 18:15
- All four slot records are currently enabled, with next_sequence = 1.
- No verified content has been published yet.
- Facebook publishing is not live. Keep automation disabled until Page credentials, publishing worker, schedule trigger, and end-to-end publication verification are complete.

## Release checklist
1. Review source changes in GitHub.
2. Verify the Git-linked Vercel deployment.
3. Verify public content reads and admin authorization.
4. Apply and verify database migrations.
5. Configure Facebook Page credentials securely in server-side secrets only.
6. Test a single approved post end-to-end before enabling recurring publishing.
7. Transfer the public domain only after the Git-linked deployment has been fully verified.

## Secrets
Never commit Supabase service-role keys, Facebook access tokens, passwords, or other private credentials.

## Latest production deployment — 2026-11-24
- Latest Git-linked production deployment: READY.
- Commit: `db24db5fc6be5d6719f1e71e6d39a28ee78b119b` (Admin Panel content-editor source fields).
- Production alias: https://dawah-com-source.vercel.app/
- The admin HTML route returns HTTP 200 from the production deployment. Authenticated browser login and end-to-end form submission still require an administrator session to verify.

## Photo Card Studio deployment
1. Apply migrations `202611240006_dawah_photocards.sql`, `202611240007_dawah_photocards_website.sql`, `202611240008_dawah_worker_card_lookup.sql`, `20261124160204_revoke_public_staging_table_access.sql`, `20261124160743_index_foreign_keys_and_remove_duplicate.sql`, `20261124161108_recover_comment_jobs_with_recorded_external_id.sql`, `20261124161254_normalize_quran_surah_references.sql`.
2. Deploy Edge Functions: `dawah-card-api` (verify_jwt=true, staff only), `dawah-public-cards` (verify_jwt=false, read-only), `dawah-card-for-post` (verify_jwt=false, protected by `x-dawah-worker-secret`).
3. AI backgrounds need the Edge Function secret `AI_GATEWAY_API_KEY` (Vercel AI Gateway key with a spend budget and expiry). Enter it via the Supabase dashboard secrets prompt only; never in chat, Git or the browser. Optional: `DAWAH_IMAGE_MODEL` (default `bytedance/seedream-5.5`), `DAWAH_PLANNER_MODEL`, `DAWAH_AI_HOURLY_LIMIT` (default 20).
4. Storage buckets `dawah-card-images` and `dawah-cards` are private; the browser only receives short-lived signed URLs.
5. Merge the `feature/photocard-studio-rebased` PR to `main` to publish `admin.html`, `assets/photocard.js`, `cards.html` and nav links. Verify with a real admin login (create, save, approve, publish to website) before relying on it.
6. Do not add the card image to the Facebook scenario until the owner explicitly approves.
