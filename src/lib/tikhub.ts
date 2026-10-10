// TikHub：抓公开互动数据（点赞/评论/收藏/分享）。抖音、视频号的播放量平台不公开，实测返回 0，不从这里取。
import { all, run } from "./db";

const BASE = "https://api.tikhub.io";

async function call(method: "GET" | "POST", path: string, params: Record<string, string>) {
  const key = process.env.TIKHUB_API_KEY;
  if (!key) throw new Error("未配置 TIKHUB_API_KEY");
  const url = BASE + path + (method === "GET" ? "?" + new URLSearchParams(params) : "");
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "content-workbench-demo/1.0" },
    body: method === "POST" ? JSON.stringify(params) : undefined,
    signal: AbortSignal.timeout(40000),
  });
  const j = await r.json();
  if (j.code !== 200) throw new Error(`TikHub ${path} ${r.status}: ${j.message_zh ?? j.detail?.message_zh ?? j.message}`);
  return j.data;
}

type Stats = { likes: number | null; comments: number | null; collects: number | null; shares: number | null };

export async function douyinStats(shareUrl: string): Promise<Stats> {
  const m = shareUrl.match(/video\/(\d{15,})/);
  const d = m
    ? await call("GET", "/api/v1/douyin/app/v3/fetch_one_video", { aweme_id: m[1] })
    : await call("GET", "/api/v1/douyin/app/v3/fetch_one_video_by_share_url", { share_url: (shareUrl.match(/https?:\/\/\S+/) ?? [shareUrl])[0] });
  const s = d.aweme_detail.statistics;
  return { likes: s.digg_count, comments: s.comment_count, collects: s.collect_count, shares: s.share_count };
}

export async function wechatStats(shareUrl: string): Promise<Stats> {
  const d = await call("POST", "/api/v1/wechat_channels/v2/fetch_video_detail", { share_url: shareUrl, raw: true } as never);
  const c = d.objectExtend?.monotonicData?.countInfo ?? d;
  return { likes: c.likeCount ?? null, comments: c.commentCount ?? null, collects: c.favCount ?? null, shares: c.forwardCount ?? null };
}

export async function xhsStats(url: string): Promise<Stats> {
  const id = url.match(/(?:explore|item|discovery\/item)\/([0-9a-f]{24})/)?.[1];
  const d = await call("GET", "/api/v1/xiaohongshu/app_v2/get_video_note_detail", id ? { note_id: id } : { share_text: url });
  // 返回结构随版本变化，按字段名深度查找
  const num = (k: string) => {
    const x = deepFind(d, k);
    return x == null ? null : Number(String(x).replace(/[^\d.]/g, "")) || 0;
  };
  return { likes: num("liked_count"), comments: num("comments_count") ?? num("comment_count"), collects: num("collected_count"), shares: num("shared_count") ?? num("share_count") };
}

function deepFind(o: unknown, key: string, depth = 0): unknown {
  if (!o || typeof o !== "object" || depth > 8) return undefined;
  if (key in (o as Record<string, unknown>)) return (o as Record<string, unknown>)[key];
  for (const v of Object.values(o as Record<string, unknown>)) {
    const r = deepFind(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** 抓取近 30 天已发布视频的互动数据，每条每平台每天最多一次 */
export async function syncTikhub(force = false) {
  if (!process.env.TIKHUB_API_KEY) return { ok: 0, fail: 0, skipped: "未配置 TIKHUB_API_KEY" };
  const vids = all<{ id: number; douyin_url: string | null; wechat_url: string | null; xhs_url: string | null }>(
    "SELECT id, douyin_url, wechat_url, xhs_url FROM videos WHERE stage='已发布' AND published_at >= date('now','-31 day')");
  const fresh = new Set(all<{ k: string }>(
    "SELECT video_id || '-' || platform k FROM metrics WHERE checkpoint='live' AND date(updated_at)=date('now','localtime')").map((r) => r.k));
  let ok = 0, fail = 0;
  const errors: string[] = [];
  for (const v of vids) {
    for (const [p, url, fn] of [["douyin", v.douyin_url, douyinStats], ["wechat", v.wechat_url, wechatStats], ["xhs", v.xhs_url, xhsStats]] as const) {
      if (!url || (!force && fresh.has(`${v.id}-${p}`))) continue;
      try {
        const s = await fn(url);
        run(`INSERT INTO metrics(video_id,checkpoint,platform,likes,comments,collects,shares,source) VALUES(?, 'live', ?, ?,?,?,?, 'tikhub')
             ON CONFLICT(video_id,checkpoint,platform) DO UPDATE SET likes=excluded.likes, comments=excluded.comments, collects=excluded.collects,
             shares=excluded.shares, source='tikhub', updated_at=datetime('now','localtime')`, v.id, p, s.likes, s.comments, s.collects, s.shares);
        ok++;
      } catch (e) {
        fail++;
        errors.push(`${v.id}/${p}: ${(e as Error).message}`);
      }
    }
  }
  if (errors.length) console.error("[tikhub]", errors.join("\n"));
  return { ok, fail, errors };
}
