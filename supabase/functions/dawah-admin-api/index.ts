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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
});
const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headersFor(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headersFor(origin) });
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

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

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: roleRows, error: roleError } = await admin.rpc("dawah_get_staff_role", { p_user_id: userData.user.id });
  const staff = Array.isArray(roleRows) ? roleRows[0] : null;
  if (roleError) return json({ error: "Unable to verify staff permissions" }, 500, origin);
  if (!staff || !["admin", "moderator"].includes(staff.role)) {
    return json({ error: "This account has no Dawah.com staff access" }, 403, origin);
  }

  if (req.method === "GET") {
    const [{ data: settingsRows, error: settingsError }, { data: dashboard, error: dashboardError }] = await Promise.all([
      admin.rpc("dawah_get_settings"),
      admin.rpc("dawah_queue_dashboard", { p_actor: userData.user.id }),
    ]);
    const settings = Array.isArray(settingsRows) ? settingsRows[0] : null;
    if (settingsError || !settings || dashboardError || !dashboard) {
      return json({ error: "Unable to load dashboard", detail: dashboardError?.message ?? settingsError?.message }, 500, origin);
    }
    return json({
      user: { id: userData.user.id, email: userData.user.email },
      role: staff.role,
      settings,
      dashboard,
    }, 200, origin);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); }

  if (["queue_create", "queue_update", "queue_approve", "queue_reject", "queue_schedule"].includes(String(body.action))) {
    const actionMap: Record<string, string> = {
      queue_create: "create", queue_update: "update", queue_approve: "approve",
      queue_reject: "reject", queue_schedule: "schedule",
    };
    const { data, error } = await admin.rpc("dawah_queue_mutate", {
      p_actor: userData.user.id,
      p_action: actionMap[String(body.action)],
      p_payload: (body.payload && typeof body.payload === "object") ? body.payload : {},
    });
    if (error) return json({ error: error.message }, 400, origin);
    await admin.rpc("dawah_log_activity", {
      p_actor: userData.user.id, p_action: actionMap[String(body.action)],
      p_details: { content_id: (data as Record<string, unknown>)?.id ?? null },
    });
    return json({ item: data }, 200, origin);
  }

  if (staff.role !== "admin") return json({ error: "Admin permission required" }, 403, origin);

  if (body.action === "update_settings") {
    const mode = body.publishing_mode;
    const automation = body.automation_enabled;
    if (!["auto", "approval"].includes(String(mode)) || typeof automation !== "boolean") {
      return json({ error: "Invalid settings" }, 400, origin);
    }
    const { data: settingsRows, error } = await admin.rpc("dawah_update_settings", {
      p_mode: mode, p_automation_enabled: automation,
    });
    const settings = Array.isArray(settingsRows) ? settingsRows[0] : null;
    if (error || !settings) return json({ error: "Settings update failed" }, 500, origin);
    await admin.rpc("dawah_log_activity", {
      p_actor: userData.user.id, p_action: "edit", p_details: { area: "publishing_settings" },
    });
    return json({ settings }, 200, origin);
  }


  if (body.action === "update_schedule") {
    if (staff.role !== "admin") return json({ error: "শুধু অ্যাডমিন সময়সূচি পরিবর্তন করতে পারবেন" }, 403, origin);
    if (!Array.isArray(body.slots) || body.slots.length !== 4) return json({ error: "সব চারটি প্রকাশনা স্লট পাঠাতে হবে" }, 400, origin);
    const seen = new Set<string>();
    const validIds = new Set(["quran_stream", "bukhari", "dhuhr_muslim", "tirmidhi"]);
    for (const item of body.slots as Array<Record<string, unknown>>) {
      const id = String(item.id ?? "");
      const schedule = String(item.schedule_time ?? "");
      if (!validIds.has(id) || seen.has(id)) return json({ error: "অবৈধ বা পুনরাবৃত্ত স্লট পাওয়া গেছে" }, 400, origin);
      seen.add(id);
      const times = schedule.split(",");
      const expected = id === "quran_stream" ? 3 : 1;
      if (times.length !== expected || times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.trim()))) {
        return json({ error: "সময় HH:MM ফরম্যাটে দিন; কোরআনের জন্য তিনটি সময় আবশ্যক" }, 400, origin);
      }
      if (typeof item.enabled !== "boolean") return json({ error: "সক্রিয়/বন্ধ অবস্থা সঠিক নয়" }, 400, origin);
    }
    if (seen.size !== validIds.size) return json({ error: "সব স্লট অন্তর্ভুক্ত করতে হবে" }, 400, origin);
    for (const item of body.slots as Array<Record<string, unknown>>) {
      const { error } = await admin.from("autopost_slots").update({
        schedule_time: String(item.schedule_time),
        enabled: item.enabled as boolean,
        updated_at: new Date().toISOString(),
      }).eq("id", String(item.id));
      if (error) return json({ error: "সময়সূচি সংরক্ষণ ব্যর্থ: " + error.message }, 500, origin);
    }
    await admin.rpc("dawah_log_activity", {
      p_actor: userData.user.id,
      p_action: "edit",
      p_details: { area: "publishing_schedule", slots: body.slots },
    });
    return json({ saved: true }, 200, origin);
  }

  if (body.action === "invite_moderator") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email is required" }, 400, origin);
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: "https://dawah-com-source.vercel.app/admin.html",
    });
    if (inviteError || !invited.user) return json({ error: inviteError?.message ?? "Invitation failed" }, 400, origin);
    const { error: assignError } = await admin.rpc("dawah_assign_moderator", { p_user_id: invited.user.id });
    if (assignError) return json({ error: "Invitation sent, but role assignment needs administrator attention" }, 500, origin);
    await admin.rpc("dawah_log_activity", {
      p_actor: userData.user.id, p_action: "role_change",
      p_details: { invited_email: email, assigned_role: "moderator" },
    });
    return json({ invited: true, email, role: "moderator" }, 200, origin);
  }

  return json({ error: "Unknown action" }, 400, origin);
});