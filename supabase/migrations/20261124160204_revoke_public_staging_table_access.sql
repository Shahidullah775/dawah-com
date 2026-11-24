-- Keep source staging data server-side only.
-- The collector and admin Edge Functions use service_role; browser roles do not.
revoke all on table public.dawah_source_staging from public, anon, authenticated;
revoke all on table public.dawah_hadith_source_staging from public, anon, authenticated;
