// Public, read-only list of photo cards that staff approved AND published on the website.
// Returns only DB-sourced text plus short-lived signed image URLs. No write path, no private data.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowed = new Set([
  "https://dawah-com.vercel.app",
  "https://dawah-com-monsurofficial71-5051.vercel.app",
  "https://dawah-com-source.vercel.app",
]);
const hdr = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowed.has(origin) ? origin : "https://dawah-com-source.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
});

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: hdr(origin) });
  if (req.method !== "GET" && req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: hdr(origin) });
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response(JSON.stringify({ error: "Server configuration incomplete" }), { status: 500, headers: { ...hdr(origin), "Content-Type": "application/json" } });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("dawah_public_cards", { p_limit: 24 });
  if (error) return new Response(JSON.stringify({ error: "Unavailable" }), { status: 502, headers: { ...hdr(origin), "Content-Type": "application/json" } });
  const cards = await Promise.all((data as any[]).map(async (c) => {
    const { data: s } = await admin.storage.from("dawah-cards").createSignedUrl(c.png_path, 3600);
    return {
      id: c.id, size_key: c.size_key, content_type: c.content_type, source_name: c.source_name, sequence_no: c.sequence_no,
      reference_text: c.reference_text, arabic_text: c.arabic_text, bengali_translation: c.bengali_translation,
      published_at: c.website_published_at, image_url: s?.signedUrl ?? null,
    };
  }));
  return new Response(JSON.stringify({ cards: cards.filter((c) => c.image_url) }), {
    headers: { ...hdr(origin), "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
});
