# Dawah.com — Quran & Hadith Content Source Register

Last reviewed: 2026-11-24

This register is the source-of-truth for editorial provenance and reuse checks. Do not seed the publishing queue from an unattributed scrape or an AI-generated reconstruction.

## Quran Arabic text

- Preferred source: Tanzil Project, Uthmani Quran Text, version 1.1.
- Source: https://tanzil.net/
- License / terms: CC BY 3.0. Verbatim copying and distribution are permitted, but the text must not be changed. A website/app may use it if Tanzil is clearly credited and linked, and the copyright notice is preserved with copies or substantial derivatives.
- Terms: https://tanzil.net/docs/Text_License
- Editorial rule: preserve the exact downloaded text, diacritics, and verse boundaries. Store the source version and file checksum. Do not normalize, strip, retype, or AI-correct the Arabic. Any integrity mismatch blocks publication.

Required attribution for the Arabic source:
"Tanzil Quran Text (Uthmani, Version 1.1), Copyright (C) 2007–2021 Tanzil Project, CC BY 3.0. Source: https://tanzil.net/. Text reproduced verbatim and not modified. See https://tanzil.net/docs/Text_License."

## Bengali Quran translation — Al Quran Academy London

- Intended edition: "কোরআন শরীফ (লন্ডন একাডেমী)".
- Public organisation site: https://aqal.org.uk/
- Public catalogue evidence identifies Hafiz Munir Uddin Ahmed as author/translator and Al Quran Academy Publications as publisher for the Bengali/Arabic edition. Catalogue reference: https://eboighar.com/bn/booksdetails/1143
- Reuse status: no explicit open licence or written permission for automated reproduction on Dawah.com has been verified.
- Rule: do not bulk copy or publish the full verse-by-verse translation until the rights holder/publisher confirms permission in writing. Linking to the publisher's official site is acceptable; attribution alone is not a substitute for permission.

## Tafhim-ul-Quran — Bengali edition

- Work: Tafhim-ul-Quran, Syed Abul A'la Maududi.
- Bengali edition catalogue evidence identifies translator Maulana Abdul Mannan Talib and publisher Adhunik Prokashani. Reference: https://eboighar.com/bn/booksdetails/1148
- Reuse status: no explicit open licence or written permission for automated reproduction on Dawah.com has been verified.
- Rule: use a short permitted excerpt only after review, otherwise write a clearly labelled original summary and link to the source. Never present a summary as a verbatim quotation.

## Tafsir Ibn Kathir — Bengali edition

- Bengali edition catalogue evidence identifies translator Professor Dr. Muhammad Mujibur Rahman and publisher Tafsir Publication Committee. Reference: https://eboighar.com/bn/booksdetails/46271
- Reuse status: no explicit open licence or written permission for automated reproduction on Dawah.com has been verified.
- Rule: use a short permitted excerpt only after review, otherwise write a clearly labelled original summary and link to the source. Never present a summary as a verbatim quotation.

## Hadith sources

- Each narration must be tied to the named collection, book/chapter where available, edition/numbering convention, and a source URL.
- Hadith text and translation must be checked against a reliable edition before queueing. Do not assume hadith numbers are universal across editions.
- Do not generate narrations, chains, Arabic wording, or references from memory or an LLM.

## Publishing gate

A queue item must not be approved unless it has:
1. Exact Arabic text and a recorded source/version.
2. Exact Bengali translation and a recorded translator/edition/source.
3. Exact verse or hadith reference.
4. Source notes for each commentary.
5. Reuse status: open licence, written permission, or an appropriately limited excerpt.
6. A human editorial review record.

No placeholder, guessed, or AI-invented Quran/Hadith content may enter the production queue.


## Approved online import candidates (reviewed 2026-11-24)

### Bengali Quran translation — QuranEnc

- Candidate edition: Bengali Translation — Dr. Abu Bakr Muhammad Zakaria, key `bengali_zakaria`, version 1.1.1 (as listed by QuranEnc).
- API: `https://quranenc.com/api/v1/translation/aya/bengali_zakaria/{sura}/{aya}`
- Source and terms: https://quranenc.com/bn/home and https://quranenc.com/bn/home/api/index.html.md
- Republishing terms: content must remain unchanged (no modification, addition, or deletion); credit QuranEnc.com; state the version; retain the translation/version information; report notes to the source; update to the latest version; no inappropriate advertisements.
- User approval: approved on 2026-11-24 as the Bengali Quran translation for Dawah.com, replacing the previously intended London Academy translation.
- Import implementation: the admin dashboard can fetch one complete sura into the isolated `dawah_source_staging` table. Records retain the API URL, edition key/version, raw source response, Arabic text, translation, and footnotes. They remain pending human review and are not published automatically.
- Arabic-text caution: the same API response includes an Arabic text field. It is explicitly labelled as QuranEnc API Arabic text and must be cross-checked against the pinned Tanzil Uthmani v1.1 text before publication; it is not labelled as Tanzil text merely because it is Arabic.
- Rule: preserve the returned translation and footnotes exactly; do not strip footnote markers or rewrite the translation. This approved edition replaces the previous intended London Academy edition for future imports.

### Bengali hadith translation and explanation — HadeethEnc

- Candidate source: HadeethEnc.com, Bengali API language code `bn`.
- API: `https://hadeethenc.com/api/v1/hadeeths/one/?language=bn&id={id}`; the corresponding Arabic record is `https://hadeethenc.com/api/v1/hadeeths/one/?language=ar&id={id}`.
- API documentation: https://github.com/islamhouse-dev/hadith-api
- Republishing terms: content must remain unchanged; credit HadeethEnc.com; state the version and preserve version information; report notes to the source; keep content updated; no inappropriate advertisements.
- Coverage limitation: HadeethEnc is a curated translated-hadith encyclopedia, not a guaranteed complete, sequential digital edition of Sahih al-Bukhari, Sahih Muslim, or Jami at-Tirmidhi. Import only records whose original collection and exact hadith number are explicitly verified in the Arabic record's references. Never fabricate a collection number or fill a sequence gap with a different narration.

### Hadith Arabic source candidate — Fawaz Ahmed hadith-api

- API/CDN: https://github.com/fawazahmed0/hadith-api
- Candidate editions include Arabic collections for Bukhari, Muslim, and Tirmidhi.
- The repository's code licence and the data rights are not automatically identical. Verify the specific edition's source and licence before redistributing any record. Do not rely on the repository's code licence alone as proof that every text/translation is cleared.
- Use as a cross-check/reference candidate only until edition-level data rights and exact numbering are confirmed.

## Automated import policy

- External source data first enters a staging/review state, never directly into the publishable queue.
- Every imported record must retain source URL, collection/edition, translation key/version, fetch timestamp, exact reference, and source text unchanged.
- Quran Arabic must pass an exact-text integrity check against the pinned Tanzil edition.
- A hadith may enter a collection stream only when its exact collection and numbering convention are confirmed; otherwise keep it in a separate unassigned review list.
- The importer must be idempotent: repeated runs must not create duplicate source records.
- A human reviewer must approve every record before it becomes publishable.
- No AI-generated translation or commentary may be labelled as a source's verbatim translation or tafsir.


## Automated Quran collection status (2026-11-24)

- Supabase Cron job: `dawah-quran-auto-collector-15m`, active, runs every 15 minutes.
- Edge Function: `dawah-quran-auto-collector`, active. It claims the next sura, fetches the full sura from the QuranEnc API, validates sura/ayah order and source IDs, then upserts records into the isolated review staging table.
- Rate limiting: database claim lock and a 15-minute next-run gate; repeated calls cannot advance the collection faster than one sura per 15 minutes.
- Cursor: starts at sura 1 and advances only after the complete sura has been stored successfully. Failed requests are retried after the next interval.
- First live collection verified: Surah Al-Fatiha, 7/7 ayat, pending review; next sura is 2.
- Collection stops after sura 114. This is collection only: it does not approve or publish content and does not enable Facebook autopost.
- QuranEnc API list endpoint currently returned only its first Bengali translation item in the runtime test, so the collector uses the pinned, previously verified `bengali_zakaria` key and version 1.1.1. A change to the source edition requires a deliberate review/update rather than silently switching translations.


## Automated hadith Arabic collection status (2026-11-24)

- Supabase Cron job: `dawah-hadith-arabic-collector-15m`, scheduled every 15 minutes.
- Edge Function: `dawah-hadith-arabic-collector`, active; each run independently claims the next source number for Bukhari, Muslim, and Tirmidhi, then stages the exact Arabic record.
- Initial source API `sahih-al-bukhari.com/api/v1` returned HTTP 503 with `api_paused` during the live test. The importer therefore uses the repository's per-record JSON files at a pinned Git commit rather than silently switching to an unpinned branch.
- Pinned repository commit: `df57907be35291c91ad6a6691180e22ca9920784`; editions: `ara-bukhari`, `ara-muslim`, and `ara-tirmidhi`. Each record retains its raw GitHub source URL, blob URL, repository commit, dataset numbering and exact Arabic text.
- Initial live test succeeded: Bukhari hadith-api no. 1 (edition no. 1), Muslim hadith-api no. 93 (edition no. 8.01), and Tirmidhi hadith-api no. 1 (edition no. 1). Muslim records 1–92 in this pinned Arabic edition have empty text; the cursor starts at 93 to avoid creating empty placeholders.
- The repository contains an Unlicense file, but the dataset's individual text provenance and redistribution rights have not been independently confirmed. Every staged row is explicitly marked for rights review and scholar review; this is not cleared for publication.
- Bengali translation fields remain null. No AI translation, generated commentary, queue insertion, approval, public publication, or Facebook post is performed by this collector.
- Idempotency: unique collection/source-number/pinned-version constraint. Failed requests retry the same source number; empty Arabic records are logged and skipped; a 404 at the end of a stream marks that collection complete.
- Admin dashboard now includes a separate hadith staging list and cursor status; the Quran and hadith staging tables remain isolated from the publishing queue.
