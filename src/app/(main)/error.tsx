"use client";

export default function ActionError() {
  return <div className="card mx-auto max-w-xl p-6">
    <h2 className="text-lg font-semibold">操作未完成，请确认最新状态</h2>
    <p className="mt-2 text-sm text-stone-500">记录可能已被更新，或填写内容不符合当前流程要求。刷新后查看最新内容，再检查负责人、日期和审核状态。</p>
    <button onClick={() => window.location.reload()} className="btn btn-primary mt-4">刷新页面</button>
  </div>;
}
