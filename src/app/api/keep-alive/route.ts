import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export async function GET() {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("profiles").select("id").limit(1);

  if (error) {
    console.error("Supabase keep-alive query failed:", error);
    return new Response(null, { status: 500, headers: responseHeaders });
  }

  return new Response(null, { status: 200, headers: responseHeaders });
}
