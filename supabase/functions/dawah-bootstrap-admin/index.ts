import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = "monsurofficial71@gmail.com";
const ALLOWED_ORIGINS = new Set([
  "https://dawah-com.vercel.app",
  "https://dawah-com-monsurofficial71-5051.vercel.app",
  "https://dawah-com-source.vercel.app",
]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://dawah-com-source.vercel.app",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (origin && !ALLOWED_ORIGINS.has(origin)) return respond({ error: "Origin not allowed" }, 403);
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return respond({ error: "Server configuration incomplete" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || token === authHeader) return respond({ error: "Sign in required" }, 401);

  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return respond({ error: "Invalid or expired session" }, 401);
  if ((userData.user.email ?? "").toLowerCase() !== ADMIN_EMAIL) {
    return respond({ error: "This email is not authorized for first-admin setup" }, 403);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: canBootstrap, error: guardError } = await admin.rpc("dawah_is_first_admin_unclaimed");
  if (guardError) return respond({ error: "Unable to verify first-admin setup state" }, 500);
  if (canBootstrap !== true) return respond({ error: "First-admin setup is already closed" }, 409);

  const { data: assigned, error: assignError } = await admin.rpc("dawah_bootstrap_first_admin", {
    p_user_id: userData.user.id,
    p_email: ADMIN_EMAIL,
  });
  if (assignError || assigned !== true) return respond({ error: "First-admin assignment failed" }, 500);

  await admin.rpc("dawah_log_activity", {
    p_actor: userData.user.id,
    p_action: "role_change",
    p_details: { assigned_role: "admin", bootstrap: true },
  });

  return respond({ assigned: true, email: ADMIN_EMAIL, role: "admin" });
});
