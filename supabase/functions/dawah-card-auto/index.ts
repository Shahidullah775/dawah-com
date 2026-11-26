// Narrow automation endpoint for the card renderer (GitHub Actions). verify_jwt=false; auth is a
// dedicated shared secret that grants ONLY: list pending items, get a signed upload URL, commit a card.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CARD_BUCKET = "dawah-cards";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const H = { "content-type": "application/json", "cache-control": "no-store" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: H });
function eq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0;
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const secret = Deno.env.get("DAWAH_CARD_AUTO_SECRET") ?? "";
  const got = req.headers.get("x-dawah-auto-secret") ?? "";
  if (secret.length < 24 || !eq(secret, got)) return json({ error: "unauthorized" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let b: any; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  try {
    if (b.action === "pending") {
      const { data, error } = await admin.rpc("dawah_auto_card_pending", { p_limit: Math.min(Number(b.limit) || 3, 5) });
      if (error) throw error; return json({ items: data });
    }
    if (b.action === "upload_url") {
      if (!ID_RE.test(String(b.content_id)) || !["png", "jpg"].includes(b.ext)) return json({ error: "bad_input" }, 400);
      const path = `cards/${b.content_id}/${crypto.randomUUID()}.${b.ext}`;
      const { data, error } = await admin.storage.from(CARD_BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw error ?? new Error("upload_url");
      return json({ path, token: data.token });
    }
    if (b.action === "commit") {
      if (!ID_RE.test(String(b.content_id))) return json({ error: "bad_input" }, 400);
      const { data, error } = await admin.rpc("dawah_auto_card_commit", {
        p_content_id: b.content_id, p_png_path: b.png_path, p_jpg_path: b.jpg_path,
        p_expected_hash: b.hash, p_gate: b.gate ?? {},
      });
      if (error) return json({ error: "commit_refused", detail: error.message }, 422);
      return json(data);
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) { return json({ error: "server", detail: String((e as Error).message ?? e) }, 500); }
});
