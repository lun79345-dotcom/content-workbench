"use server";
import { UserFacingError, actionResult } from "@/lib/action-errors";
import { revalidatePath } from "next/cache";
import { requireBoss } from "@/lib/auth";
import { audit, get, run, transaction } from "@/lib/db";

import { bounded, month, text, id } from "@/lib/validation";

export async function saveTarget(fd: FormData) {
  const me = await requireBoss();
  const raw = String(fd.get("target") ?? "").replace(/[,，\s]/g, "");
  const v = raw === "" ? null : Math.round(Number(raw.replace(/w$/i, "")) * (/w$/i.test(raw) ? 10000 : 1));
  const m = month(text(fd, "month")), aid = id(fd, "account_id");
  if (v != null) bounded(v, "目标播放", { integer: true });
  if (!get("SELECT id FROM accounts WHERE id=?", aid)) throw new UserFacingError("账号不存在");
  transaction(() => {
  const before = get("SELECT target_plays FROM targets WHERE month=? AND account_id=?", m, aid);
  run("INSERT INTO targets(month, account_id, target_plays) VALUES(?,?,?) ON CONFLICT(month, account_id) DO UPDATE SET target_plays=excluded.target_plays",
    m, aid, v);
  audit(me.id, "target", aid, "设置月目标", before, { month: m, target: v });
  });
  revalidatePath("/data");
  revalidatePath("/dashboard");
}

export async function saveTargetForm(fd: FormData) { return actionResult(() => saveTarget(fd)); }
