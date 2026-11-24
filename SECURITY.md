# Security notes

- The Supabase publishable key in the browser is not a secret. RLS is mandatory.
- Service-role credentials must only exist in Supabase Edge Function secrets; never in browser files, Git history, issues, or logs.
- Facebook Page access tokens must be stored server-side as managed secrets and rotated if exposed.
- Admin and moderator permissions are enforced by the server-side API and database policies, not by hiding buttons in the UI.
- Keep automated publishing disabled until a real Facebook publishing worker is configured and verified.
- Do not use unverified religious text or citations in production.
- Photo cards: AI receives no Quran/Hadith text; storage buckets are private (signed URLs only); `dawah-card-api` verifies the Auth token and staff role; `dawah-public-cards` returns only approved + website-published cards; `dawah-card-for-post` requires the worker secret. Never expose `AI_GATEWAY_API_KEY`.
