"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

export function DeleteAccount({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-sm btn-danger h-9 w-full"
      aria-label={`删除账号${name}`}
      onClick={(event) => {
        if (!window.confirm(`确定删除账号“${name}”吗？\n已有视频、创意、月度目标或复盘记录的账号不能删除。`)) event.preventDefault();
      }}
    >
      {pending && <LoaderCircle size={14} className="animate-spin" />}
      {pending ? "删除中…" : "删除"}
    </button>
  );
}
