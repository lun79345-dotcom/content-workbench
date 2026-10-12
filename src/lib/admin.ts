import { UserFacingError } from "./action-errors";
import { get, run } from "./db";
export function usablePerson(uid: number | null, role: string) {
  if (!uid) return false;
  const bound = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET ? " AND feishu_open_id IS NOT NULL" : "";
  return !!get(`SELECT id FROM users WHERE id=? AND role=?${bound}`, uid, role);
}
export function changeMember(uid: number, name: string, role: string) {
  const old = get<{ role: string; feishu_open_id: string | null }>("SELECT * FROM users WHERE id=?", uid);
  if (!old) throw new UserFacingError("成员不存在");
  if (old.role === "boss" && role !== "boss") {
    const bound = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET ? " AND feishu_open_id IS NOT NULL" : "";
    if (!get(`SELECT id FROM users WHERE id!=? AND role='boss'${bound} LIMIT 1`, uid)) throw new UserFacingError("至少需要保留一位可登录的老板");
  }
  run("UPDATE users SET name=?,role=?,session_version=session_version+? WHERE id=?", name, role, old.role === role ? 0 : 1, uid);
  if (role !== "editor") run("DELETE FROM settings WHERE key='leader_id' AND value=?", String(uid));
  const bound = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET ? " AND feishu_open_id IS NOT NULL" : "";
  const fallback = get<{ id: number }>(`SELECT id FROM users WHERE role='boss'${bound} ORDER BY id LIMIT 1`);
  if (!['boss', 'editor'].includes(role) && fallback) {
    run("UPDATE reviews SET reviewer_id=? WHERE reviewer_id=? AND status='待审'", fallback.id, uid);
  }
  return old;
}
