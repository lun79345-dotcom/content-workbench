import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { makeSession, readSession, SESSION_AGE } from "./session";
import { get, run } from "./db";
import { BASE_PATH } from "./paths";

export type User = { id: number; name: string; role: "boss" | "editor" | "cutter" | "pending" | "disabled"; avatar: string | null; feishu_open_id: string | null; session_version: number };

export const SESSION_COOKIE = "yy_sid";
const COOKIE = SESSION_COOKIE;
const COOKIE_PATH = BASE_PATH || "/";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("缺少 SESSION_SECRET");
  return s || "dev-secret";
}
export async function setSession(userId: number) {
  const user = get<User>("SELECT * FROM users WHERE id=?", userId);
  if (!user) throw new Error("成员不存在");
  const secure = process.env.COOKIE_SECURE === "1" || (process.env.COOKIE_SECURE !== "0" && process.env.NODE_ENV === "production");
  (await cookies()).set(COOKIE, makeSession(userId, user.session_version, secret()), { httpOnly: true, sameSite: "lax", secure, path: COOKIE_PATH, maxAge: SESSION_AGE / 1000 });
}
export async function clearSession() {
  const u = await currentUser();
  if (u) run("UPDATE users SET session_version=session_version+1 WHERE id=?", u.id);
  (await cookies()).set(COOKIE, "", { path: COOKIE_PATH, maxAge: 0 });
}
export async function currentUser(): Promise<User | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const session = readSession(raw, secret());
  if (!session) return null;
  const user = get<User>("SELECT * FROM users WHERE id=?", session.uid);
  return user && user.session_version === session.version ? user : null;
}

/** 页面/动作入口：未登录跳登录页；待审批用户只能看到等待页 */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (!["boss", "editor", "cutter"].includes(u.role)) redirect("/login?pending=1");
  return u;
}
export async function requireBoss(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "boss") redirect("/");
  return u;
}

export const feishuEnabled = () => !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
/** 开发登录：显式 DEV_LOGIN=1，或本地开发且未配置飞书时开启。生产环境默认关闭。 */
export const devLoginEnabled = () => process.env.DEV_LOGIN === "1" || (process.env.NODE_ENV !== "production" && !feishuEnabled());

export const ROLE_LABEL: Record<string, string> = { boss: "老板", editor: "编导", cutter: "剪辑", pending: "待审批", disabled: "已停用" };
