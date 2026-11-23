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