import { createHash } from "node:crypto";
import type { User } from "./auth";
import { all, get, run, transaction } from "./db";
import { UserFacingError } from "./action-errors";
import { workerOnline, canReviewAccount } from "./account-weekly";
import { validateAiInput, type AiInput } from "./ai-analysis";
import { getVideo } from "./queries";
export function canAccessAiInput(me: Pick<User,"id"|"role">, input: AiInput) {
  if (input.kind === "hit_analysis" || input.kind === "idea_brief") return ["boss","editor"].includes(me.role);
  if (input.kind === "account_anomaly") {
    const a=get<{id:number;editor_id:number|null}>("SELECT id,editor_id FROM accounts WHERE id=?",input.entity_id??0);
    return !!a && canReviewAccount(me,a);
  }
  const v=getVideo(input.entity_id??0);
  return !!v && !v.archived_at && (me.role==="boss" || (me.role==="editor" && (me.id===v.editor_id || !!get("SELECT id FROM reviews WHERE video_id=? AND reviewer_id=? AND status='待审'",v.id,me.id))) || (input.kind==="review_changes" && me.role==="cutter" && me.id===v.cutter_id));
}
export function enqueueAssist(me: Pick<User,"id"|"role">, raw: AiInput) {
  const input=validateAiInput(raw);
  if (!canAccessAiInput(me,input)) throw new UserFacingError("没有这项 AI 辅助的使用权限");
  const json=JSON.stringify(input),hash=createHash('sha256').update(json).digest('hex');
  const source=`${input.kind}:${me.id}:${input.entity_id??0}:${hash}`;
  return transaction(()=>{
    const old=get<{id:number}>("SELECT id FROM ai_jobs WHERE kind=? AND source_key=? AND status IN ('queued','transcribing','ready','running','done') AND requested_at>=datetime('now','+8 hours','-24 hours') ORDER BY id DESC LIMIT 1",input.kind,source);
    if(old)return old.id;
    if (!workerOnline()) throw new UserFacingError("本机 AI 服务暂未在线，请确认管理员电脑开机并联网");
    if(all("SELECT id FROM ai_jobs WHERE requested_at>=date('now','+8 hours')").length>=30)throw new UserFacingError("今天的 AI 任务已达30次上限，明天继续");
    return Number(run("INSERT INTO ai_jobs(kind,source_key,requested_by,input_json,input_hash) VALUES(?,?,?,?,?)",input.kind,source,me.id,json,hash).lastInsertRowid);
  });
}
