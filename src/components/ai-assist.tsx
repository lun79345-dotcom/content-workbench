import { ActionForm } from "./action-form";
import { Submit } from "./submit";
import { Field } from "./ui";
import { generateAssistForm } from "@/app/(main)/ai/actions";
import type { AiKind,AiReport } from "@/lib/ai-analysis";
export function AiAssistForm({kind,entityId,label,script=false}:{kind:AiKind;entityId:number;label:string;script?:boolean}) {
  return <ActionForm action={generateAssistForm} className="mt-3 space-y-3"><input type="hidden" name="kind" value={kind}/><input type="hidden" name="entity_id" value={entityId}/>{script&&<><Field label="实际脚本文字"><textarea name="script" rows={5} maxLength={30000} required className="input" placeholder="粘贴脚本文字；系统会自动带入需求说明和必拍镜头"/></Field><p className="text-xs text-stone-500">外部文档链接不会被读取；检查结果不代替提交审核。</p></>}<Submit done={null} className="btn btn-sm">{label}</Submit></ActionForm>;
}
export function AiReportView({report}:{report:AiReport}) {
  return <div className="space-y-4 text-sm"><h3 className="font-medium">{report.title}</h3><p className="whitespace-pre-wrap leading-relaxed">{report.summary}</p>{report.sections.map((s,i)=><div key={i} className="rounded-lg bg-stone-50 p-4"><h4 className="font-medium">{s.title}</h4>{s.evidence&&<blockquote className="my-2 border-l-2 border-stone-300 pl-3 text-stone-500">{s.evidence}</blockquote>}<p className="whitespace-pre-wrap leading-relaxed">{s.analysis}</p></div>)}<div><h3 className="mb-2 font-medium">可编辑建议 / 草稿</h3><p className="whitespace-pre-wrap leading-relaxed">{report.draft}</p></div><ul className="list-disc space-y-2 pl-5">{report.actions.map((s,i)=><li key={i}>{s}</li>)}</ul><div className="rounded-lg bg-amber-50 p-3"><h3 className="mb-2 font-medium">需人工确认</h3><ul className="list-disc space-y-1 pl-4">{report.limits.map((s,i)=><li key={i}>{s}</li>)}</ul></div></div>;
}
