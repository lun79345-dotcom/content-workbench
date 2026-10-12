import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { canAccessAiInput } from "@/lib/ai-assist";
import { validateAiInput,validateAiReport } from "@/lib/ai-analysis";
import { AiReportView } from "@/components/ai-assist";
import { AiJobPoller } from "@/components/ai-job-poller";
import { PageHeader,Section } from "@/components/ui";
export default async function AiPage({searchParams}:{searchParams:Promise<Record<string,string>>}){
  const me=await requireUser(),sp=await searchParams;
  const job=get<{id:number;status:string;input_json:string;transcript:string|null;report_json:string|null;error:string|null}>("SELECT * FROM ai_jobs WHERE id=? AND requested_by=?",Number(sp.job)||0,me.id);if(!job)notFound();
  let input;try{input=validateAiInput(JSON.parse(job.input_json));}catch{notFound();}
  if(!canAccessAiInput(me,input))notFound();
  const back=input.kind==="idea_brief"?"/ideas":input.kind==="account_anomaly"?`/weekly?account=${input.entity_id}`:input.kind==="hit_analysis"?"/benchmark":`/videos/${input.entity_id}`;
  let report;try{if(job.status==="done")report=validateAiReport(JSON.parse(job.report_json!),{...input,transcript:job.transcript??input.transcript});}catch{}
  return <><PageHeader title="AI 辅助结果" desc="本机 Codex 根据本次提交的数据生成建议，确认后再使用。" actions={<Link href={back} className="btn">返回原页面</Link>}/><Section title={input.title}><AiJobPoller active={["queued","ready","running"].includes(job.status)}/>{["queued","ready","running"].includes(job.status)&&<p role="status" className="text-sm text-brand-700">{job.status==="running"?"本机 Codex 正在分析":"等待本机 Codex 分析"}，结果会自动刷新。</p>}{job.status==="failed"&&<p role="alert" className="text-sm text-amber-700">{job.error}</p>}{report&&<><AiReportView report={report}/>{input.kind==="idea_brief"&&<Link href={`/videos/new?idea=${input.entity_id}&ai=${job.id}`} className="btn btn-primary mt-5">带入新需求单，编辑后创建</Link>}</>}</Section></>;
}
