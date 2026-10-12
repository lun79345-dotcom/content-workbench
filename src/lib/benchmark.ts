import { all, get, run, transaction } from "./db";
import { call } from "./tikhub";
import { object, exactCount, parseDouyinPlayBatch } from "./tikhub-data";
import { addDays, today } from "./rules";
import { UserFacingError } from "./action-errors";
export type BenchmarkVideo = { id: number; run_id: number; aweme_id: string; caption: string; published_at: string; plays: number | null; likes: number | null; comments: number | null; collects: number | null; shares: number | null; duration: number | null };
export type BenchmarkRun = { id: number; nickname: string | null; sec_user_id: string; status: string; cutoff: string; truncated: number; error: string | null; created_at: string };
export function accountLink(text: string) {
  const raw = text.match(/https?:\/\/[^\s]+/)?.[0];
  if (!raw) throw new UserFacingError("请粘贴抖音账号主页链接或主页分享文案");
  let u: URL;
  try { u = new URL(raw); } catch { throw new UserFacingError("账号链接格式不正确"); }
  if (!["douyin.com", "www.douyin.com", "v.douyin.com", "www.iesdouyin.com"].includes(u.hostname) || u.username || u.password)
    throw new UserFacingError("请使用抖音账号主页链接");
  return u.href;
}
export function benchmarkRun(id: number) { return get<BenchmarkRun>("SELECT * FROM benchmark_runs WHERE id=?", id); }
export function benchmarkVideos(id: number) { return all<BenchmarkVideo>("SELECT * FROM benchmark_videos WHERE run_id=? ORDER BY plays IS NULL,plays DESC,aweme_id", id); }
export async function queryBenchmark(text: string, userId: number) {
  const link = accountLink(text);
  const cachedLink = get<{ id: number }>("SELECT id FROM benchmark_runs WHERE input_url=? AND status='done' AND created_at>=datetime('now','+8 hours','-24 hours') ORDER BY id DESC LIMIT 1", link);
  if (cachedLink) return cachedLink.id;
  let secId = new URL(link).pathname.match(/^\/user\/([A-Za-z0-9_.-]{20,200})/)?.[1];
  if (!secId) {
    let resolved;
    try { resolved = await call("GET", "/api/v1/douyin/web/get_sec_user_id", { url: link }, "benchmark"); } catch { throw new UserFacingError("账号链接解析暂时失败，请使用完整主页链接或稍后重试"); }
    const candidate = typeof resolved === "string" ? resolved : object(resolved).sec_user_id;
    if (typeof candidate !== "string" || !/^[A-Za-z0-9_.-]{20,200}$/.test(candidate)) throw new UserFacingError("无法识别账号，请使用完整的抖音主页链接");
    secId = candidate;
  }
  const cutoff = addDays(today(), -90);
  const id = transaction(() => {
    run("UPDATE benchmark_runs SET status='failed',error='上次查询已中断，可重试' WHERE status='running' AND created_at<datetime('now','+8 hours','-15 minutes')");
    const existing = get<{ id: number; status: string }>("SELECT id,status FROM benchmark_runs WHERE sec_user_id=? AND created_at>=datetime('now','+8 hours','-24 hours') AND status IN ('running','done') ORDER BY id DESC LIMIT 1", secId);
    if (existing) { if (existing.status === "running") throw new UserFacingError("这个账号正在查询，请稍后查看结果"); return { id: existing.id, cached: true }; }
    return { id: Number(run("INSERT INTO benchmark_runs(sec_user_id,input_url,requested_by,status,cutoff) VALUES(?,?,?,'running',?)", secId, link, userId, cutoff).lastInsertRowid), cached: false };
  });
  if (id.cached) return id.id;
  try {
    const found = new Map<string, Omit<BenchmarkVideo, "id" | "run_id" | "plays" | "likes" | "comments" | "collects" | "shares">>();
    let cursor = "0", truncated = false, nickname = "", exhausted = false;
    const cursors = new Set<string>();
    for (let page = 0; page < 3; page++) {
      if (cursors.has(cursor)) { truncated = true; break; } cursors.add(cursor);
      const data = object(await call("GET", "/api/v1/douyin/app/v3/fetch_user_post_videos", { sec_user_id: secId, max_cursor: cursor, count: "20", sort_type: "0" }, "benchmark"));
      if (!Array.isArray(data.aweme_list)) throw new UserFacingError("账号作品列表暂不可用，请稍后重试");
      let reachedOlder = false;
      for (const raw of data.aweme_list.slice(0, 20)) {
        const v = object(raw), author = object(v.author), vid = v.aweme_id, stamp = exactCount(v.create_time);
        if (author.sec_uid !== secId && author.sec_user_id !== secId) continue;
        if (typeof vid !== "string" || !/^\d{15,22}$/.test(vid) || !stamp) continue;
        const date = new Date(stamp * 1000 + 8 * 3600000).toISOString().slice(0, 10);
        if (date < cutoff) { reachedOlder = true; continue; } if (date > today()) continue;
        if (!Array.isArray(object(object(v.video).play_addr).url_list)) continue;
        nickname = typeof author.nickname === "string" ? author.nickname.slice(0, 100) : nickname;
        found.set(vid, { aweme_id: vid, caption: String(v.desc ?? "").slice(0, 3000), published_at: date, duration: exactCount(object(v.video).duration) });
      }
      if (Number(data.has_more) !== 1 || !data.aweme_list.length) { exhausted = true; break; }
      // Pinned older videos do not prove the rest of the account is outside the date range.
      if (reachedOlder && data.aweme_list.every((v) => Number(object(v).create_time) * 1000 < Date.parse(cutoff + "T00:00:00+08:00"))) { exhausted = true; break; }
      cursor = String(data.max_cursor ?? "0");
    }
    truncated ||= !exhausted;
    const ids = [...found.keys()];
    const stats = new Map();
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50);
      const parsed = parseDouyinPlayBatch(await call("GET", "/api/v1/douyin/app/v3/fetch_multi_video_statistics", { aweme_ids: batch.join(",") }, "plays"), batch);
      for (const [key, value] of parsed) stats.set(key, value);
    }
    transaction(() => {
      for (const [vid, v] of found) {
        const s = stats.get(vid);
        run("INSERT INTO benchmark_videos(run_id,aweme_id,caption,published_at,duration,plays,likes,comments,collects,shares) VALUES(?,?,?,?,?,?,?,?,?,?)", id.id, vid, v.caption, v.published_at, v.duration, s?.plays ?? null, s?.likes ?? null, s?.comments ?? null, s?.collects ?? null, s?.shares ?? null);
      }
      run("UPDATE benchmark_runs SET status='done',nickname=?,truncated=? WHERE id=?", nickname || "抖音账号", Number(truncated), id.id);
    });
    return id.id;
  } catch (error) {
    run("UPDATE benchmark_runs SET status='failed',error=? WHERE id=?", "查询未完成，可稍后重试；已发请求仍计入每日额度。", id.id);
    throw error instanceof UserFacingError ? error : new UserFacingError("TikHub 查询未完成，请检查采集额度或稍后重试");
  }
}
