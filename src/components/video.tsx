import Link from "next/link";
import { Field, Initials, Select, Tag } from "./ui";
import { currentDue, DUE_LABEL, isFrozen, overdueDays, shortDate, getRules, type VideoRow } from "@/lib/rules";
import type { Account, Person } from "@/lib/queries";

export function DueTag({ v }: { v: VideoRow }) {
  const due = currentDue(v);
  if (!due) return null;
  const od = overdueDays(v);
  if (!due.date) return <Tag tone="gray">{DUE_LABEL[due.field]}未定</Tag>;
  return od > 0
    ? <Tag tone="red">逾期{od}天 · {DUE_LABEL[due.field].replace("截止", "")}</Tag>
    : <Tag tone="blue">{DUE_LABEL[due.field]} {shortDate(due.date)}</Tag>;
}

/** 阶段配色：看板列头、进度条共用 */
export const STAGE_COLOR: Record<string, string> = {
  选题: "bg-stone-400", 脚本: "bg-sky-500", 脚本审核: "bg-amber-500", 拍摄: "bg-violet-500",
  剪辑: "bg-pink-500", 成片审核: "bg-amber-500", 待发布: "bg-teal-500", 已发布: "bg-emerald-500",
};

export function VideoCard({ v }: { v: VideoRow }) {
  const od = overdueDays(v);
  return (
    <Link href={`/videos/${v.id}`} className={`relative block overflow-hidden rounded-xl bg-white p-3 shadow-[0_1px_2px_rgba(28,25,23,0.05)] ring-1 transition hover:-translate-y-px hover:shadow-md ${od > 0 ? "ring-red-200" : "ring-stone-200/80"}`}>
      {od > 0 && <span className="absolute inset-y-0 left-0 w-1 bg-red-500" />}
      <div className="flex items-center justify-between gap-2 text-[11px] text-stone-400">
        <span className="truncate">{v.account_name} · {v.code}</span>
        {isFrozen(v) && <Tag tone="purple">已冻结</Tag>}
      </div>
      <div className="mt-1 line-clamp-2 text-sm leading-snug font-medium text-stone-800">{v.title}</div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <DueTag v={v} />
        <span className="flex -space-x-1.5">
          <Initials name={v.editor_name} />
          <Initials name={v.cutter_name} />
        </span>
      </div>
    </Link>
  );
}

export function VideoForm({ v, accounts, editors, cutters, ideaId, defaultTitle }: {
  v?: VideoRow; accounts: Account[]; editors: Person[]; cutters: Person[]; ideaId?: number; defaultTitle?: string;
}) {
  const levels = Object.keys(getRules().cut_levels);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {v && <input type="hidden" name="id" value={v.id} />}
      {ideaId && <input type="hidden" name="idea_id" value={ideaId} />}
      <Field label="选题/标题" className="sm:col-span-2 lg:col-span-4">
        <input name="title" required defaultValue={v?.title ?? defaultTitle} className="input" />
      </Field>
      <Field label="账号"><Select name="account_id" required defaultValue={v?.account_id} placeholder="选择账号" options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
      <Field label="编导"><Select name="editor_id" required defaultValue={v?.editor_id} placeholder="选择编导" options={editors.map((p) => ({ value: p.id, label: p.name }))} /></Field>
      <Field label="剪辑"><Select name="cutter_id" defaultValue={v?.cutter_id} placeholder="待定" options={cutters.map((p) => ({ value: p.id, label: p.name }))} /></Field>
      <Field label="剪辑定档"><Select name="cut_level" defaultValue={v?.cut_level ?? "常规"} options={levels} /></Field>
      <Field label="类型"><Select name="content_type" defaultValue={v?.content_type} placeholder="—" options={["剧情", "口播", "情景", "vlog", "其他"]} /></Field>
      <Field label="改版加件"><input name="extra_units" type="number" step="0.5" min="0" defaultValue={v?.extra_units ?? 0} className="input" /></Field>
      <div className="hidden lg:block lg:col-span-2" />
      <Field label="脚本截止"><input type="date" name="due_script" defaultValue={v?.due_script ?? ""} className="input" /></Field>
      <Field label="拍摄截止"><input type="date" name="due_shoot" defaultValue={v?.due_shoot ?? ""} className="input" /></Field>
      <Field label="初剪截止"><input type="date" name="due_rough" defaultValue={v?.due_rough ?? ""} className="input" /></Field>
      <Field label="审核截止"><input type="date" name="due_review" defaultValue={v?.due_review ?? ""} className="input" /></Field>
      <Field label="发布日期（前24h冻结）"><input type="date" name="publish_date" defaultValue={v?.publish_date ?? ""} className="input" /></Field>
      <Field label="需求说明 / 脚本链接" className="sm:col-span-2 lg:col-span-3">
        <textarea name="brief" rows={3} defaultValue={v?.brief ?? ""} className="input" placeholder="给剪辑的需求：风格、参考、重点镜头、脚本文档链接…" />
      </Field>
      <Field label="备注" className="sm:col-span-2 lg:col-span-4"><input name="note" defaultValue={v?.note ?? ""} className="input" /></Field>
    </div>
  );
}
