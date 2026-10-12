"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit, get, run, transaction } from "@/lib/db";
import { actionResult, UserFacingError } from "@/lib/action-errors";
import { accountWeek, accountReview, canReviewAccount, latestAccountJob, pendingAccountJobs, snapshotHash, workerOnline } from "@/lib/account-weekly";
import type { Account } from "@/lib/queries";
import { id, number, text, week as validWeek } from "@/lib/validation";

async function context(fd: FormData) {
  const me = await requireUser(), accountId = id(fd, "account_id"), week = validWeek(text(fd, "week"));
  const account = get<Account>("SELECT * FROM accounts WHERE id=?", accountId);
  if (!account || !canReviewAccount(me, account)) throw new UserFacingError("只有老板或该账号的负责编导可以编辑账号复盘");
  return { me, accountId, week };
}

export async function saveAccountReviewForm(fd: FormData) {
  return actionResult(async () => {
    const { me, accountId, week } = await context(fd), revision = number(fd, "revision", { integer: true, required: true })!;
    const values = ["summary", "successes", "issues", "next_plan"].map((key) => text(fd, key, false, 10000));
    transaction(() => {
      const before = accountReview(accountId, week);
      if ((before?.revision ?? 0) !== revision) throw new UserFacingError("这份账号复盘已被其他人更新，请刷新后再编辑");
      run(`INSERT INTO account_weekly(account_id,week,summary,successes,issues,next_plan,updated_by,revision) VALUES(?,?,?,?,?,?,?,1)
        ON CONFLICT(account_id,week) DO UPDATE SET summary=excluded.summary,successes=excluded.successes,issues=excluded.issues,next_plan=excluded.next_plan,
        updated_by=excluded.updated_by,revision=account_weekly.revision+1,updated_at=datetime('now','+8 hours')`, accountId, week, ...values, me.id);
      audit(me.id, "account_weekly", accountId, `保存账号复盘 ${week}`, before, accountReview(accountId, week));
    }); revalidatePath("/weekly");
  });
}

export async function generateAccountReviewForm(fd: FormData) {
  return actionResult(async () => {
    const { me, accountId, week } = await context(fd);
    const snapshot = accountWeek(accountId, week)!;
    const hash = snapshotHash(snapshot);
    transaction(() => {
      const last = latestAccountJob(accountId, week);
      if (last && ["queued", "running"].includes(last.status)) throw new UserFacingError("这个账号的复盘正在生成，请稍后刷新查看");
      if (last?.status === "done" && last.input_hash === hash) throw new UserFacingError("当前数据已经生成过复盘，可直接采用已有建议；数据更新后可以重新生成");
      if (!workerOnline()) throw new UserFacingError("AI 服务暂未连接，请确认运行 Codex 的电脑已开机并联网，再重试");
      if (pendingAccountJobs().length >= 20) throw new UserFacingError("待生成复盘较多，请稍后再试");
      run("INSERT INTO account_review_jobs(account_id,week,requested_by,input_json,input_hash) VALUES(?,?,?,?,?)", accountId, week, me.id, JSON.stringify(snapshot), hash);
      audit(me.id, "account_weekly", accountId, `请求AI账号复盘 ${week}`, null, { input_hash: hash });
    }); revalidatePath("/weekly");
  });
}
