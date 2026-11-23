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
- Rule: preserve the returned translation and footnotes exactly. This is a possible replacement source, not permission to silently replace the user's previously selected London Academy edition.

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
