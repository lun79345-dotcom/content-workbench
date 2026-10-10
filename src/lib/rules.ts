import { all, get, run } from "./db";

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
export const BONUS_KINDS = ["爆款奖", "升档补差", "抖音单项奖", "小红书奖", "创意采用奖", "学生悬赏", "其他"];

/** 可配置的虚构演示规则，不代表任何公司的实际考核、分成或奖金制度 */
export const DEFAULT_RULES = {
  tiers: [10000, 30000, 100000],          // 老号爆款档位
  tier_amounts: [100, 300, 800],            // 对应奖金（元），老板可在设置里改
  new_discount: 0.8,                         // 新号前 N 月档位折扣
  new_months: 2,
  editor_share: 0.5,                         // 爆款奖编导分成比例，其余归剪辑
  cut_levels: { 简单: 0.5, 常规: 1, 精剪: 1.5 } as Record<string, number>,
  target_growth: 1.1,
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
  d.setUTCMonth(d.getUTCMonth() + n);
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
  return !!newSince && publishDate < addMonths(newSince, r.new_months);
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

/** 视频双平台合计播放（某个节点） */
export function combinedPlays(videoId: number, checkpoint: "d7" | "d30") {
  const rows = all<{ platform: string; plays: number | null }>(
    "SELECT platform, plays FROM metrics WHERE video_id=? AND checkpoint=? AND platform IN ('douyin','wechat')", videoId, checkpoint);
  const dy = rows.find((r) => r.platform === "douyin")?.plays ?? null;
  const wx = rows.find((r) => r.platform === "wechat")?.plays ?? null;
  return { douyin: dy, wechat: wx, total: (dy ?? 0) + (wx ?? 0), complete: dy != null && wx != null };
}

/**
 * 根据第7天 / 第30天数据，重算该视频的自动奖金（爆款奖 + 升档补差）。
 * 已公示的自动奖金不再改动，避免改账。
 */
export function recalcVideoBonus(videoId: number) {
  const r = getRules();
  const v = get<VideoRow>(`SELECT v.*, a.new_since account_new_since FROM videos v JOIN accounts a ON a.id=v.account_id WHERE v.id=?`, videoId);
  if (!v || !v.published_at) return;
  const isNew = isNewAccountAt(v.account_new_since, v.published_at, r);
  const people: [number | null, number][] = [
    [v.editor_id, r.editor_share],
    [v.cutter_id, 1 - r.editor_share],
  ];
  const upsert = (kind: string, month: string, total: number, desc: string) => {
    for (const [uid, share] of people) {
      if (!uid || share <= 0) continue;
      const amt = Math.round(total * share);
      const ex = get<{ id: number; published: number }>("SELECT id, published FROM bonuses WHERE video_id=? AND kind=? AND user_id=? AND auto=1", videoId, kind, uid);
      if (ex?.published) continue;
      if (amt <= 0) { if (ex) run("DELETE FROM bonuses WHERE id=?", ex.id); continue; }
      if (ex) run("UPDATE bonuses SET amount=?, description=?, month=? WHERE id=?", amt, desc, month, ex.id);
      else run("INSERT INTO bonuses(month,user_id,kind,amount,description,video_id,auto) VALUES(?,?,?,?,?,?,1)", month, uid, kind, amt, desc, videoId);
    }
  };
  const d7 = combinedPlays(videoId, "d7");
  const i7 = d7.complete ? tierIndex(d7.total, isNew, r) : -1;
  const a7 = i7 >= 0 ? r.tier_amounts[i7] : 0;
  upsert("爆款奖", monthOf(addDays(v.published_at, 7)), a7, `${v.code}《${v.title}》7天${fmtNum(d7.total)}，${tierLabel(i7, isNew, r)}${isNew ? "（新号折扣档）" : ""}`);

  const d30 = combinedPlays(videoId, "d30");
  if (d30.complete) {
    const i30 = tierIndex(d30.total, isNew, r);
    const a30 = i30 >= 0 ? r.tier_amounts[i30] : 0;
    upsert("升档补差", monthOf(addDays(v.published_at, 30)), Math.max(0, a30 - a7), `${v.code} 30天${fmtNum(d30.total)}，${tierLabel(i7, isNew, r)}→${tierLabel(i30, isNew, r)}`);
  }
}
