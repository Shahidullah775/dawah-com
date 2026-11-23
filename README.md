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
