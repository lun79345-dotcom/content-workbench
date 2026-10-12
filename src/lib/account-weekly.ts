import { createHash } from "node:crypto";
import type { User } from "./auth";
import { all, get } from "./db";
import { dataCheckpoint, dataRows, type DataRow } from "./stats";
import { addDays, getRules, isNewAccountAt, tierIndex, today, weekRange, type BonusBasis } from "./rules";
import type { Account } from "./queries";

export type AccountReview = { account_id: number; week: string; summary: string | null; successes: string | null; issues: string | null; next_plan: string | null; revision: number; updated_at: string; updated_by: number };
export type ReviewJob = { id: number; status: string; report_json: string | null; error: string | null; requested_at: string; completed_at: string | null; input_hash: string; input_json: string };

export function canReviewAccount(me: Pick<User, "id" | "role">, account: Pick<Account, "id" | "editor_id">) {
  return me.role === "boss" || (me.role === "editor" && (account.editor_id === me.id || (account.editor_id == null && !!get("SELECT id FROM videos WHERE account_id=? AND editor_id=? LIMIT 1", account.id, me.id))));
}

const row = (v: DataRow) => {
  const cp = dataCheckpoint(v, "d7");
  return { id: v.id, code: v.code, title: v.title, content_type: v.content_type, published_at: v.published_at,
    platforms: [v.douyin_url && "douyin", v.wechat_url && "wechat", v.xhs_url && "xhs"].filter(Boolean),
    douyin_plays_d7: v.dy7, wechat_plays_d7: v.wx7, total_plays_d7: cp.complete ? cp.total : null,
    plays_applicable: cp.applicable, plays_complete: cp.complete, fans_d7: v.fans7,
    xhs_likes: v.xhs_likes, xhs_collects: v.xhs_collects };
};

export function accountWeek(accountId: number, week: string, asOf = today()) {
  const account = get<Account>("SELECT * FROM accounts WHERE id=?", accountId);
  if (!account) return null;
  const [start, end] = weekRange(week), cutoff = end < asOf ? end : asOf;
  const rows = dataRows(undefined, { accountId, start: addDays(start, -14), end });
  const period = (offset: number) => {
    const s = addDays(start, offset), e = addDays(end, offset);
    const vs = rows.filter((v) => v.published_at >= s && v.published_at <= e && v.published_at <= cutoff);
    return { start: s, end: e, published: vs.length, douyin: vs.filter((v) => v.douyin_url).length,
      wechat: vs.filter((v) => v.wechat_url).length, xhs: vs.filter((v) => v.xhs_url).length,
      dual: vs.filter((v) => v.douyin_url && v.wechat_url).length, videos: vs.map(row) };
  };
  // Performance is one publication week behind, so a newly published video is never compared with a mature one as zero.
  const mature = (offset: number) => {
    const s = addDays(start, offset), e = addDays(end, offset);
    const vs = rows.filter((v) => v.published_at >= s && v.published_at <= e && addDays(v.published_at, 7) <= cutoff);
    const applicable = vs.filter((v) => dataCheckpoint(v, "d7").applicable);
    const complete = applicable.filter((v) => dataCheckpoint(v, "d7").complete);
    const plays = complete.length ? complete.reduce((n, v) => n + dataCheckpoint(v, "d7").total, 0) : null;
    const hits = complete.filter((v) => {
      const basis: BonusBasis | null = v.bonus_snapshot ? JSON.parse(v.bonus_snapshot) : null;
      const rules = basis?.rules ?? getRules();
      return tierIndex(dataCheckpoint(v, "d7").total, isNewAccountAt(basis ? basis.new_since : account.new_since, v.published_at, rules), rules) >= 0;
    }).length;
    return { start: s, end: e, eligible: vs.length, applicable: applicable.length, complete: complete.length,
      missing: applicable.length - complete.length, plays, average_plays: plays == null ? null : Math.round(plays / complete.length),
      hits, videos: vs.map(row) };
  };
  const current = period(0), previous = period(-7), performance = mature(-7), previousPerformance = mature(-14);
  return { review_version: 1, account: { id: account.id, name: account.name, kind: account.kind }, week, start, end, as_of: asOf, data_cutoff: cutoff, is_complete_week: end < asOf,
    current, previous, performance, previous_performance: previousPerformance,
    reserve: get<{ n: number }>("SELECT count(*) n FROM videos WHERE account_id=? AND archived_at IS NULL AND stage IN ('拍摄','剪辑','成片审核','待发布')", accountId)!.n,
    notes: ["发布条数按发布日期统计；播放表现按复盘截止日已满7天的上一发布周作品统计。", "data_cutoff是复盘截止日，as_of是查询日期；本周未结束时不能把部分周发布量直接与完整上周比较。", "播放只使用当前已登记的第7天数据；历史周会随补录更新，不是当时的数据快照。缺失为未知，真实零值保留。", "小红书赞藏是现有记录值，不代表本周净增长；没有账号总粉丝、完播率、留存或同行数据。", "当前储备按查询时状态统计，不是历史周末快照。"] };
}

export type AccountWeek = NonNullable<ReturnType<typeof accountWeek>>;
export function snapshotHash(snapshot: AccountWeek) { return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"); }
export function latestAccountJob(accountId: number, week: string) { return get<ReviewJob>("SELECT * FROM account_review_jobs WHERE account_id=? AND week=? ORDER BY id DESC LIMIT 1", accountId, week); }
export function accountReview(accountId: number, week: string) { return get<AccountReview>("SELECT * FROM account_weekly WHERE account_id=? AND week=?", accountId, week); }
export function workerOnline() {
  const heartbeat = get<{ value: string }>("SELECT value FROM settings WHERE key='account_review_worker_seen'")?.value;
  const age = heartbeat ? Date.now() - Date.parse(heartbeat) : NaN;
  return Number.isFinite(age) && age >= -10000 && age < 90000;
}
export function pendingAccountJobs() { return all("SELECT id FROM account_review_jobs WHERE status IN ('queued','running')"); }
