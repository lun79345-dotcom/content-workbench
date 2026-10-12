import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { validateAiInput, validateAiReport } from "./ai-analysis";
function atomic<T>(d: DatabaseSync, fn: () => T) {
  d.exec("BEGIN IMMEDIATE");
  try { const result = fn(); d.exec("COMMIT"); return result; }
  catch (error) { d.exec("ROLLBACK"); throw error; }
}
function claim(d: DatabaseSync, transcription: boolean, now: number) {
  return atomic(d, () => {
    d.prepare("UPDATE ai_jobs SET status='failed',error='处理超时，可重新生成',completed_at=datetime('now','+8 hours'),lease_id=NULL,lease_until=NULL WHERE status IN ('running','transcribing') AND (lease_until IS NULL OR lease_until<=?)").run(new Date(now).toISOString());
    // A single atomic claim routes media to the server and text to the local Codex worker.
    const rows = d.prepare("SELECT id,input_json,transcript,status FROM ai_jobs WHERE status IN ('queued','ready') ORDER BY id LIMIT 100").all() as { id: number; input_json: string; transcript: string | null; status: string }[];
    for (const row of rows) {
      let input;
      try { input = validateAiInput({ ...JSON.parse(row.input_json), ...(row.transcript ? { transcript: row.transcript } : {}) }); }
      catch {
        d.prepare("UPDATE ai_jobs SET status='failed',error='任务数据无效，请重新生成',completed_at=datetime('now','+8 hours') WHERE id=?").run(row.id);
        continue;
      }
      const needsTranscription = input.kind === "hit_analysis" && !input.transcript;
      if (needsTranscription !== transcription) continue;
      if (needsTranscription && !input.media_url) {
        d.prepare("UPDATE ai_jobs SET status='failed',error='缺少可转录视频，请粘贴逐字稿后重试',completed_at=datetime('now','+8 hours') WHERE id=?").run(row.id);
        continue;
      }
      const lease = randomUUID(), status = transcription ? "transcribing" : "running";
      d.prepare("UPDATE ai_jobs SET status=?,lease_id=?,lease_until=?,started_at=datetime('now','+8 hours'),error=NULL WHERE id=?").run(status, lease, new Date(now + (transcription ? 20 : 6) * 60000).toISOString(), row.id);
      if (!transcription) delete input.media_url;
      return { id: row.id, lease, input };
    }
    return null;
  });
}
export function claimAiJob(d: DatabaseSync, now = Date.now()) { return claim(d, false, now); }
export function claimTranscription(d: DatabaseSync, now = Date.now()) { return claim(d, true, now); }
export function finishTranscription(d: DatabaseSync, id: number, lease: string, transcript: string, now = Date.now()) {
  if (typeof transcript !== "string" || !transcript.trim() || transcript.length > 40000) throw new Error("invalid transcript");
  return d.prepare("UPDATE ai_jobs SET status='ready',transcript=?,lease_id=NULL,lease_until=NULL WHERE id=? AND status='transcribing' AND lease_id=? AND lease_until>?").run(transcript, id, lease, new Date(now).toISOString()).changes === 1;
}
export function finishAiJob(d: DatabaseSync, id: number, lease: string, report: unknown, now = Date.now()) {
  return atomic(d, () => {
    const row = d.prepare("SELECT input_json,transcript FROM ai_jobs WHERE id=? AND lease_id=? AND status='running' AND lease_until>?").get(id, lease, new Date(now).toISOString()) as { input_json: string; transcript: string | null } | undefined;
    if (!row) return false;
    const input = validateAiInput({ ...JSON.parse(row.input_json), ...(row.transcript ? { transcript: row.transcript } : {}) });
    const result = validateAiReport(report, input);
    return d.prepare("UPDATE ai_jobs SET status='done',transcript=?,report_json=?,completed_at=datetime('now','+8 hours'),lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=? AND status='running'").run(input.transcript ?? "", JSON.stringify(result), id, lease).changes === 1;
  });
}
export function failAiJob(d: DatabaseSync, id: number, lease: string, code: string) {
  const messages: Record<string, string> = { auth: "本机 Codex 登录已失效，请联系管理员重新登录。", transcription: "自动转录未完成，可粘贴逐字稿后重试。", format: "AI 格式或引用不正确，可重试。", timeout: "分析超时，可稍后重试。", stopped: "服务重启，请重新生成。" };
  return d.prepare("UPDATE ai_jobs SET status='failed',error=?,completed_at=datetime('now','+8 hours'),lease_id=NULL,lease_until=NULL WHERE id=? AND status IN ('running','transcribing') AND lease_id=?").run(messages[code] ?? "分析未完成，可稍后重试。", id, lease).changes === 1;
}
