"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

export function DeleteMember({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formNoValidate
      disabled={pending}
      className="btn btn-sm btn-danger w-full shrink-0"
      aria-label={`删除成员${name}`}
      onClick={(event) => {
        if (!window.confirm(`确定删除未绑定飞书的成员“${name}”吗？\n其负责的账号和轮值组长设置会解除关联。已有业务记录的成员不能删除，可改为“已停用”。`)) event.preventDefault();
      }}
    >
      {pending && <LoaderCircle size={14} className="animate-spin" />}
      {pending ? "删除中…" : "删除"}
    </button>
  );
}
