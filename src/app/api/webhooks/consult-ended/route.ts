import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 用 service role key 的专属客户端 —— 只在这一个文件里出现，
// 绝不导出给别的路由用，也绝不会被传给 n8n。
function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  // 1. 校验密钥 —— 只有带对密钥的请求（也就是你的 n8n）才能调这个接口
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== process.env.CONSULT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const email = body?.client_email as string | undefined;

  if (!email) {
    return NextResponse.json({ error: "client_email is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 2. 找到这个客户的 profile
  const { data: profile, error: findError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (findError || !profile) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }

  // 3. 设置 14 天后到期
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ access_expires_at: expiresAt })
    .eq("id", profile.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, client_id: profile.id, access_expires_at: expiresAt });
}