"use server";
import { revalidatePath } from "next/cache";
import { requireBoss } from "@/lib/auth";
import { all, run } from "@/lib/db";
import { notify } from "@/lib/notify";

export async function addBonus(fd: FormData) {
  await requireBoss();
  run("INSERT INTO bonuses(month,user_id,kind,amount,description) VALUES(?,?,?,?,?)",
    fd.get("month"), Number(fd.get("user_id")), fd.get("kind"), Number(fd.get("amount")), fd.get("description") || null);
  revalidatePath("/bonus");
}

export async function deleteBonus(fd: FormData) {
  await requireBoss();
  run("DELETE FROM bonuses WHERE id=? AND published=0", Number(fd.get("id")));
  revalidatePath("/bonus");
}

/** 公示本月：锁定金额（之后自动重算不再改动），并通知每个人 */
export async function publishMonth(fd: FormData) {
  await requireBoss();
  const month = String(fd.get("month"));
  const rows = all<{ user_id: number; s: number }>("SELECT user_id, sum(amount) s FROM bonuses WHERE month=? AND published=0 GROUP BY user_id", month);
  run("UPDATE bonuses SET published=1 WHERE month=?", month);
  for (const r of rows) await notify(r.user_id, `${month} 奖金已公示：本次新增 ¥${r.s}`, `/bonus?month=${month}`, `bonus-pub-${month}-${r.user_id}-${Date.now()}`);
  revalidatePath("/bonus");
}
