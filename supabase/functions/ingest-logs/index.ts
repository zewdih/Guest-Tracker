import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  try {
    const { logs } = await req.json();

    if (!Array.isArray(logs) || logs.length === 0) {
      return new Response("No logs provided", { status: 400, headers: CORS });
    }

    // Cap at 100 per request to prevent abuse
    const batch = logs.slice(0, 100).map((entry: Record<string, unknown>) => ({
      level: String(entry.level || "info"),
      message: String(entry.message || ""),
      url: String(entry.url || ""),
      context: entry, // store the full payload as JSONB
      logged_at: entry.timestamp || new Date().toISOString(),
    }));

    const { error } = await supabase.from("app_logs").insert(batch);

    if (error) {
      console.error("Failed to insert logs:", error.message);
      return new Response("Storage error", { status: 500, headers: CORS });
    }

    return new Response("ok", { status: 200, headers: CORS });
  } catch (err) {
    console.error("ingest-logs error:", err);
    return new Response("Bad request", { status: 400, headers: CORS });
  }
});