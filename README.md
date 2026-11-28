# Dawah.com

বাংলাভাষী পাঠকদের জন্য কোরআন, হাদিস, অনুবাদ, ব্যাখ্যা এবং প্রকাশনা আর্কাইভ।

## Live site

- Public website: https://dawah-com-source.vercel.app/
- Admin panel: https://dawah-com-source.vercel.app/admin.html
- Quran: https://dawah-com-source.vercel.app/quran.html
- Hadith: https://dawah-com-source.vercel.app/hadith.html
- Archive: https://dawah-com-source.vercel.app/archive.html

## Stack

- Static HTML, CSS and browser JavaScript
- Supabase Auth, Postgres and Edge Functions
- Vercel hosting
- GitHub Actions for basic JavaScript syntax validation

## Repository layout

```
.
├── index.html
├── admin.html
├── quran.html
├── hadith.html
├── archive.html
├── assets/
│   ├── site.css
│   └── site.js
├── supabase/
│   └── migrations/
└── .github/workflows/ci.yml
```

## Development

This is a static website. Serve the repository root with any static HTTP server, or import the repository into Vercel and set the framework preset to **Other** with no build command and the repository root as the output directory.

The public browser client uses the Supabase publishable/anon key. This key is designed to be public; database access must remain protected by Row Level Security. Never commit a Supabase service-role key, Facebook Page access token, passwords, or other secrets.

## Content integrity

- Do not invent Quran verses, hadith wording, translations, commentary, or references.
- Verify every Arabic text and citation against a trusted source before approval.
- Public pages show only records with `is_published = true`.
- Quran stream slots share a single sequence counter; hadith collections have independent counters.
- Advance sequence counters only after confirmed successful publication to the destination platform.

## Automation status

Facebook Page connection and the secure worker API are connected, but the scheduled publisher workflow is **not yet live**. No GitHub scheduled job should publish content until the Facebook Page, secure server-side token storage, publishing worker, error handling, and successful end-to-end tests are complete. The admin automation switch is intentionally kept off until then.

## Security

See [SECURITY.md](SECURITY.md). Report exposed secrets immediately and rotate them; do not place secrets in issues or commits.


## Admin content editor

The Admin Panel now saves the complete editorial record for each queue item: Arabic and Bengali text, reference, Tafhim-ul-Quran, Tafsir Ibn Kathir, additional source notes, external tafsir URLs, translation provenance, and Arabic text source/version. The dashboard read RPC returns these fields for editing. The database migration is `20261123222832_dawah_admin_content_sources_fields`.

## AI Photo Card Studio (admin)

Admin → **AI ফটো কার্ড স্টুডিও** creates Quran/Hadith photo cards.

- **Text comes only from the database.** Arabic (with harakat as stored), Bengali translation and reference are drawn on a canvas from the queue record and shown read-only. AI never writes, edits or receives the religious text.
- **AI makes only the background.** The `dawah-card-api` Edge Function picks a calm theme from a fixed category list (using only the Bengali meaning), builds a fixed text-free prompt through the Vercel AI Gateway, and stores the image in the private `dawah-card-images` bucket. Backgrounds can also be uploaded or reused from the Image Library (subject, content ID, date and source are recorded).
- **Sizes/formats:** 1:1 (1080×1080), 4:5 (1080×1350), 16:9 (1920×1080); PNG and JPG download. Text is auto-fitted; if it cannot fit, saving is blocked rather than truncating.
- **Workflow & statuses:** Draft → Generating Image → Designing → Ready for Review → Approved → (Scheduled → Published reserved for Facebook phase), plus Failed (reason shown, retry available). Any edit clears approval; approval is refused if the source record changed after export.
- **Website:** after approval, "ওয়েবসাইটে প্রকাশ" lists the card on `/cards.html` via the read-only `dawah-public-cards` function. Editing, un-approving or changing the source record removes it automatically.
- **Facebook:** the Make Scheduled Publisher now has a guarded photocard route: after a queue claim it looks up an approved, source-current card; it uses `CreatePostWithPhotos` only when a signed image URL exists and releases the claim if no card exists. The scenario remains inactive; no live post has been made by this feature. Do not activate until an admin has created and approved a card and a controlled test is authorized. See FACEBOOK-AUTOMATION.md.

Database: migrations `202611240006`, `…0007`, `…0008`, and `20261124160204`, `20261124160743`, `20261124161108`, `20261124161254` (private photo-card tables; service-role-only RPCs; source-staging client grants revoked; RLS remains enabled).

### Automatic photo cards
Bengali-only photo cards are rendered automatically by `tools/render-cards.mjs` (GitHub Actions) and gated by automatic checks; see `DEPLOYMENT.md` and `FACEBOOK-AUTOMATION.md`.
