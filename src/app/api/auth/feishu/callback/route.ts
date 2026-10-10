import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/feishu";
import { get, run } from "@/lib/db";
import { setSession } from "@/lib/auth";
import { notify } from "@/lib/notify";
import { appUrl, BASE_PATH } from "@/lib/paths";

/** 自己租户下经过核对的管理员 open_id，禁止凭显示姓名授予或继承权限。 */
const bossIds = () => (process.env.BOSS_FEISHU_OPEN_IDS ?? "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const base = appUrl(req.nextUrl.origin);
  if (!code || !state || state !== req.cookies.get("yy_fs_state")?.value) {
    return NextResponse.redirect(base + "/login?error=state");
  }
  try {
    const info = await exchangeCode(code, base + "/api/auth/feishu/callback");
    let u = get<{ id: number }>("SELECT id FROM users WHERE feishu_open_id=?", info.open_id);
    if (!u) {
      if (bossIds().includes(info.open_id)) {
        u = { id: Number(run("INSERT INTO users(name, role, feishu_open_id, avatar) VALUES(?, 'boss', ?, ?)", info.name, info.open_id, info.avatar_url ?? null).lastInsertRowid) };
      } else {
        // 其他人建为待审批，等老板分配角色
        u = { id: Number(run("INSERT INTO users(name, role, feishu_open_id, avatar) VALUES(?, 'pending', ?, ?)", info.name, info.open_id, info.avatar_url ?? null).lastInsertRowid) };
        for (const b of get<{ ids: string }>("SELECT group_concat(id) ids FROM users WHERE role='boss'")?.ids?.split(",") ?? []) {
          await notify(Number(b), `新成员「${info.name}」通过飞书登录，等待分配角色`, "/settings");
        }
      }
    } else {
      run("UPDATE users SET avatar=? WHERE id=?", info.avatar_url ?? null, u.id);
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
