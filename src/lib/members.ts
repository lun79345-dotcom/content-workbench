import type { DatabaseSync } from "node:sqlite";

type DeleteResult = { ok: true } | { ok: false; message: string };

/** 删除未使用的本地成员；业务记录中的成员保持不变。 */
export function deleteUnboundMember(d: DatabaseSync, memberId: number, actorId: number): DeleteResult {
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = removeMember(d, memberId, actorId);
    d.exec("COMMIT");
    return result;
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}

function removeMember(d: DatabaseSync, memberId: number, actorId: number): DeleteResult {
  if (!Number.isSafeInteger(memberId) || memberId <= 0) return { ok: false, message: "成员编号无效。" };
  if (memberId === actorId) return { ok: false, message: "不能删除当前登录的成员。" };
  const member = d.prepare("SELECT feishu_open_id FROM users WHERE id=?").get(memberId) as { feishu_open_id: string | null } | undefined;
  if (!member) return { ok: false, message: "该成员已不存在，请刷新页面。" };
  if (member.feishu_open_id) return { ok: false, message: "已绑定飞书的成员不能删除；如需关闭访问，请将角色设为“已停用”。" };

  const history = d.prepare(`SELECT EXISTS (
    SELECT 1 FROM videos WHERE editor_id=:member_id OR cutter_id=:member_id OR created_by=:member_id
    UNION ALL SELECT 1 FROM stage_log WHERE user_id=:member_id
    UNION ALL SELECT 1 FROM reviews WHERE submitter_id=:member_id OR reviewer_id=:member_id
    UNION ALL SELECT 1 FROM metrics WHERE updated_by=:member_id
    UNION ALL SELECT 1 FROM bonuses WHERE user_id=:member_id
    UNION ALL SELECT 1 FROM ideas WHERE submitter_id=:member_id
    UNION ALL SELECT 1 FROM weekly WHERE user_id=:member_id
    UNION ALL SELECT 1 FROM account_weekly WHERE updated_by=:member_id
    UNION ALL SELECT 1 FROM account_review_jobs WHERE requested_by=:member_id
  ) AS present`).get({ ":member_id": memberId }) as { present: number };
  if (history.present) return { ok: false, message: "该成员已有视频、审核、数据、奖金、创意或周复盘记录，不能删除；请将角色设为“已停用”以保留历史记录。" };

  d.prepare("UPDATE accounts SET editor_id=NULL WHERE editor_id=?").run(memberId);
  d.prepare("DELETE FROM settings WHERE key='leader_id' AND value=?").run(String(memberId));
  d.prepare("DELETE FROM notifications WHERE user_id=?").run(memberId);
  d.prepare("DELETE FROM users WHERE id=?").run(memberId);
  return { ok: true };
}
