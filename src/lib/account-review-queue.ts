import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { validateAccountReport } from "./account-review-report";

const FAILURE_MESSAGES: Record<string, string> = {
  auth: "Codex 登录已失效，请在运行服务的电脑重新登录后重试。",
  timeout: "Codex 分析超时，可以稍后重试；手动复盘不受影响。",
  format: "AI 返回的内容格式或作品引用不正确，请重试。",
  stopped: "分析服务中断，本次任务已结束，可以重新生成。",
  unavailable: "Codex 暂时无法完成分析，请稍后重试。",
};
export function reportVideoIds(input: unknown): Set<number> {
  if (!input || typeof input !== "object") throw new Error("invalid snapshot");
  const o = input as Record<string, unknown>, ids = new Set<number>();
  for (const name of ["current", "previous", "performance", "previous_performance"]) {
    const group = o[name] as { videos?: unknown[] } | undefined;
    if (!Array.isArray(group?.videos) || group.videos.length > 5000) throw new Error("invalid snapshot");
    for (const entry of group.videos) {
      const id = (entry as { id?: number })?.id;
      if (!Number.isSafeInteger(id) || id! <= 0) throw new Error("invalid video id");
      ids.add(id!);
    }
  }
  return ids;
}
function atomic<T>(d: DatabaseSync, fn: () => T) {
  d.exec("BEGIN IMMEDIATE");
  try { const result = fn(); d.exec("COMMIT"); return result; }
  catch (e) { d.exec("ROLLBACK"); throw e; }
}
export function heartbeatReviewWorker(d: DatabaseSync, now = Date.now()) {
  d.prepare("INSERT INTO settings(key,value) VALUES('account_review_worker_seen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date(now).toISOString());
}
export function claimAccountReview(d: DatabaseSync, now = Date.now()) {
  return atomic(d, () => {
    heartbeatReviewWorker(d, now);
    d.prepare("UPDATE account_review_jobs SET status='failed',error=?,completed_at=datetime('now','+8 hours'),lease_id=NULL,lease_until=NULL WHERE status='running' AND (lease_until IS NULL OR lease_until<=?)")
      .run(FAILURE_MESSAGES.stopped, new Date(now).toISOString());
    const job = d.prepare("SELECT id,input_json FROM account_review_jobs WHERE status='queued' ORDER BY id LIMIT 1").get() as { id: number; input_json: string } | undefined;
    if (!job) return null;
    let input: unknown;
    try { input = JSON.parse(job.input_json); reportVideoIds(input); }
    catch {
      d.prepare("UPDATE account_review_jobs SET status='failed',error=?,completed_at=datetime('now','+8 hours') WHERE id=?").run(FAILURE_MESSAGES.format, job.id);
      return null;
    }
    const lease = randomUUID();
    d.prepare("UPDATE account_review_jobs SET status='running',lease_id=?,lease_until=?,started_at=datetime('now','+8 hours'),error=NULL WHERE id=? AND status='queued'")
      .run(lease, new Date(now + 6 * 60000).toISOString(), job.id);
    return { id: job.id, lease, input };
  });
}
export function finishAccountReview(d: DatabaseSync, id: number, lease: string, report: unknown, now = Date.now()) {
  return atomic(d, () => {
    const job = d.prepare("SELECT * FROM account_review_jobs WHERE id=? AND status='running' AND lease_id=? AND lease_until>?").get(id, lease, new Date(now).toISOString()) as { input_json: string; requested_by: number; account_id: number; week: string } | undefined;
    if (!job) return false;
    const result = validateAccountReport(report, reportVideoIds(JSON.parse(job.input_json)));
    d.prepare("UPDATE account_review_jobs SET status='done',report_json=?,error=NULL,completed_at=datetime('now','+8 hours'),lease_id=NULL,lease_until=NULL WHERE id=?")
      .run(JSON.stringify(result), id);
    d.prepare("INSERT INTO audit_log(actor_id,entity,entity_id,action,after_json) VALUES(?,'account_weekly',?,?,?)")
      .run(job.requested_by, job.account_id, `生成AI账号复盘 ${job.week}`, JSON.stringify({ job_id: id }));
    return true;
  });
}
export function failAccountReview(d: DatabaseSync, id: number, lease: string, code: string) {
  const result = d.prepare("UPDATE account_review_jobs SET status='failed',error=?,completed_at=datetime('now','+8 hours'),lease_id=NULL,lease_until=NULL WHERE id=? AND status='running' AND lease_id=?")
    .run(FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES.unavailable, id, lease);
  return result.changes === 1;
}
