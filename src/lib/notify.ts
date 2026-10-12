import { all, get, run } from "./db";
import { sendCard } from "./feishu";
import { appUrl } from "./paths";
import { feishuEnabled } from "./auth";
type Notification = { id: number; user_id: number; text: string; link: string | null; attempts: number; feishu_open_id: string };
/** Dedupe creates one durable inbox entry. Failed deliveries remain in the outbox. */
export async function notify(userId: number | null | undefined, text: string, link?: string, dedupe?: string) {
  if (!userId || !get("SELECT id FROM users WHERE id=? AND role IN ('boss','editor','cutter')", userId)) return;
  const result = run("INSERT INTO notifications(user_id,text,link,dedupe) VALUES(?,?,?,?) ON CONFLICT(dedupe) DO NOTHING", userId, text, link ?? null, dedupe ?? null);
  const id = result.changes ? Number(result.lastInsertRowid) : get<{ id: number }>("SELECT id FROM notifications WHERE dedupe=?", dedupe)?.id;
  if (id) await pushNotification(id);
}
export async function pushNotification(id: number, send = sendCard) {
  if (!feishuEnabled()) return;
  // A lease survives crashes and prevents overlapping job/action workers from double-sending.
  const claimed = run(`UPDATE notifications SET pushed=2,attempts=attempts+1,next_attempt_at=datetime('now','+8 hours','+5 minutes')
    WHERE id=? AND (pushed=0 OR (pushed=2 AND next_attempt_at<=datetime('now','+8 hours')))
      AND (next_attempt_at IS NULL OR next_attempt_at<=datetime('now','+8 hours'))
      AND EXISTS (SELECT 1 FROM users u WHERE u.id=notifications.user_id AND u.role IN ('boss','editor','cutter') AND u.feishu_open_id IS NOT NULL)`, id);
  if (!claimed.changes) return;
  const row = get<Notification>("SELECT n.*,u.feishu_open_id FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.id=?", id)!;
  try {
    const base = appUrl();
    await send(row.feishu_open_id, row.text, row.link && base ? base + row.link : undefined);
    run("UPDATE notifications SET pushed=1,next_attempt_at=NULL,last_error=NULL WHERE id=?", id);
  } catch (e) {
    const minutes = Math.min(60, 2 ** Math.min(row.attempts, 6));
    run("UPDATE notifications SET pushed=0,next_attempt_at=datetime('now','+8 hours',?),last_error=? WHERE id=?", `+${minutes} minutes`, e instanceof Error ? e.message.slice(0, 500) : "推送失败", id);
    console.error("[notify] delivery failed", id);
  }
}
export async function retryNotifications() {
  for (const row of all<{ id: number }>("SELECT n.id FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.pushed IN (0,2) AND u.feishu_open_id IS NOT NULL AND u.role IN ('boss','editor','cutter') AND (n.next_attempt_at IS NULL OR n.next_attempt_at<=datetime('now','+8 hours')) ORDER BY n.id LIMIT 50")) await pushNotification(row.id);
}
