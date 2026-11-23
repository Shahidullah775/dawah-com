# Dawah.com Facebook automation

## Facebook Page connection
- Page name: Dawah.com
- Page ID: 1474802262379886
- Public Page URL supplied by the owner: https://www.facebook.com/share/1FSMx7HFkb/
- Make Facebook Pages connection was authorized on 2026-11-24.
- Granted permissions include pages_manage_posts, pages_manage_engagement, pages_manage_metadata, pages_read_engagement, pages_read_user_content, pages_show_list, and business_management.
- A read-only Page info check succeeded: page name Dawah.com, can_post=true, is_published=true.
- The one-off verification scenario was deactivated after the successful check.

## Current status
Facebook authentication and Page-level posting permission are verified. This does NOT yet mean scheduled publishing is live.

## Remaining implementation before enabling publishing
1. Implement a server-side publisher/worker that obtains the next approved Quran/Hadith item from the database.
2. Generate or retrieve the approved photo card and assemble the caption and first/second comments.
3. Publish the Page post, then add the commentary comments only after the post ID is returned.
4. Confirm publication with the real Facebook post ID using the database confirmation routine; advance the sequence only after confirmation.
5. Add retry/idempotency protection, failure logging, pause/resume and schedule execution for Asia/Dhaka.
6. Store all credentials only in secure server-side secrets. Never commit access tokens or service-role keys.
7. Test with an explicitly approved test post before enabling recurring publication.

## Intended daily schedule (Asia/Dhaka)
- Quran stream: 05:45, 16:45, 20:45
- Sahih al-Bukhari: 09:00
- Sahih Muslim: 13:45
- Jami at-Tirmidhi: 18:15

Publishing remains disabled until the end-to-end workflow is tested and explicitly enabled by the owner.
