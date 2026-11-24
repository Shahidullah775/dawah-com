// Dawah.com photo-card API.
//
// Responsibilities (and hard limits):
//  * Staff-only (same Auth + staff-role check as dawah-admin-api).
//  * AI is used ONLY to (a) pick a calm background theme from the Bengali meaning and (b) draw a
//    text-free background photograph. No Quran/Hadith text, translation or reference is ever sent
//    to an image model, and nothing returned by a model is ever placed on a card as text.
//  * Images and exported cards live in private Storage buckets; the browser only receives
//    short-lived signed URLs.
//  * Does not touch the publishing queue, worker, cron jobs or Facebook flow.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://dawah-com.vercel.app",
  "https://dawah-com-monsurofficial71-5051.vercel.app",
  "https://dawah-com-source.vercel.app",
]);
const fallbackOrigin = "https://dawah-com-source.vercel.app";
const headersFor = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : fallbackOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headersFor(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const GATEWAY = "https://ai-gateway.vercel.sh/v1";
const IMAGE_MODEL = Deno.env.get("DAWAH_IMAGE_MODEL") ?? "bytedance/seedream-5.5";
const PLANNER_MODEL = Deno.env.get("DAWAH_PLANNER_MODEL") ?? "anthropic/claude-haiku-5.5";
const IMAGE_SIZE = Deno.env.get("DAWAH_IMAGE_SIZE") ?? "2048x2048";
const HOURLY_AI_LIMIT = Number(Deno.env.get("DAWAH_AI_HOURLY_LIMIT") ?? "20");
const IMG_BUCKET = "dawah-card-images";
const CARD_BUCKET = "dawah-cards";
const SIGNED_TTL = 3600;

// Fixed, reviewed prompt vocabulary. The planner may only choose a category; it can add a short
// English scene hint, which is sanitised below. Everything else in the prompt is constant.
const CATEGORIES: Record<string, { label: string; scene: string }> = {
  paradise_afterlife: { label: "জান্নাত ও আখিরাত", scene: "a serene lush garden with gentle streams, soft golden morning light and a luminous sky, peaceful paradise-like landscape" },
  creation_nature: { label: "আল্লাহর সৃষ্টি", scene: "majestic mountains above a calm sea under a wide clear sky, natural landscape with river and soft clouds" },
  knowledge_learning: { label: "জ্ঞান ও শিক্ষা", scene: "a quiet classical library with warm window light, rows of old books and a wooden reading desk, no people" },
  prayer_worship: { label: "নামাজ ও ইবাদত", scene: "a peaceful mosque interior with soft light through arches and an empty prayer rug, no people" },
  humanity_kindness: { label: "মানবিকতা ও সদাচরণ", scene: "warm symbolic scene of kindness: a shared meal on a table and a lantern glowing at dusk, no people" },
  patience_trust: { label: "ধৈর্য ও আল্লাহর ওপর ভরসা", scene: "a calm lake at dawn with mist and a distant horizon, quiet and steady atmosphere" },
  mercy_repentance: { label: "রহমত ও তওবা", scene: "soft rain over green fields with light breaking through clouds, gentle and forgiving mood" },
  justice_truth: { label: "ন্যায় ও সত্য", scene: "an open sunlit landscape with a straight path toward a bright horizon, clear and balanced composition" },
  family_community: { label: "পরিবার ও সমাজ", scene: "a quiet village lane at golden hour with warm windows and a shared courtyard, no people" },
  remembrance_death: { label: "স্মরণ ও পরকাল-ভাবনা", scene: "a tranquil dusk horizon with deep green hills and a pale gold sky, contemplative mood, nothing frightening" },
  general: { label: "সাধারণ", scene: "a soft abstract serene landscape in deep green and warm gold tones with gentle light" },
};
const STYLE_SUFFIX =
  "photorealistic, elegant, premium editorial photography, soft natural light, muted palette of deep green, ivory and warm gold, " +
  "calm uncluttered composition with large quiet space in the centre for text overlay. " +
  "Strictly no text, no letters, no numbers, no calligraphy, no logos, no watermark, no human faces or people, " +
  "no idols or religious figures, no animals, no symbols of other faiths, nothing frightening or exaggerated.";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_RE = /^[a-z0-9][a-z0-9/_\-.]{3,200}$/;
const safePath = (p: unknown, prefixes: string[]) =>
  typeof p === "string" && PATH_RE.test(p) && !p.includes("..") && !p.includes("//") && prefixes.some((x) => p.startsWith(x));

class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") { super(message); }
}

function sniff(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return { mime: "image/webp", ext: "webp" };
  return null;
}
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/^data:[^,]+,/, "")), (c) => c.charCodeAt(0));

function sanitizeScene(raw: unknown): string {
  // English words only, short, no instructions beyond a scene hint.
  const s = String(raw ?? "").replace(/[^A-Za-z ,\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  return s;
}

async function gatewayFetch(path: string, body: unknown, key: string) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* keep raw */ }
  return { ok: res.ok, status: res.status, data, text };
}

async function planTheme(translation: string, reference: string, key: string) {
  const system =
    "You choose a calm photographic theme for the BACKGROUND of a Quran/Hadith photo card. " +
    "You are given the Bengali meaning only. Reply with JSON only: " +
    `{"category":"<one of ${Object.keys(CATEGORIES).join("|")}>","scene":"<max 12 English words naming a natural or architectural scene, never people, never text>"}. ` +
    "Do not quote, translate or comment on the religious text.";
  const r = await gatewayFetch("/chat/completions", {
    model: PLANNER_MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: `${reference}\n${translation.slice(0, 1200)}` }],
    max_tokens: 200,
    stream: false,
  }, key);
  if (!r.ok) return { category: "general", scene: "", planner: "failed" };
  const content: string = r.data?.choices?.[0]?.message?.content ?? "";
  const m = content.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(m ? m[0] : "{}");
    const category = typeof parsed.category === "string" && CATEGORIES[parsed.category] ? parsed.category : "general";
    return { category, scene: sanitizeScene(parsed.scene), planner: "ok" };
  } catch {
    return { category: "general", scene: "", planner: "unparsed" };
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headersFor(origin) });
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration incomplete" }, 500, origin);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || token === authHeader) return json({ error: "Sign in required" }, 401, origin);

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid or expired session" }, 401, origin);
  const actor = userData.user.id;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: roleRows, error: roleError } = await admin.rpc("dawah_get_staff_role", { p_user_id: actor });
  const staff = Array.isArray(roleRows) ? roleRows[0] : null;
  if (roleError) return json({ error: "Unable to verify staff permissions" }, 500, origin);
  if (!staff || !["admin", "moderator"].includes(staff.role)) {
    return json({ error: "This account has no Dawah.com staff access" }, 403, origin);
  }

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); }
  const action = String(body.action ?? "");

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, { p_actor: actor, ...args });
    if (error) throw new HttpError(400, error.message, "db_error");
    return data;
  };
  const sign = async (bucket: string, path: string | null) => {
    if (!path) return null;
    const { data } = await admin.storage.from(bucket).createSignedUrl(path, SIGNED_TTL);
    return data?.signedUrl ?? null;
  };

  try {
    switch (action) {
      case "content_search": {
        const seq = body.sequence_no === "" || body.sequence_no == null ? null : Number(body.sequence_no);
        if (seq !== null && (!Number.isInteger(seq) || seq < 1)) throw new HttpError(400, "ক্রমিক নম্বর সঠিক নয়");
        const items = await rpc("dawah_card_content_search", {
          p_source: String(body.source_name ?? ""), p_sequence: seq, p_query: String(body.query ?? "").slice(0, 80), p_limit: 30,
        });
        return json({ items }, 200, origin);
      }
      case "content_get": {
        if (!ID_RE.test(String(body.id))) throw new HttpError(400, "অবৈধ কনটেন্ট ID");
        return json({ content: await rpc("dawah_card_content_get", { p_id: body.id }) }, 200, origin);
      }
      case "library_list": {
        const items = await rpc("dawah_card_library_list", {
          p_limit: 60, p_content_id: body.content_id && ID_RE.test(String(body.content_id)) ? body.content_id : null,
        }) as any[];
        const withUrls = await Promise.all(items.map(async (i) => ({ ...i, url: await sign(IMG_BUCKET, i.storage_path) })));
        return json({ items: withUrls }, 200, origin);
      }
      case "ai_generate": {
        const key = Deno.env.get("AI_GATEWAY_API_KEY");
        if (!key) throw new HttpError(503, "AI ছবি তৈরির key এখনো সেট করা হয়নি (AI_GATEWAY_API_KEY)।", "ai_not_configured");
        if (!ID_RE.test(String(body.content_id))) throw new HttpError(400, "অবৈধ কনটেন্ট ID");
        const used = Number(await rpc("dawah_card_ai_recent_count", {}));
        if (used >= HOURLY_AI_LIMIT) throw new HttpError(429, `প্রতি ঘণ্টায় সর্বোচ্চ ${HOURLY_AI_LIMIT}টি AI ছবি তৈরি করা যায়। কিছুক্ষণ পর আবার চেষ্টা করুন।`, "rate_limited");

        const content = await rpc("dawah_card_content_get", { p_id: body.content_id }) as any;
        let category = typeof body.category === "string" && CATEGORIES[body.category] ? body.category : "";
        let scene = sanitizeScene(body.scene);
        let planner = "manual";
        if (!category) {
          const plan = await planTheme(String(content.bengali_translation ?? ""), String(content.reference_text ?? ""), key);
          category = plan.category; scene = scene || plan.scene; planner = plan.planner;
        }
        const prompt = `${CATEGORIES[category].scene}${scene ? `, ${scene}` : ""}. ${STYLE_SUFFIX}`;

        let r = await gatewayFetch("/images/generations", { model: IMAGE_MODEL, prompt, n: 1, size: IMAGE_SIZE, response_format: "b64_json" }, key);
        if (!r.ok && r.status === 400) r = await gatewayFetch("/images/generations", { model: IMAGE_MODEL, prompt, n: 1, response_format: "b64_json" }, key);
        if (!r.ok) throw new HttpError(502, `AI ছবি তৈরি ব্যর্থ (HTTP ${r.status}): ${String(r.data?.error?.message ?? r.data?.error ?? "").slice(0, 200)}`, "ai_failed");
        const item = r.data?.data?.[0];
        let bytes: Uint8Array | null = null;
        if (item?.b64_json) bytes = b64ToBytes(item.b64_json);
        else if (item?.url) {
          const imgRes = await fetch(item.url);
          if (imgRes.ok) bytes = new Uint8Array(await imgRes.arrayBuffer());
        }
        if (!bytes) throw new HttpError(502, "AI থেকে ছবি পাওয়া যায়নি", "ai_empty");
        const kind = sniff(bytes);
        if (!kind) throw new HttpError(502, "AI-এর ফেরত ফাইল ছবি হিসেবে চেনা যায়নি", "ai_bad_image");
        if (bytes.length > 12 * 1024 * 1024) throw new HttpError(502, "ছবি অতিরিক্ত বড়", "ai_too_large");

        const d = new Date();
        const path = `ai/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${kind.ext}`;
        const up = await admin.storage.from(IMG_BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
        if (up.error) throw new HttpError(500, "ছবি সংরক্ষণ ব্যর্থ: " + up.error.message, "storage_failed");
        const [w, h] = IMAGE_SIZE.split("x").map(Number);
        const row = await rpc("dawah_card_library_add", {
          p_row: {
            storage_path: path, source: "ai", subject: `${CATEGORIES[category].label}${scene ? " · " + scene : ""}`,
            prompt, model: IMAGE_MODEL, content_id: body.content_id, width: w || null, height: h || null, mime_type: kind.mime,
          },
        }) as any;
        return json({ image: { ...row, url: await sign(IMG_BUCKET, path) }, plan: { category, label: CATEGORIES[category].label, scene, planner } }, 200, origin);
      }
      case "upload_url": {
        const kind = body.kind === "card" ? "card" : "image";
        const ext = String(body.ext ?? "").toLowerCase();
        const okExt = kind === "card" ? ["png", "jpg"] : ["png", "jpg", "jpeg", "webp"];
        if (!okExt.includes(ext)) throw new HttpError(400, "অসমর্থিত ফাইল ধরন");
        const d = new Date();
        let path: string;
        if (kind === "card") {
          if (!ID_RE.test(String(body.content_id))) throw new HttpError(400, "অবৈধ কনটেন্ট ID");
          path = `cards/${body.content_id}/${crypto.randomUUID()}.${ext}`;
        } else {
          path = `uploads/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${ext}`;
        }
        const bucket = kind === "card" ? CARD_BUCKET : IMG_BUCKET;
        const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
        if (error || !data) throw new HttpError(500, "আপলোড লিংক তৈরি ব্যর্থ", "storage_failed");
        return json({ bucket, path: data.path ?? path, token: data.token }, 200, origin);
      }
      case "register_image": {
        if (!safePath(body.path, ["uploads/"])) throw new HttpError(400, "অবৈধ ছবির পাথ");
        const dir = String(body.path).split("/").slice(0, -1).join("/");
        const name = String(body.path).split("/").pop()!;
        const { data: listed } = await admin.storage.from(IMG_BUCKET).list(dir, { search: name, limit: 5 });
        if (!listed?.some((f) => f.name === name)) throw new HttpError(400, "আপলোড করা ফাইল পাওয়া যায়নি");
        const row = await rpc("dawah_card_library_add", {
          p_row: {
            storage_path: body.path, source: "upload", subject: String(body.subject ?? "").slice(0, 120),
            content_id: body.content_id && ID_RE.test(String(body.content_id)) ? body.content_id : null,
            width: Number(body.width) || null, height: Number(body.height) || null, mime_type: String(body.mime_type ?? "").slice(0, 40),
          },
        }) as any;
        return json({ image: { ...row, url: await sign(IMG_BUCKET, row.storage_path) } }, 200, origin);
      }
      case "card_save": {
        const p = body.payload ?? {};
        if (p.png_path && !safePath(p.png_path, ["cards/"])) throw new HttpError(400, "অবৈধ PNG পাথ");
        if (p.jpg_path && !safePath(p.jpg_path, ["cards/"])) throw new HttpError(400, "অবৈধ JPG পাথ");
        const card = await rpc("dawah_card_save", { p_payload: {
          id: p.id, content_id: p.content_id, status: p.status, template: p.template, size_key: p.size_key,
          layout: p.layout, image_id: p.image_id, png_path: p.png_path, jpg_path: p.jpg_path, error: String(p.error ?? "").slice(0, 500),
        } });
        return json({ card }, 200, origin);
      }
      case "card_status": {
        if (!ID_RE.test(String(body.id))) throw new HttpError(400, "অবৈধ কার্ড ID");
        const card = await rpc("dawah_card_set_status", { p_id: body.id, p_status: String(body.status), p_error: String(body.error ?? "").slice(0, 500) });
        return json({ card }, 200, origin);
      }
      case "card_web_publish": {
        if (!ID_RE.test(String(body.id))) throw new HttpError(400, "অবৈধ কার্ড ID");
        const card = await rpc("dawah_card_website_publish", { p_id: body.id, p_publish: body.publish !== false });
        return json({ card }, 200, origin);
      }
      case "card_list": {
        const cards = await rpc("dawah_card_list", {
          p_content_id: body.content_id && ID_RE.test(String(body.content_id)) ? body.content_id : null, p_limit: 50,
        }) as any[];
        const out = await Promise.all(cards.map(async (c) => ({ ...c, png_url: await sign(CARD_BUCKET, c.png_path) })));
        return json({ cards: out }, 200, origin);
      }
      case "categories":
        return json({ categories: Object.entries(CATEGORIES).map(([id, v]) => ({ id, label: v.label })) }, 200, origin);
      default:
        return json({ error: "Unknown action" }, 400, origin);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status, origin);
    console.error("dawah-card-api unexpected error", (e as Error)?.message);
    return json({ error: "অপ্রত্যাশিত সার্ভার ত্রুটি" }, 500, origin);
  }
});
