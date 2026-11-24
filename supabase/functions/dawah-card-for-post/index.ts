// Read-only helper for the Facebook publisher (Make). Given a queue_id it returns a short-lived signed URL
// of the approved photo card, or {has_card:false}. It publishes nothing and changes nothing; the existing
// worker claim/record/confirm flow is untouched. Same shared-secret header as dawah-autopost-worker.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: H });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  const expected = Deno.env.get("DAWAH_WORKER_SECRET") ?? "";
  if (!safeEqual(req.headers.get("x-dawah-worker-secret") ?? "", expected)) return out({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return out({ error: "invalid_json" }, 400); }
  const queueId = String(body.queue_id ?? "");
  if (!ID_RE.test(queueId)) return out({ error: "valid_queue_id_required" }, 400);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return out({ error: "server_configuration_incomplete" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("dawah_worker_card_for_queue", { p_queue_id: queueId });
  if (error) return out({ error: "lookup_failed" }, 502);
  if (!data || !data.png_path) return out({ has_card: false });
  const { data: s } = await admin.storage.from("dawah-cards").createSignedUrl(data.png_path, 3600);
  if (!s?.signedUrl) return out({ has_card: false, error: "sign_failed" }, 502);
  return out({ has_card: true, card_id: data.card_id, size_key: data.size_key, image_url: s.signedUrl, expires_in: 3600 });
});
