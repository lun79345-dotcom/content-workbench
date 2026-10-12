"use client";
import { draftKey } from "@/lib/form-draft";
import { DraftNotice, useFormDraft } from "./form-draft";
import { ChevronDown, CalendarDays, UserRound } from "lucide-react";
import type { Account, Person } from "@/lib/queries";
import { Field } from "./ui";
import { Submit } from "./submit";

export function NewVideoForm({ accounts, editors, cutters, cutLevels, viewerId, viewerRole, ideaId, defaultTitle, defaultBrief, aiJobId, defaultAccountId }: {
  accounts: Pick<Account, "id" | "name" | "editor_id">[]; editors: Person[]; cutters: Person[]; cutLevels: string[];
  viewerId: number; viewerRole: string; ideaId?: number; defaultTitle?: string; defaultBrief?: string; aiJobId?:number; defaultAccountId?: number;
}) {
  const initialAccount = accounts.find((a) => a.id === defaultAccountId)?.id ?? (accounts.length === 1 ? accounts[0].id : "");
  const suggestedEditor = (accountId: string | number) => viewerRole === "editor" ? String(viewerId)
    : String(editors.find((p) => p.id === accounts.find((a) => a.id === Number(accountId))?.editor_id)?.id ?? (editors.length === 1 ? editors[0].id : ""));
  const draft = useFormDraft(draftKey(viewerId, `new-video:${ideaId ?? "blank"}:${defaultAccountId ?? "any"}${aiJobId?`:ai-${aiJobId}`:""}`), {
    title: defaultTitle ?? "", account_id: String(initialAccount), editor_id: suggestedEditor(initialAccount),
    publish_date: "", cut_level: cutLevels.includes("常规") ? "常规" : cutLevels[0] ?? "", cutter_id: "", extra_units: "0",
    brief: defaultBrief ?? "", content_type: "", note: "", due_script: "", due_shoot: "", due_rough: "", due_review: "",
  });
  const fields = draft.fields;
  const { account_id: accountId, editor_id: editorId, publish_date: publishDate, cut_level: cutLevel, cutter_id: cutterId, extra_units: extraUnits } = fields;
  const set = (key: keyof typeof fields, value: string) => draft.change({ ...fields, [key]: value });
  const owner = editors.find((p) => p.id === Number(editorId));
  const mustChooseEditor = viewerRole !== "editor" && !!accountId && !suggestedEditor(accountId);

  const editorSelect = <select aria-label="编导" value={editorId} required onChange={(e) => set("editor_id", e.target.value)} className="input">
    <option value="">请选择编导</option>{editors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
  </select>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="card space-y-6 p-5 sm:p-7">
        {ideaId && <input type="hidden" name="idea_id" value={ideaId} />}
        <input type="hidden" name="editor_id" value={editorId} />
        <div className="space-y-5">
          <DraftNotice draft={draft} />
          <Field label="选题 / 标题"><input name="title" required maxLength={200} value={fields.title} onChange={(e) => set("title", e.target.value)} className="input" placeholder="这条视频讲什么？" /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="发布账号"><select name="account_id" required value={accountId} onChange={(e) => { draft.change({ ...fields, account_id: e.target.value, editor_id: suggestedEditor(e.target.value) }); }} className="input">
              <option value="">选择账号</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></Field>
            <Field label="计划发布日期 · 可稍后补"><input type="date" name="publish_date" value={publishDate} onChange={(e) => set("publish_date", e.target.value)} className="input" /></Field>
          </div>
          {mustChooseEditor && <Field label="编导 · 该账号尚未配置负责人">{editorSelect}</Field>}
          <Field label="需求说明 / 脚本链接 · 可稍后补"><textarea name="brief" rows={4} value={fields.brief} onChange={(e) => set("brief", e.target.value)} className="input" placeholder="粘贴脚本文档链接，或说明风格、参考和重点镜头" /></Field>
        </div>

        <details data-form-expand-on-error className="group border-t border-stone-100 pt-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-stone-700">
            <span className="flex items-center gap-2"><CalendarDays size={16} />阶段截止日期</span>
            <span className="flex items-center gap-2 text-xs font-normal text-stone-500">手动排期 · 可稍后补<ChevronDown size={16} className="transition-transform group-open:rotate-180" /></span>
          </summary>
          <p className="mt-3 text-sm text-stone-500">按脚本、拍摄、初剪、审核的先后顺序填写。</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[["due_script", "脚本截止"], ["due_shoot", "拍摄截止"], ["due_rough", "初剪截止"], ["due_review", "审核截止"]].map(([name, label]) =>
              <Field key={name} label={label}><input type="date" name={name} value={fields[name as keyof typeof fields]} onChange={(e) => set(name as keyof typeof fields, e.target.value)} className="input" /></Field>)}
          </div>
        </details>

        <details data-form-expand-on-error className="group border-t border-stone-100 pt-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-stone-700">
            <span className="flex items-center gap-2"><UserRound size={16} />负责人及更多设置</span><ChevronDown size={16} className="text-stone-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {viewerRole !== "editor" && accountId && !mustChooseEditor && <Field label="编导">{editorSelect}</Field>}
            <Field label="剪辑 · 可在交素材时指定"><select name="cutter_id" value={cutterId} onChange={(e) => set("cutter_id", e.target.value)} className="input"><option value="">待定</option>{cutters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="剪辑定档"><select name="cut_level" value={cutLevel} onChange={(e) => set("cut_level", e.target.value)} className="input">{cutLevels.map((level) => <option key={level}>{level}</option>)}</select></Field>
            <Field label="改版加件"><input type="number" name="extra_units" min="0" max="100" step="0.5" value={extraUnits} onChange={(e) => set("extra_units", e.target.value)} className="input" /></Field>
            <Field label="内容类型"><select name="content_type" value={fields.content_type} onChange={(e) => set("content_type", e.target.value)} className="input"><option value="">暂不选择</option>{["剧情", "口播", "情景", "vlog", "其他"].map((kind) => <option key={kind}>{kind}</option>)}</select></Field>
            <Field label="备注" className="sm:col-span-2"><input name="note" value={fields.note} onChange={(e) => set("note", e.target.value)} className="input" placeholder="有需要补充的内容再填写" /></Field>
          </div>
        </details>
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-5 -mb-5 flex items-center justify-between gap-4 rounded-b-2xl border-t border-stone-100 bg-white px-5 py-4 sm:-mx-7 sm:-mb-7 sm:px-7 md:bottom-0">
          <span className="text-xs text-stone-500">创建后进入选题阶段</span><Submit done={null} className="btn btn-primary">创建需求单</Submit>
        </div>
      </div>
      <aside className="space-y-5 text-sm lg:pt-2">
        <div><h2 className="font-semibold">已带入的信息</h2><dl className="mt-4 space-y-3 text-stone-500">
          <div className="flex justify-between gap-3"><dt>编导</dt><dd className="font-medium text-stone-800">{owner?.name ?? "待选择"}</dd></div>
          <div className="flex justify-between gap-3"><dt>剪辑</dt><dd className="text-stone-800">{cutters.find((p) => p.id === Number(cutterId))?.name ?? "待定"}</dd></div>
          <div className="flex justify-between gap-3"><dt>工作量</dt><dd className="text-stone-800">{cutLevel} · 加件 {extraUnits || "0"}</dd></div>
          <div className="flex justify-between gap-3"><dt>计划发布</dt><dd className="text-stone-800">{publishDate || "未定"}</dd></div>
        </dl></div>
        <p className="border-t border-stone-200 pt-4 leading-relaxed text-stone-500">先建立需求单，脚本、排期和剪辑可以在对应阶段补齐。同一张需求单会一直跟随这条视频。</p>
      </aside>
    </div>
  );
}
