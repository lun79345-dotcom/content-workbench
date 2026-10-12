import { NextRequest, NextResponse } from "next/server";
import { identifyFeishu } from "@/lib/identity";
import { exchangeCode } from "@/lib/feishu";
import { all } from "@/lib/db";
import { setSession } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { appUrl, BASE_PATH } from "@/lib/paths";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const base = appUrl(req.nextUrl.origin);
  if (!code || !state || state !== req.cookies.get("yy_fs_state")?.value) {
    return NextResponse.redirect(base + "/login?error=state");
  }
  try {
    const info = await exchangeCode(code, base + "/api/auth/feishu/callback");
    const u = identifyFeishu(info);
    if (u.created) {
      for (const b of all<{ id: number }>("SELECT id FROM users WHERE role='boss' AND feishu_open_id IS NOT NULL")) {
        await notify(b.id, `新成员「${info.name}」通过飞书登录，等待分配角色`, "/settings");
      }
    }
    await setSession(u.id);
    const res = NextResponse.redirect(base + "/");
    res.cookies.set("yy_fs_state", "", { path: BASE_PATH || "/", maxAge: 0 });
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.redirect(base + "/login?error=feishu");
  }
}
