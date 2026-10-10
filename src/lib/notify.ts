import { get, run } from "./db";
import { sendCard } from "./feishu";
import { appUrl } from "./paths";
import { feishuEnabled } from "./auth";

/**
 * 站内通知 + （已配置时）飞书消息。dedupe 相同的通知只发一次。
 */
export async function notify(userId: number | null | undefined, text: string, link?: string, dedupe?: string) {
  if (!userId) return;
  try {
    run("INSERT INTO notifications(user_id, text, link, dedupe) VALUES(?,?,?,?)", userId, text, link ?? null, dedupe ?? null);
  } catch {
    return; // dedupe 冲突 = 已发过
  }
  if (!feishuEnabled()) return;
  const u = get<{ feishu_open_id: string | null }>("SELECT feishu_open_id FROM users WHERE id=?", userId);
  if (!u?.feishu_open_id) return;
  try {
    const base = appUrl();
    await sendCard(u.feishu_open_id, text, link && base ? base + link : undefined);
    run("UPDATE notifications SET pushed=1 WHERE dedupe IS ? AND user_id=? AND text=?", dedupe ?? null, userId, text);
  } catch (e) {
    console.error("[notify]", e);
  }
}
