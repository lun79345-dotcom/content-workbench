"use server";
import { UserFacingError, actionResult } from "@/lib/action-errors";
import { revalidatePath } from "next/cache";
import { requireBoss } from "@/lib/auth";
import { all, audit, get, run, transaction } from "@/lib/db";
import { notify } from "@/lib/notify";
import { freezeBonusBasis, BONUS_KINDS } from "@/lib/rules";
import { text, number, month, id, choice, money } from "@/lib/validation";
export async function addBonus(fd: FormData) {
  const me = await requireBoss(), uid = id(fd, "user_id"), m = month(text(fd, "month"));
  const kind = choice(text(fd, "kind"), BONUS_KINDS, "奖金类型"), amount = money(number(fd, "amount", { min: -1000000, max: 1000000, required: true })!), description = text(fd, "description", true);
  if (!get("SELECT id FROM users WHERE id=?", uid) || amount === 0) throw new UserFacingError("成员或金额无效");
  transaction(() => {
    const bid = Number(run("INSERT INTO bonuses(month,user_id,kind,amount,description) VALUES(?,?,?,?,?)", m, uid, kind, amount, description).lastInsertRowid);
    audit(me.id, "bonus", bid, "登记奖金", null, { m, uid, kind, amount, description });
  }); revalidatePath("/bonus");
}
export async function deleteBonus(fd: FormData) {
  const me = await requireBoss(), bid = id(fd);
  transaction(() => {
    const old = get<{ published: number; auto: number }>("SELECT * FROM bonuses WHERE id=?", bid);
    if (!old || old.published || old.auto) throw new UserFacingError("仅可删除尚未公示的手工奖金；自动奖金请更正源数据");
    run("DELETE FROM bonuses WHERE id=? AND published=0", bid); audit(me.id, "bonus", bid, "删除未公示奖金", old, null);
  }); revalidatePath("/bonus");
}
export async function publishMonth(fd: FormData) {
  const me = await requireBoss(), m = month(text(fd, "month"));
  const rows = transaction(() => {
    const rows = all<{ user_id: number; s: number }>("SELECT user_id,sum(amount) s FROM bonuses WHERE month=? AND published=0 GROUP BY user_id", m);
    for (const v of all<{ video_id: number }>("SELECT DISTINCT video_id FROM bonuses WHERE month=? AND published=0 AND video_id IS NOT NULL", m)) freezeBonusBasis(v.video_id);
    run("UPDATE bonuses SET published=1 WHERE month=? AND published=0", m);
    if (rows.length) audit(me.id, "bonus_month", null, "公示奖金", null, { month: m, rows });
    return rows;
  });
  for (const r of rows) await notify(r.user_id, `${m} 奖金已公示：本次新增 ¥${r.s}`, `/bonus?month=${m}`, `bonus-pub-${m}-${r.user_id}-${Date.now()}`);
  revalidatePath("/bonus");
}

export async function addBonusForm(fd: FormData) { return actionResult(() => addBonus(fd)); }

export async function deleteBonusForm(fd: FormData) { return actionResult(() => deleteBonus(fd)); }

export async function publishMonthForm(fd: FormData) { return actionResult(() => publishMonth(fd)); }
