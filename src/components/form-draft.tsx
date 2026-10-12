"use client";
import { useEffect, useRef, useState } from "react";
import { decodeDraft, type DraftFields, type FormDraft } from "@/lib/form-draft";

export function clearFormDraft(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  window.dispatchEvent(new CustomEvent("workbench:draft-cleared", { detail: key }));
}
export function useFormDraft<T extends DraftFields>(key: string, defaults: T, version = "new") {
  const initial = useRef(defaults);
  const [fields, setFields] = useState(defaults);
  const [status, setStatus] = useState("");
  const [stale, setStale] = useState<FormDraft | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key), draft = decodeDraft(raw, initial.current);
      if (draft?.version === version) { setFields(draft.fields as T); setStatus("已恢复本机草稿"); }
      else if (draft) { setStale(draft); setStatus("记录已有更新，旧草稿仅供查看"); }
      else if (raw) window.localStorage.removeItem(key);
    } catch { setStatus("浏览器无法保存草稿，请及时提交"); }
    const clear = (event: Event) => {
      if ((event as CustomEvent).detail === key) { setStale(null); setStatus("已提交保存"); }
    };
    window.addEventListener("workbench:draft-cleared", clear);
    return () => window.removeEventListener("workbench:draft-cleared", clear);
  }, [key, version]);
  function change(next: T) {
    setFields(next);
    // Persist on input so an abrupt refresh does not lose the last keystroke.
    try { window.localStorage.setItem(key, JSON.stringify({ version, fields: next, savedAt: Date.now() })); setStatus("草稿已保存在本机"); }
    catch { setStatus("草稿未能保存，请及时提交"); }
  }
  function discard() { clearFormDraft(key); setFields(initial.current); setStatus("已清除草稿"); }
  return { fields, change, status, stale, discard };
}
const FIELD_LABELS: Record<string, string> = {
  title: "标题", brief: "需求说明", account_id: "账号编号", editor_id: "编导编号", cutter_id: "剪辑编号",
  publish_date: "计划发布", due_script: "脚本截止", due_shoot: "拍摄截止", due_rough: "初剪截止", due_review: "审核截止",
  cut_level: "剪辑定档", extra_units: "加件", content_type: "内容类型", note: "备注",
  summary: "本周结论", successes: "有效做法", issues: "问题与待验证原因", next_plan: "下周计划",
};
export function DraftNotice({ draft }: { draft: Pick<ReturnType<typeof useFormDraft>, "status" | "stale" | "discard"> }) {
  if (!draft.status) return null;
  return <div className="space-y-2 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
    <div className="flex flex-wrap items-center justify-between gap-2"><span role="status">{draft.status} · 仅限当前浏览器</span><button type="button" className="text-brand-700 underline" onClick={() => { if (window.confirm("清除本机草稿并恢复已保存内容？")) draft.discard(); }}>清除草稿</button></div>
    {draft.stale && <details><summary className="cursor-pointer">查看旧草稿（不会覆盖最新记录）</summary><div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{Object.entries(draft.stale.fields).filter(([, value]) => value).map(([key, value]) => <p key={key} className="mb-2">{FIELD_LABELS[key] ?? "草稿内容"}：{value}</p>)}</div></details>}
  </div>;
}
