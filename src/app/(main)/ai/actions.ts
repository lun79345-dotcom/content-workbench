"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { actionResult, UserFacingError } from "@/lib/action-errors";
import { id, text } from "@/lib/validation";
import { enqueueAssist, canAccessAiInput } from "@/lib/ai-assist";
import { getVideo } from "@/lib/queries";
import { accountSignals } from "@/lib/account-anomalies";
import type { AiInput } from "@/lib/ai-analysis";
export async function generateAssistForm(fd:FormData) {
  return actionResult(async()=>{
    const me=await requireUser(),kind=text(fd,"kind",true),entity=id(fd,"entity_id");
    if (!["idea_brief","script_check","review_changes","account_anomaly"].includes(kind!)) throw new UserFacingError("不支持这项 AI 辅助");
    if (!canAccessAiInput(me,{kind:kind as AiInput["kind"],title:"",caption:"",entity_id:entity})) throw new UserFacingError("没有这项 AI 辅助的使用权限");
    let input:AiInput;
    if(kind==="idea_brief"){
      const idea=get<{content:string;account_name:string|null}>("SELECT i.content,a.name account_name FROM ideas i LEFT JOIN accounts a ON a.id=i.account_id WHERE i.id=?",entity);
      if(!idea)throw new UserFacingError("创意不存在");
      input={kind,title:idea.content.slice(0,3000),caption:idea.account_name?`目标账号：${idea.account_name}`:"目标账号与定位待确认",transcript:idea.content.slice(0,40000),entity_id:entity};
    }else if(kind==="script_check"||kind==="review_changes"){
      const v=getVideo(entity);if(!v)throw new UserFacingError("视频不存在");
      let transcript:string;
      if(kind==="script_check"){
        const script=text(fd,"script",true,30000)!;
        if(/^https?:\/\/\S+$/.test(script))throw new UserFacingError("请粘贴实际脚本文字，仅有文档链接无法检查");
        transcript=`需求与必拍镜头：\n${(v.brief??"未填写，需人工补充").slice(0,8000)}\n实际脚本：\n${script}`;
      }else{
        const review=get<{id:number;reason:string|null;comment:string|null}>("SELECT id,reason,comment FROM reviews WHERE video_id=? AND status='打回' ORDER BY id DESC LIMIT 1",entity);
        if(!review||(!review.reason&&!review.comment))throw new UserFacingError("暂无可整理的打回意见");
        transcript=`审核记录 #${review.id}\n原打回原因：${review.reason??"未分类"}\n原审核意见：${(review.comment??"无补充意见").slice(0,25000)}\n需求：${(v.brief??"未提供").slice(0,8000)}`;
      }
      input={kind,title:v.title.slice(0,3000),caption:"AI 仅辅助检查与整理，不改变流程或审核结果",transcript,entity_id:entity};
    }else if(kind==="account_anomaly"){
      const info=accountSignals(entity);if(!info)throw new UserFacingError("账号不存在");
      if(!info.signals.length)throw new UserFacingError("当前未发现达到规则阈值的异常；样本不足时不会强行判断");
      const summary={week:info.week,signals:info.signals,current:{published:info.snapshot.current.published},previous:{published:info.snapshot.previous.published},performance:info.snapshot.performance,previous_performance:info.snapshot.previous_performance,notes:info.snapshot.notes};
      const transcript=JSON.stringify(summary);if(transcript.length>40000)throw new UserFacingError("样本过多，请使用账号周复盘生成完整报告");
      input={kind,title:info.snapshot.account.name,caption:"按公司账号完整周和成熟数据核对异常，不包含员工评分",transcript,entity_id:entity};
    }else throw new UserFacingError("不支持这项 AI 辅助");
    const job=enqueueAssist(me,input);redirect(`/ai?job=${job}`);
  });
}
