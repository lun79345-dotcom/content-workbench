import { redirect } from "next/navigation";
import { all } from "@/lib/db";
import { withBase } from "@/lib/paths";
import { FeishuAutoLogin } from "@/components/feishu-auto-login";
import { currentUser, devLoginEnabled, feishuEnabled, setSession, clearSession, ROLE_LABEL } from "@/lib/auth";

async function devLogin(fd: FormData) {
  "use server";
  if (!devLoginEnabled()) return;
  await setSession(Number(fd.get("uid")));
  redirect("/");
}
async function logout() {
  "use server";
  await clearSession();
  redirect("/login");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const me = await currentUser();
  if (me && me.role !== "pending" && me.role !== "disabled") redirect("/");
  const users = devLoginEnabled() ? all<{ id: number; name: string; role: string }>("SELECT id,name,role FROM users WHERE role NOT IN ('pending','disabled') ORDER BY id") : [];

  return (
    <main className="min-h-screen grid place-items-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-stone-200">
        <h1 className="text-xl font-semibold">内容工作台 · 演示版</h1>
        <p className="mt-1 text-sm text-stone-500">选题 → 生产 → 审核 → 数据 → 奖金，一条线跑完</p>

        {me && (me.role === "pending" || me.role === "disabled") ? (
          <div className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            {me.name}，你的账号{me.role === "pending" ? "正在等待老板分配角色" : "已停用"}。
            <form action={logout}><button className="mt-3 text-amber-900 underline">换个账号</button></form>
          </div>
        ) : (
          <>
            {sp.error && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">登录失败，请重试（{sp.error}）</p>}
            {feishuEnabled() && !sp.error && !sp.logout && <FeishuAutoLogin href={withBase("/api/auth/feishu")} />}
            {feishuEnabled() && (
              <a href={withBase("/api/auth/feishu")} className="mt-6 flex h-11 items-center justify-center rounded-lg bg-[#3370ff] font-medium text-white hover:opacity-90">
                飞书登录
              </a>
            )}
            {!feishuEnabled() && !devLoginEnabled() && (
              <p className="mt-6 rounded-lg bg-stone-50 p-3 text-sm text-stone-500">飞书登录尚未配置，请联系管理员。</p>
            )}
            {devLoginEnabled() && (
              <form action={devLogin} className="mt-6 space-y-2">
                <p className="text-xs text-stone-400">开发模式：选择身份直接登录{feishuEnabled() ? "" : "（未配置飞书 App）"}</p>
                <div className="grid grid-cols-2 gap-2">
                  {users.map((u) => (
                    <button key={u.id} name="uid" value={u.id} className="rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:bg-stone-50">
                      {u.name}<span className="ml-1 text-xs text-stone-400">{ROLE_LABEL[u.role]}</span>
                    </button>
                  ))}
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
