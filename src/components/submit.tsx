"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Check, LoaderCircle } from "lucide-react";

/** 表单提交按钮：提交中显示转圈，完成后短暂显示「已保存」 */
export function Submit({ children, className = "btn btn-primary", done = "已保存", name, value, formAction }: {
  children: ReactNode; className?: string; done?: string | null; name?: string; value?: string; formAction?: (fd: FormData) => void;
}) {
  const { pending, data } = useFormStatus();
  const mine = !name || data?.get(name) === value;
  const [ok, setOk] = useState(false);
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending && mine && done) {
      setOk(true);
      const t = setTimeout(() => setOk(false), 1600);
      return () => clearTimeout(t);
    }
    was.current = pending && mine;
  }, [pending, mine, done]);
  return (
    <button name={name} value={value} formAction={formAction} disabled={pending} className={className}>
      {pending && mine ? <LoaderCircle size={14} className="animate-spin" /> : ok ? <Check size={14} /> : null}
      {pending && mine ? "处理中…" : ok ? done : children}
    </button>
  );
}
