import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

// Best-effort failure alert. Set KEEP_ALIVE_ALERT_WEBHOOK to a Slack/Discord
// incoming webhook URL to get pinged when the keep-alive query fails (i.e. when
// Supabase is actually unreachable — the anon query returning zero rows under
// RLS is NOT an error and does not alert). No webhook configured → logs only.
// A notification failure must never crash the route, so this swallows its own errors.
async function alertFailure(message: string) {
  const webhook = process.env.KEEP_ALIVE_ALERT_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` for Slack, `content` for Discord — each ignores the other's key.
      body: JSON.stringify({
        text: `[ai-wardrobe] Supabase keep-alive failed: ${message}`,
        content: `[ai-wardrobe] Supabase keep-alive failed: ${message}`,
      }),
    });
  } catch (err) {
    console.error("keep-alive alert webhook failed:", err);
  }
}

export async function GET() {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("profiles").select("id").limit(1);

  if (error) {
    console.error("Supabase keep-alive query failed:", error);
    await alertFailure(error.message);
    return new Response(null, { status: 500, headers: responseHeaders });
  }

  return new Response(null, { status: 200, headers: responseHeaders });
}
