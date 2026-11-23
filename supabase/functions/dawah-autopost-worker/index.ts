import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-dawah-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expected = Deno.env.get("DAWAH_WORKER_SECRET") ?? "";
  if (expected.length < 32) {
    return json({ error: "worker_secret_not_configured" }, 503);
  }
  const supplied = req.headers.get("x-dawah-worker-secret") ?? "";
  if (!constantTimeEqual(supplied, expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server_configuration_missing" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const op = body.op;
    if (op === "claim") {
      const slotId = String(body.slot_id ?? "");
      const allowed = new Set(["quran_stream", "bukhari", "dhuhr_muslim", "tirmidhi"]);
      if (!allowed.has(slotId)) return json({ error: "invalid_slot_id" }, 400);
      const { data, error } = await supabase.rpc("dawah_worker_claim", {
        p_slot_id: slotId,
      });
      if (error) throw error;
      return json(data ?? { status: "empty" });
    }

    const queueId = String(body.queue_id ?? "");
    const claimToken = String(body.claim_token ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(queueId) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimToken)) {
      return json({ error: "valid_queue_id_and_claim_token_required" }, 400);
    }

    if (op === "record_post") {
      const postId = String(body.facebook_post_id ?? "");
      const { data, error } = await supabase.rpc("dawah_worker_record_post", {
        p_queue_id: queueId, p_claim_token: claimToken, p_facebook_post_id: postId,
      });
      if (error) throw error;
      return json({ success: data === true });
    }

    if (op === "record_comment") {
      const commentNumber = Number(body.comment_number);
      const commentId = String(body.facebook_comment_id ?? "");
      if (![1, 2].includes(commentNumber)) return json({ error: "comment_number_must_be_1_or_2" }, 400);
      const { data, error } = await supabase.rpc("dawah_worker_record_comment", {
        p_queue_id: queueId, p_claim_token: claimToken,
        p_comment_number: commentNumber, p_facebook_comment_id: commentId,
      });
      if (error) throw error;
      return json({ success: data === true });
    }

    if (op === "confirm") {
      const slotId = String(body.slot_id ?? "");
      const postId = String(body.facebook_post_id ?? "");
      const { data, error } = await supabase.rpc("dawah_confirm_publish", {
        p_queue_id: queueId, p_slot_id: slotId, p_facebook_post_id: postId,
      });
      if (error) throw error;
      return json(data);
    }

    if (op === "release") {
      const message = String(body.error_message ?? "Publishing attempt failed").slice(0, 1000);
      const { data, error } = await supabase.rpc("dawah_worker_release", {
        p_queue_id: queueId, p_claim_token: claimToken, p_error: message,
      });
      if (error) throw error;
      return json({ success: data === true });
    }

    return json({ error: "unknown_operation" }, 400);
  } catch (error) {
    // Do not return credentials, headers, or stack traces to the caller.
    return json({ error: "worker_operation_failed", detail: String(error).slice(0, 500) }, 500);
  }
});
