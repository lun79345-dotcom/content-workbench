import { randomUUID } from "node:crypto";
import { all, get, run, transaction } from "./db";
import { saveMetricSnapshot } from "./metric-snapshots";
import { today } from "./rules";
import { douyinCounts, exactCount, object, parseDouyinPlayBatch, wechatCounts, type PublicStats } from "./tikhub-data";

const BASE = "https://api.tikhub.io";
type Video = { id: number; published_at: string; douyin_url: string | null; wechat_url: string | null; xhs_url: string | null };
type Platform = "douyin" | "wechat" | "xhs";
class BudgetError extends Error {}
class AccessError extends Error {}
const limit = (name: string, fallback: number, max: number) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
};
export function tikhubLimits() {
  const override = (key: string, fallback: number, max: number) => {
    const raw = get<{ value: string }>("SELECT value FROM settings WHERE key=?", key)?.value;
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
  };
  return { requests: override("tikhub_daily_requests", limit("TIKHUB_DAILY_REQUEST_LIMIT", 100, 10000), 10000),
    playBatches: override("tikhub_daily_play_batches", limit("TIKHUB_DAILY_PLAY_BATCH_LIMIT", 10, 1000), 1000) };
}
export function tikhubUsage() {
  return { requests: get<{ n: number }>("SELECT count(*) n FROM tikhub_requests WHERE request_date=?", today())!.n,
    playBatches: get<{ n: number }>("SELECT count(*) n FROM tikhub_requests WHERE request_date=? AND kind='plays'", today())!.n };
}
export async function call(method: "GET" | "POST", path: string, params: Record<string, string | boolean>, kind = "interaction") {
  const key = process.env.TIKHUB_API_KEY;
  if (!key) throw new Error("未配置 TIKHUB_API_KEY");
  const allowed = transaction(() => {
    const usage = tikhubUsage(), cap = tikhubLimits();
    if (usage.requests >= cap.requests || (kind === "plays" && usage.playBatches >= cap.playBatches)) return false;
    // Reserve before sending: timeouts/errors also consume the local daily request budget.
    run("INSERT INTO tikhub_requests(request_date,kind) VALUES(?,?)", today(), kind);
    return true;
  });
  if (!allowed) throw new BudgetError("达到今日采集上限，明天继续");
  const query = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  const r = await fetch(BASE + path + (method === "GET" ? "?" + query : ""), {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "wanying-workflow/1.0" },
    body: method === "POST" ? JSON.stringify(params) : undefined, signal: AbortSignal.timeout(40000), cache: "no-store",
  });
  if (!r.ok) {
    const error = `TikHub 请求失败（HTTP ${r.status}）`;
    if ([401, 403, 429].includes(r.status)) throw new AccessError(error);
    throw new Error(error);
  }
  const j = object(await r.json());
  if (j.code !== 200) {
    if ([401, 403, 429].includes(Number(j.code))) throw new AccessError("TikHub 权限、额度或限流异常，请检查服务后台");
    throw new Error("TikHub 未返回有效数据，请检查服务后台");
  }
  return j.data;
}
function idFromUrl(url: string) {
  return url.match(/\/(?:video|note)\/(\d{15,22})(?:\D|$)/)?.[1] ?? null;
}
async function douyinDetail(shareUrl: string) {
  const id = idFromUrl(shareUrl) ?? get<{ item_id: string }>("SELECT item_id FROM platform_video_ids WHERE platform='douyin' AND publication_url=? LIMIT 1", shareUrl)?.item_id;
  const d = await call("GET", id ? "/api/v1/douyin/app/v3/fetch_one_video" : "/api/v1/douyin/app/v3/fetch_one_video_by_share_url",
    id ? { aweme_id: id } : { share_url: (shareUrl.match(/https?:\/\/\S+/) ?? [shareUrl])[0] });
  const detail = object(object(d).aweme_detail), stats = douyinCounts(detail.statistics);
  stats.plays = null; // The old detail endpoint isn't a trusted source for play counts.
  if ([stats.likes, stats.comments, stats.collects, stats.shares].every(x => x == null)) throw new Error("抖音互动数据缺失");
  return { id: typeof detail.aweme_id === "string" && /^\d{15,22}$/.test(detail.aweme_id) ? detail.aweme_id : id, stats };
}
export async function douyinStats(url: string) { return (await douyinDetail(url)).stats; }
export async function wechatStats(shareUrl: string): Promise<PublicStats> {
  const stats = wechatCounts(await call("POST", "/api/v1/wechat_channels/v2/fetch_video_detail", { share_url: shareUrl, raw: false }));
  if ([stats.likes, stats.comments, stats.collects, stats.shares].every(x => x == null)) throw new Error("视频号互动数据缺失");
  return stats;
}
export async function xhsStats(url: string): Promise<PublicStats> {
  const id = url.match(/(?:explore|item|discovery\/item)\/([0-9a-f]{24})/)?.[1];
  const data = await call("GET", "/api/v1/xiaohongshu/app_v2/get_video_note_detail", id ? { note_id: id } : { share_text: url });
  const num = (key: string) => exactCount(deepFind(data, key));
  const stats = { plays: null, likes: num("liked_count"), comments: num("comments_count") ?? num("comment_count"),
    collects: num("collected_count"), shares: num("shared_count") ?? num("share_count") };
  if ([stats.likes, stats.comments, stats.collects, stats.shares].every(x => x == null)) throw new Error("小红书互动数据缺失");
  return stats;
}
function deepFind(x: unknown, key: string, depth = 0): unknown {
  if (!x || typeof x !== "object" || depth > 8) return undefined;
  if (key in x) return object(x)[key];
  for (const value of Object.values(x)) { const result = deepFind(value, key, depth + 1); if (result !== undefined) return result; }
  return undefined;
}
function attempt(v: Video, platform: Platform, kind: "plays" | "interaction", force = false) {
  return transaction(() => {
    const old = get<{ attempts: number; success: number }>("SELECT attempts,success FROM tikhub_attempts WHERE video_id=? AND platform=? AND kind=? AND attempt_date=?", v.id, platform, kind, today());
    if (old && (old.attempts >= 2 || (old.success && (!force || kind === "plays")))) return false;
    run(`INSERT INTO tikhub_attempts(video_id,platform,kind,attempt_date,attempts) VALUES(?,?,?,?,1)
      ON CONFLICT(video_id,platform,kind,attempt_date) DO UPDATE SET attempts=attempts+1`, v.id, platform, kind, today());
    return true;
  });
}
function success(v: Video, platform: Platform, kind: string) {
  run("UPDATE tikhub_attempts SET success=1 WHERE video_id=? AND platform=? AND kind=? AND attempt_date=?", v.id, platform, kind, today());
}
function saveLive(v: Video, platform: Platform, url: string, stats: PublicStats) {
  const current = get<Video>("SELECT * FROM videos WHERE id=? AND archived_at IS NULL AND stage='已发布'", v.id);
  if (!current || current.published_at !== v.published_at || current[`${platform}_url`] !== url) return false;
  transaction(() => {
    run(`INSERT INTO metrics(video_id,checkpoint,platform,plays,likes,comments,collects,shares,source) VALUES(?,'live',?,?,?,?,?,?,'tikhub')
      ON CONFLICT(video_id,checkpoint,platform) DO UPDATE SET plays=COALESCE(excluded.plays,metrics.plays),
      likes=COALESCE(excluded.likes,metrics.likes),comments=COALESCE(excluded.comments,metrics.comments),collects=COALESCE(excluded.collects,metrics.collects),
      shares=COALESCE(excluded.shares,metrics.shares),source='tikhub',updated_at=datetime('now','+8 hours')`, v.id, platform, stats.plays, stats.likes, stats.comments, stats.collects, stats.shares);
    const at = get<{ at: string }>("SELECT datetime('now','+8 hours') at")!.at;
    const sameDay = get<PublicStats>("SELECT plays,likes,comments,collects,shares FROM metric_snapshots WHERE video_id=? AND platform=? AND collected_date=? AND publication_url=? AND published_at=?", v.id, platform, at.slice(0, 10), url, v.published_at);
    saveMetricSnapshot({ plays: stats.plays ?? sameDay?.plays ?? null, likes: stats.likes ?? sameDay?.likes ?? null,
      comments: stats.comments ?? sameDay?.comments ?? null, collects: stats.collects ?? sameDay?.collects ?? null, shares: stats.shares ?? sameDay?.shares ?? null,
      video_id: v.id, platform, collected_date: at.slice(0, 10), collected_at: at,
      published_at: v.published_at, publication_url: url, source: "tikhub" });
  });
  return true;
}
/** Every successful play reading is fetched at most once per day, including manual syncs. */
export async function syncTikhub(force = false) {
  if (!process.env.TIKHUB_API_KEY) return { ok: 0, fail: 0, skipped: "未配置 TIKHUB_API_KEY" };
  const token = randomUUID();
  const claimed = transaction(() => {
    const old = get<{ value: string }>("SELECT value FROM settings WHERE key='tikhub_sync_lock'");
    if (old) { try { if (JSON.parse(old.value).until > Date.now()) return false; } catch {} }
    run("INSERT INTO settings(key,value) VALUES('tikhub_sync_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify({ token, until: Date.now() + 2 * 60 * 60 * 1000 }));
    return true;
  });
  if (!claimed) return { ok: 0, fail: 0, skipped: "采集正在进行，请稍后刷新" };
  let ok = 0, fail = 0, playsOk = 0, stopped = false;
  const errors: string[] = [], details = new Map<number, PublicStats>();
  const failed = (label: string, error: unknown) => {
    fail++; errors.push(`${label}：${error instanceof Error ? error.message : "采集失败"}`);
    if (error instanceof BudgetError || error instanceof AccessError) stopped = true;
  };
  try {
    const vids = all<Video>(`SELECT id,published_at,douyin_url,wechat_url,xhs_url FROM videos WHERE archived_at IS NULL AND stage='已发布'
      AND published_at BETWEEN date('now','+8 hours','-31 day') AND date('now','+8 hours')
      ORDER BY CASE WHEN published_at IN (date('now','+8 hours','-7 day'),date('now','+8 hours','-30 day')) THEN 0 ELSE 1 END,published_at,id`);
    const ready: { v: Video; id: string }[] = [];
    if (tikhubLimits().playBatches > 0) for (const v of vids) {
      if (stopped) break;
      if (!v.douyin_url || !attempt(v, "douyin", "plays")) continue;
      try {
        let id = idFromUrl(v.douyin_url) ?? get<{ item_id: string }>("SELECT item_id FROM platform_video_ids WHERE video_id=? AND platform='douyin' AND publication_url=?", v.id, v.douyin_url)?.item_id;
        if (!id) {
          const detail = await douyinDetail(v.douyin_url); id = detail.id ?? undefined;
          details.set(v.id, detail.stats);
          if (!id) throw new Error("分享链接未返回有效作品编号");
          run("INSERT INTO platform_video_ids(video_id,platform,publication_url,item_id) VALUES(?,'douyin',?,?) ON CONFLICT(video_id,platform) DO UPDATE SET publication_url=excluded.publication_url,item_id=excluded.item_id", v.id, v.douyin_url, id);
        }
        ready.push({ v, id });
      } catch (e) { failed(`${v.id}/抖音播放`, e); }
    }
    for (let offset = 0; offset < ready.length && !stopped; offset += 50) {
      const batch = ready.slice(offset, offset + 50), ids = [...new Set(batch.map(x => x.id))];
      try {
        const data = await call("GET", "/api/v1/douyin/app/v3/fetch_multi_video_statistics", { aweme_ids: ids.join(",") }, "plays");
        const results = parseDouyinPlayBatch(data, ids);
        for (const { v, id } of batch) {
          const stats = results.get(id);
          if (!stats) { failed(`${v.id}/抖音播放`, new Error("播放量缺失或响应格式无法识别，保留未知")); continue; }
          if (saveLive(v, "douyin", v.douyin_url!, stats)) { playsOk++; success(v, "douyin", "plays"); }
        }
      } catch (e) { failed("抖音播放批量采集", e); }
    }
    for (const v of vids) {
      if (stopped) break;
      for (const [platform, url, fn] of [["douyin", v.douyin_url, douyinStats], ["wechat", v.wechat_url, wechatStats], ["xhs", v.xhs_url, xhsStats]] as const) {
        if (stopped) break;
        if (!url || !attempt(v, platform, "interaction", force)) continue;
        try {
          const stats = platform === "douyin" && details.has(v.id) ? details.get(v.id)! : await fn(url);
          if (saveLive(v, platform, url, stats)) { ok++; success(v, platform, "interaction"); }
        } catch (e) { failed(`${v.id}/${platform}`, e); }
      }
    }
    return { ok, playsOk, fail, errors: errors.slice(0, 20), usage: tikhubUsage(), limits: tikhubLimits() };
  } finally {
    run("DELETE FROM settings WHERE key='tikhub_sync_lock' AND value LIKE ?", `%${token}%`);
  }
}
