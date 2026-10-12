"use client";
import { draftKey } from "@/lib/form-draft";
import { DraftNotice, useFormDraft } from "./form-draft";
import { ActionForm } from "./action-form";
import { Field } from "./ui";
import { Submit } from "./submit";
import type { AccountReview } from "@/lib/account-weekly";
import type { AiAccountReport } from "@/lib/account-review-report";
import type { ActionResult } from "@/lib/action-errors";

export function AccountReviewForm({ userId, accountId, week, value, report, action }: { userId: number; accountId: number; week: string; value?: AccountReview; report?: AiAccountReport; action: (fd: FormData) => Promise<ActionResult> }) {
  const key = draftKey(userId, `account-review:${accountId}:${week}`);
  const draft = useFormDraft(key, { summary: value?.summary ?? "", successes: value?.successes ?? "", issues: value?.issues ?? "", next_plan: value?.next_plan ?? "" }, String(value?.revision ?? 0));
  const notes = draft.fields, setNotes = draft.change;
  const adopt = () => {
    if (!report) return;
    if (Object.values(notes).some((s) => s.trim()) && !window.confirm("采用 AI 草稿会替换表单里的内容，保存后才会更新已有复盘，是否继续？")) return;
    setNotes({ summary: report.overview, successes: report.observations.map((o) => o.point).join("\n"), issues: [...report.hypotheses.map((s) => `待验证：${s}`), ...report.limits].join("\n"), next_plan: report.actions.join("\n") });
  };
  return <ActionForm action={action} draftKey={key} className="workflow-form space-y-5">
    <DraftNotice draft={draft} />
    <input type="hidden" name="account_id" value={accountId} /><input type="hidden" name="week" value={week} /><input type="hidden" name="revision" value={value?.revision ?? 0} />
    {report && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-brand-50 p-3"><p className="text-sm text-stone-600">可采用 AI 草稿，修改确认后保存。</p><button type="button" className="btn" onClick={adopt}>采用 AI 草稿</button></div>}
    {[["summary", "本周结论"], ["successes", "有效做法 / 数据发现"], ["issues", "问题与待验证原因"], ["next_plan", "下周行动计划"]].map(([key, label]) => <Field key={key} label={label}><textarea name={key} rows={key === "next_plan" ? 4 : 3} value={notes[key as keyof typeof notes]} onChange={(e) => setNotes({ ...notes, [key]: e.target.value })} className="input" placeholder={key === "next_plan" ? "写清下周做什么、如何验证效果" : "有需要补充的分析再填写"} /></Field>)}
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-stone-500">{value ? `上次保存 ${value.updated_at}` : "自动统计无需重复填写"}</span><Submit className="btn btn-primary">保存账号复盘</Submit></div>
  </ActionForm>;
}
