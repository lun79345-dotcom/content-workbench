"use server";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { actionResult, UserFacingError } from "@/lib/action-errors";
import { all, get, run, transaction } from "@/lib/db";
import { queryBenchmark, benchmarkVideos } from "@/lib/benchmark";
import { call } from "@/lib/tikhub";
import { object, exactCount } from "@/lib/tikhub-data";
import { safeMediaUrl } from "@/lib/media-source";
import { text, id } from "@/lib/validation";
import { validateAiInput } from "@/lib/ai-analysis";
async function creator() { const me = await requireUser(); if (!["boss", "editor"].includes(me.role)) throw new UserFacingError("账号研究由编导和老板使用"); return me; }
export async function queryAccountForm(fd: FormData) {
  return actionResult(async () => { const me = await creator(); const runId = await queryBenchmark(text(fd, "account_link", true, 3000)!, me.id); redirect(`/benchmark?run=${runId}`); });
}
export async function analyzeHitForm(fd: FormData) {
  return actionResult(async () => {
    const me = await creator(), videoId = id(fd, "video_id"), runId = id(fd, "run_id");
    const v = benchmarkVideos(runId).filter(v => v.plays != null).slice(0, 10).find(v => v.id === videoId);
    if (!v) throw new UserFacingError("请选择查询结果中已获取播放量的前10条作品");
    const transcript = text(fd, "transcript", false, 40000) ?? "";
    const source = `hit:${me.id}:${v.aweme_id}:${createHash('sha256').update(transcript).digest('hex')}`;
    const cached = get<{ id: number }>("SELECT id FROM ai_jobs WHERE kind='hit_analysis' AND source_key=? AND status IN ('queued','transcribing','ready','running','done') AND requested_at>=datetime('now','+8 hours','-24 hours') ORDER BY id DESC LIMIT 1", source);
    if (cached) redirect(`/benchmark?run=${runId}&job=${cached.id}`);
    const seen = get<{ value: string }>("SELECT value FROM settings WHERE key='account_review_worker_seen'")?.value;
    const asrSeen = get<{ value: string }>("SELECT value FROM settings WHERE key='transcription_worker_seen'")?.value;
    if (!seen || !Number.isFinite(Date.parse(seen)) || Date.now() - Date.parse(seen) > 90000 || Date.parse(seen) > Date.now() + 60000) throw new UserFacingError("本机分析服务未在线，请确认管理员电脑开机并联网");
    if (all("SELECT id FROM ai_jobs WHERE requested_at>=date('now','+8 hours')").length >= 30) throw new UserFacingError("今天的 AI 任务已达30次上限，明天继续");
    let media_url: string | undefined;
    if (!transcript) {
      if (!asrSeen || !Number.isFinite(Date.parse(asrSeen)) || Date.now()-Date.parse(asrSeen)>90000 || Date.parse(asrSeen)>Date.now()+60000) throw new UserFacingError("服务器转录服务未在线，可先粘贴逐字稿分析");
      let response;
      try { response = await call("GET", "/api/v1/douyin/app/v3/fetch_one_video_v3", { aweme_id: v.aweme_id }, "benchmark"); } catch { throw new UserFacingError("视频详情暂时获取失败，请稍后重试；已有逐字稿可直接分析"); }
      const data = object(response);
      const detail = object(data.aweme_detail ?? data);
      if (detail.aweme_id !== v.aweme_id) throw new UserFacingError("返回的作品与选择的视频不一致，请重试");
      const video = object(detail.video), duration = exactCount(video.duration);
      if (duration != null && duration > 600000) throw new UserFacingError("自动转录先支持10分钟以内的视频；长视频可粘贴逐字稿");
      const links = object(video.play_addr).url_list;
      if (Array.isArray(links)) for (const link of links) if (typeof link === "string") { try { media_url = safeMediaUrl(link); break; } catch {} }
      if (!media_url) throw new UserFacingError("该作品暂未返回可用的视频地址，可粘贴逐字稿后分析");
    }
    const input = validateAiInput({ kind: "hit_analysis", title: v.caption, caption: v.caption, aweme_id: v.aweme_id, transcript, media_url, plays: v.plays });
    const jobId = transaction(() => {
      const old = get<{ id: number }>("SELECT id FROM ai_jobs WHERE kind='hit_analysis' AND source_key=? AND status IN ('queued','transcribing','ready','running')", source);
      if (old) return old.id;
      if (all("SELECT id FROM ai_jobs WHERE requested_at>=date('now','+8 hours')").length >= 30) throw new UserFacingError("今天的AI任务已达30次上限，明天继续");
      const json = JSON.stringify(input);
      return Number(run("INSERT INTO ai_jobs(kind,source_key,requested_by,input_json,input_hash) VALUES('hit_analysis',?,?,?,?)", source, me.id, json, createHash('sha256').update(json).digest('hex')).lastInsertRowid);
    });
    redirect(`/benchmark?run=${runId}&job=${jobId}`);
  });
}
