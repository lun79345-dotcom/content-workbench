import type { DatabaseSync } from "node:sqlite";

type DeleteResult = { ok: true } | { ok: false; message: string };

/** 只删除没有业务记录的账号，保留历史数据的账号关联。 */
export function deleteUnusedAccount(d: DatabaseSync, accountId: number): DeleteResult {
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = removeAccount(d, accountId);
    d.exec("COMMIT");
    return result;
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
}

function removeAccount(d: DatabaseSync, accountId: number): DeleteResult {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return { ok: false, message: "账号编号无效。" };
  if (!d.prepare("SELECT id FROM accounts WHERE id=?").get(accountId)) return { ok: false, message: "该账号已不存在，请刷新页面。" };

  const history = d.prepare(`SELECT EXISTS (
    SELECT 1 FROM videos WHERE account_id=:account_id
    UNION ALL SELECT 1 FROM ideas WHERE account_id=:account_id
    UNION ALL SELECT 1 FROM targets WHERE account_id=:account_id
    UNION ALL SELECT 1 FROM account_weekly WHERE account_id=:account_id
    UNION ALL SELECT 1 FROM account_review_jobs WHERE account_id=:account_id
  ) AS present`).get({ ":account_id": accountId }) as { present: number };
  if (history.present) return { ok: false, message: "该账号已有视频、创意、月度目标或复盘记录，不能删除，以保留历史数据。" };

  d.prepare("DELETE FROM accounts WHERE id=?").run(accountId);
  return { ok: true };
}
