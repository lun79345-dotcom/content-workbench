import { UserFacingError } from "./action-errors";
import { all, get, run, transaction } from "./db";

/** 生产流程阶段，顺序即看板列顺序 */
export const STAGES = ["选题", "脚本", "脚本审核", "拍摄", "剪辑", "成片审核", "待发布", "已发布"] as const;
export type Stage = (typeof STAGES)[number];

/** 每个阶段对应的截止字段（在该阶段停留时用于判断逾期） */
export const STAGE_DUE: Partial<Record<Stage, string>> = {
  选题: "due_script",
  脚本: "due_script",
  脚本审核: "due_script",
  拍摄: "due_shoot",
  剪辑: "due_rough",
  成片审核: "due_review",
  待发布: "publish_date",
};

export const DUE_LABEL: Record<string, string> = {
  due_script: "脚本截止",
  due_shoot: "拍摄截止",
  due_rough: "初剪截止",
  due_review: "审核截止",
  publish_date: "发布日期",
};

export const REJECT_REASONS = [
  "剪辑责任-错别字/字幕",
  "剪辑责任-节奏/包装",
  "剪辑责任-音画问题",
  "剪辑责任-未按需求",
  "编导责任-选题方向",
  "编导责任-脚本问题",
  "编导责任-素材不足",
  "编导责任-冻结后改需求",
  "其他",
];

export const IDEA_SOURCES = ["内部拆解", "评论区挖矿", "学生悬赏", "平台付费", "UGC征集", "对标监控"];
export const IDEA_STATUS = ["待评", "入库", "已排期", "已拍", "已弃"];
export const IDEA_KINDS = ["选题", "钩子", "梗/台词", "形式", "BGM/包装"];
export const BONUS_KINDS = ["爆款奖", "升档补差", "抖音单项奖", "小红书奖", "创意采用奖", "学生悬赏", "其他"];

/** 可在「设置」里修改的规则，带默认值 */
export const DEFAULT_RULES = {
  tiers: [100000, 500000, 1000000],          // 老号爆款档位
  tier_amounts: [200, 500, 1000],            // 对应奖金（元），老板可在设置里改
  new_discount: 0.7,                         // 新号前 N 月档位折扣
  new_months: 2,
  editor_share: 0.6,                         // 爆款奖编导分成比例，其余归剪辑
  cut_levels: { 简单: 0.5, 常规: 1, 精剪: 1.5 } as Record<string, number>,
  target_growth: 1.3,
  freeze_hours: 24,
  script_review_hours: 4,
};
export type Rules = typeof DEFAULT_RULES;

export function getRules(): Rules {
  const r = get<{ value: string }>("SELECT value FROM settings WHERE key='rules'");
  return r ? { ...DEFAULT_RULES, ...JSON.parse(r.value) } : DEFAULT_RULES;
}
export function saveRules(r: Rules) {
  run("INSERT INTO settings(key,value) VALUES('rules',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(r));
}
export function getSetting(key: string) {
  return get<{ value: string }>("SELECT value FROM settings WHERE key=?", key)?.value;
}
export function setSetting(key: string, value: string) {
  run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value);
}

// ---------- 日期工具（统一按北京时间） ----------
export function today(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
}
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function addMonths(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string) {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}
export function monthOf(date: string) {
  return date.slice(0, 7);
}
export function isoWeek(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}
export function weekRange(week: string): [string, string] {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
  const s = mon.toISOString().slice(0, 10);
  return [s, addDays(s, 6)];
}
export function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + "w";
  return String(n);
}
export function shortDate(d?: string | null) {
  return d ? d.slice(5) : "—";
}

// ---------- 逾期 / 冻结 ----------
export type VideoRow = {
  id: number; code: string; title: string; account_id: number; editor_id: number; cutter_id: number | null;
  stage: Stage; due_script: string | null; due_shoot: string | null; due_rough: string | null; due_review: string | null;
  publish_date: string | null; published_at: string | null; cut_level: string; extra_units: number;
  content_type: string | null; douyin_url: string | null; wechat_url: string | null; xhs_url: string | null;
  brief: string | null; note: string | null; analysis: string | null; idea_id: number | null;
  archived_at?: string | null; late_exempt_reason?: string | null; bonus_snapshot?: string | null;
  revision: number;
  account_name?: string; editor_name?: string; cutter_name?: string; account_new_since?: string | null;
};

export function currentDue(v: VideoRow): { field: string; date: string | null } | null {
  const f = STAGE_DUE[v.stage];
  if (!f) return null;
  return { field: f, date: (v as unknown as Record<string, string | null>)[f] };
}
export function overdueDays(v: VideoRow, t = today()): number {
  const due = currentDue(v);
  if (!due?.date) return 0;
  return Math.max(0, diffDays(t, due.date));
}
export function isFrozen(v: VideoRow, t = today()) {
  return !!v.publish_date && v.stage !== "已发布" && diffDays(v.publish_date, t) <= 1;
}

/** 当前阶段谁该动手 */
export function stageOwner(v: VideoRow, leaderId: number | null): number | null {
  if (v.stage === "脚本审核" || v.stage === "成片审核") {
    const pending = get<{ reviewer_id: number }>("SELECT reviewer_id FROM reviews WHERE video_id=? AND status='待审' ORDER BY id DESC LIMIT 1", v.id);
    if (pending) return pending.reviewer_id;
  }
  switch (v.stage) {
    case "选题": case "脚本": case "拍摄": return v.editor_id;
    case "脚本审核": return leaderId;
    case "剪辑": return v.cutter_id;
    case "成片审核": return v.editor_id;
    case "待发布": return v.editor_id;
    default: return null;
  }
}

// ---------- 爆款定档 ----------
export function isNewAccountAt(newSince: string | null | undefined, publishDate: string, r = getRules()) {
  return !!newSince && publishDate >= newSince && publishDate < addMonths(newSince, r.new_months);
}
export function tierThresholds(isNew: boolean, r = getRules()) {
  return r.tiers.map((t) => Math.round(t * (isNew ? r.new_discount : 1)));
}
/** 返回档位下标（-1 = 未达档） */
export function tierIndex(plays: number, isNew: boolean, r = getRules()) {
  const th = tierThresholds(isNew, r);
  let idx = -1;
  th.forEach((t, i) => { if (plays >= t) idx = i; });
  return idx;
}
export function tierLabel(idx: number, isNew: boolean, r = getRules()) {
  if (idx < 0) return "未达档";
  return fmtNum(tierThresholds(isNew, r)[idx]) + "+";
}

export type PlayPlatform = "douyin" | "wechat";
type PublishedPlatforms = Pick<VideoRow, "douyin_url" | "wechat_url" | "xhs_url">;
/** Blank links on legacy records retain the old dual-platform requirement. */
export function playPlatforms(v: PublishedPlatforms): PlayPlatform[] {
  const selected = (["douyin", "wechat"] as const).filter((p) => v[`${p}_url`]);
  return selected.length || v.xhs_url ? selected : ["douyin", "wechat"];
}
export function playTotals(v: PublishedPlatforms, dy: number | null, wx: number | null, platforms = playPlatforms(v)) {
  const douyin = platforms.includes("douyin") ? dy : null, wechat = platforms.includes("wechat") ? wx : null;
  return { douyin, wechat, platforms, applicable: platforms.length > 0,
    total: (douyin ?? 0) + (wechat ?? 0), complete: platforms.length > 0 && platforms.every((p) => (p === "douyin" ? dy : wx) != null) };
}
/** Only actual published platforms contribute; unpublished platforms require no invented zero. */
export function combinedPlays(videoId: number, checkpoint: "d7" | "d30", platforms?: PlayPlatform[]) {
  const v = get<VideoRow>("SELECT * FROM videos WHERE id=?", videoId);
  if (!v) throw new UserFacingError("视频不存在");
  const rows = all<{ platform: string; plays: number | null }>(
    "SELECT platform, plays FROM metrics WHERE video_id=? AND checkpoint=? AND platform IN ('douyin','wechat')", videoId, checkpoint);
  const dy = rows.find((r) => r.platform === "douyin")?.plays ?? null;
  const wx = rows.find((r) => r.platform === "wechat")?.plays ?? null;
  return playTotals(v, dy, wx, platforms);
}
export function needsMetrics(videoId: number, checkpoint: "d7" | "d30") {
  const v = get<VideoRow>("SELECT * FROM videos WHERE id=?", videoId);
  if (!v) return false;
  const basis: BonusBasis | null = v.bonus_snapshot ? JSON.parse(v.bonus_snapshot) : null;
  const plays = combinedPlays(videoId, checkpoint, bonusPlatforms(basis));
  const xhs = v.xhs_url && checkpoint === "d7" ? get<{ likes: number | null; collects: number | null }>("SELECT likes,collects FROM metrics WHERE video_id=? AND checkpoint='d7' AND platform='xhs'", videoId) : null;
  return (plays.applicable && !plays.complete) || !!(v.xhs_url && checkpoint === "d7" && (xhs?.likes == null || xhs?.collects == null));
}

export type BonusBasis = { editor_id: number; cutter_id: number | null; new_since: string | null; rules: Rules; platforms?: PlayPlatform[] };
export function bonusPlatforms(basis: BonusBasis | null): PlayPlatform[] | undefined {
  // Existing confirmed snapshots were calculated using both platforms before this migration.
  return basis ? basis.platforms ?? ["douyin", "wechat"] : undefined;
}
export function freezeBonusBasis(videoId: number) {
  const v = get<VideoRow>("SELECT v.*, a.new_since account_new_since FROM videos v LEFT JOIN accounts a ON a.id=v.account_id WHERE v.id=?", videoId);
  if (v && !v.bonus_snapshot) {
    const basis: BonusBasis = { editor_id: v.editor_id, cutter_id: v.cutter_id, new_since: v.account_new_since ?? null, rules: getRules(), platforms: playPlatforms(v) };
    run("UPDATE videos SET bonus_snapshot=? WHERE id=?", JSON.stringify(basis), videoId);
  }
}

/** Reconcile pending entries against the actual locked ledger, including corrections. */
export function recalcVideoBonus(videoId: number) {
  return transaction(() => {
    let v = get<VideoRow>("SELECT v.*, a.new_since account_new_since FROM videos v LEFT JOIN accounts a ON a.id=v.account_id WHERE v.id=?", videoId);
    if (!v?.published_at) return;
    const locked = all<{ user_id: number; kind: string; amount: number }>("SELECT user_id,kind,amount FROM bonuses WHERE video_id=? AND auto=1 AND published=1", videoId);
    if (locked.length && !v.bonus_snapshot) { freezeBonusBasis(videoId); v = get<VideoRow>("SELECT * FROM videos WHERE id=?", videoId)!; }
    const basis: BonusBasis = v.bonus_snapshot ? JSON.parse(v.bonus_snapshot) : { editor_id: v.editor_id, cutter_id: v.cutter_id, new_since: v.account_new_since ?? null, rules: getRules() };
    const r = basis.rules, isNew = isNewAccountAt(basis.new_since, v.published_at!, r);
    const platforms = bonusPlatforms(v.bonus_snapshot ? basis : null);
    const d7 = combinedPlays(videoId, "d7", platforms), d30 = combinedPlays(videoId, "d30", platforms);
    const i7 = d7.complete ? tierIndex(d7.total, isNew, r) : -1;
    const i30 = d30.complete ? tierIndex(d30.total, isNew, r) : -1;
    const a7 = i7 < 0 ? 0 : r.tier_amounts[i7], a30 = i30 < 0 ? 0 : r.tier_amounts[i30];
    const allocation = (amount: number) => {
      const cents = Math.round(amount * 100), editor = Math.round(cents * r.editor_share);
      const amounts = new Map<number, number>();
      for (const [uid, value] of [[basis.editor_id, editor], [basis.cutter_id, cents - editor]] as const) {
        if (uid) amounts.set(uid, (amounts.get(uid) ?? 0) + value);
      }
      return amounts;
    };
    const amounts7 = allocation(a7), amounts30 = allocation(a30);
    // Remove ALL unconfirmed automatic rows first, including former assignees. Locked rows stay immutable.
    run("DELETE FROM bonuses WHERE video_id=? AND auto=1 AND published=0", videoId);
    for (const uid of amounts7.keys()) {
      const paid7 = locked.filter((b) => b.user_id === uid && b.kind === "爆款奖").reduce((s, b) => s + Math.round(b.amount * 100), 0);
      const paid30 = locked.filter((b) => b.user_id === uid && b.kind === "升档补差").reduce((s, b) => s + Math.round(b.amount * 100), 0);
      const desired7 = d7.complete ? amounts7.get(uid)! : paid7;
      const desired30 = d30.complete ? Math.max(0, amounts30.get(uid)! - desired7) : paid30;
      for (const [kind, delta, day, data, idx] of [
        ["爆款奖", desired7 - paid7, 7, d7, i7],
        ["升档补差", desired30 - paid30, 30, d30, i30],
      ] as const) {
        if (delta === 0 || !data.complete) continue;
        const adjusted = locked.length > 0;
        const month = adjusted ? monthOf(today()) : monthOf(addDays(v.published_at!, day));
        const description = `${v.code}《${v.title}》${day}天${fmtNum(data.total)}，${tierLabel(idx, isNew, r)}${adjusted ? (delta < 0 ? " · 冲正" : " · 补差调整") : ""}`;
        run("INSERT INTO bonuses(month,user_id,kind,amount,description,video_id,auto) VALUES(?,?,?,?,?,?,1)", month, uid, kind, delta / 100, description, videoId);
      }
    }
  });
}
