"use client";
import { useState } from "react";
import { Check, ChevronDown, Link2 } from "lucide-react";
import { PUBLICATION_LABELS, PUBLICATION_PLATFORMS, parsePublicationText, type PublicationPlatform } from "@/lib/publication-input";
import { ActionForm } from "./action-form";
import { Field } from "./ui";
import { Submit } from "./submit";
import type { ActionResult } from "@/lib/action-errors";

export function PublicationForm({ id, revision, date, links, action }: {
  id: number; revision: number; date: string; links: Record<PublicationPlatform, string | null>;
  action: (fd: FormData) => Promise<ActionResult>;
}) {
  const [text, setText] = useState(PUBLICATION_PLATFORMS.map((p) => links[p]).filter(Boolean).join("\n"));
  const [manual, setManual] = useState<Partial<Record<PublicationPlatform, string>>>(() => Object.fromEntries(PUBLICATION_PLATFORMS.filter((p) => links[p]).map((p) => [p, links[p]!])));
  const [publishedAt, setPublishedAt] = useState(date);
  const parsed = parsePublicationText(text);
  const resolved = (p: PublicationPlatform) => manual[p] ?? (parsed.links[p].length === 1 ? parsed.links[p][0] : "");
  const active = PUBLICATION_PLATFORMS.filter((p) => resolved(p));
  const ambiguous = PUBLICATION_PLATFORMS.filter((p) => parsed.links[p].length > 1 && !manual[p]);
  const unknown = parsed.unknown.filter((link) => !active.some((p) => resolved(p) === link));
  return (
    <ActionForm action={action} className="workflow-form space-y-5">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="revision" value={revision} />
      <Field label="粘贴发布链接或分享文案"><textarea name="publish_text" rows={3} value={text} onChange={(e) => setText(e.target.value)} className="input" placeholder="直接粘贴抖音、视频号或小红书分享内容；多个平台可以一起粘贴" /></Field>
      {parsed.invalid.length > 0 && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">有格式不正确的链接，请检查粘贴内容。</p>}
      {active.length > 0 && <div className="space-y-2" aria-live="polite">{active.map((p) => <div key={p} className="flex min-w-0 items-center gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm"><Check size={16} className="shrink-0 text-emerald-700" /><span className="shrink-0 font-medium text-emerald-800">{PUBLICATION_LABELS[p]}</span><span className="min-w-0 truncate text-emerald-800" title={resolved(p)}>{resolved(p)}</span></div>)}</div>}
      {ambiguous.map((p) => <div key={p} className="rounded-lg bg-amber-50 p-3"><Field label={`${PUBLICATION_LABELS[p]}有多个链接，请选择这条视频的链接`}><select className="input" value={manual[p] ?? ""} onChange={(e) => setManual({ ...manual, [p]: e.target.value })}><option value="">请选择</option>{parsed.links[p].map((link) => <option key={link}>{link}</option>)}</select></Field></div>)}
      {unknown.length > 0 && <div className="space-y-3 rounded-lg bg-amber-50 p-3">{unknown.map((link) => <div key={link} className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_180px]"><span className="truncate text-sm text-stone-700" title={link}>{link}</span><select aria-label={`为链接 ${link} 选择平台`} value="" onChange={(e) => { if (e.target.value) setManual({ ...manual, [e.target.value]: link }); }} className="input"><option value="">选择对应平台</option>{PUBLICATION_PLATFORMS.map((p) => <option key={p} value={p}>{PUBLICATION_LABELS[p]}</option>)}</select></div>)}<p className="text-xs text-amber-800">无法自动识别的链接，请指定平台；与发布无关的链接可从粘贴内容中移除。</p></div>}
      <details data-form-expand-on-error className="group border-t border-stone-100 pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-stone-600"><span className="flex items-center gap-2"><Link2 size={16} />手动填写 / 修改实际日期</span><ChevronDown size={16} className="group-open:rotate-180" /></summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="实际发布日期"><input type="date" name="published_at" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} required className="input" /></Field>
          {PUBLICATION_PLATFORMS.map((p) => <Field key={p} label={`${PUBLICATION_LABELS[p]}链接`}><input name={`${p}_url`} value={resolved(p)} onChange={(e) => setManual({ ...manual, [p]: e.target.value })} className="input" placeholder="https://…" /></Field>)}
        </div>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4"><p className="text-sm text-stone-500">实际发布：{publishedAt || "待选择"} · 至少登记一个平台</p><Submit done={null} className="btn btn-primary">确认已发布{active.length ? ` · ${active.length} 个平台` : ""}</Submit></div>
    </ActionForm>
  );
}
