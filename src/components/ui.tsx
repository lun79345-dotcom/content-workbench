import Link from "next/link";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function PageHeader({ title, desc, actions }: { title: string; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight">{title}</h1>
        {desc && <div className="mt-1.5 text-sm text-stone-500">{desc}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  gray: "bg-stone-100 text-stone-600",
  blue: "bg-brand-50 text-brand-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  purple: "bg-violet-50 text-violet-700",
} as const;
export type Tone = keyof typeof TONES;

export function Tag({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag ${TONES[tone]}`}>{children}</span>;
}

const STAT_TONE = {
  default: { icon: "bg-stone-100 text-stone-500", value: "" },
  red: { icon: "bg-red-50 text-red-500", value: "text-red-600" },
  green: { icon: "bg-emerald-50 text-emerald-600", value: "text-emerald-600" },
  blue: { icon: "bg-brand-50 text-brand-600", value: "" },
  amber: { icon: "bg-amber-50 text-amber-600", value: "" },
};

export function Stat({ label, value, sub, tone, icon, href }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: keyof typeof STAT_TONE; icon?: ReactNode; href?: string;
}) {
  const t = STAT_TONE[tone ?? "default"];
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-stone-500">{label}</span>
        {icon && <span className={`grid h-7 w-7 place-items-center rounded-lg ${t.icon}`}>{icon}</span>}
      </div>
      <div className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${t.value}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-stone-400">{sub}</div>}
    </>
  );
  return href
    ? <Link href={href} className="card block p-4 transition-shadow hover:shadow-md">{body}</Link>
    : <div className="card p-4">{body}</div>;
}

export function Empty({ children, icon, action }: { children: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-stone-200 px-6 py-10 text-center">
      <span className="mb-2 grid h-10 w-10 place-items-center rounded-full bg-stone-100 text-stone-400">{icon ?? <Inbox size={20} />}</span>
      <div className="text-sm text-stone-500">{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className = "", icon }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <section className={`card min-w-0 p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">{icon && <span className="text-stone-400">{icon}</span>}{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex gap-1 rounded-xl bg-stone-200/50 p-1 text-sm">
        {items.map((t) => (
          <Link key={t.key} href={t.href} className={`rounded-lg px-3.5 py-1.5 whitespace-nowrap transition-colors ${t.key === current ? "bg-white font-medium text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}>
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Select({ name, options, defaultValue, required, placeholder }: {
  name: string; options: (string | { value: string | number; label: string })[]; defaultValue?: string | number | null; required?: boolean; placeholder?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} required={required} className="input">
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** 姓名头像（取后两个字） */
export function Initials({ name, size = 22 }: { name?: string | null; size?: number }) {
  if (!name) return null;
  return (
    <span title={name} className="inline-grid shrink-0 place-items-center rounded-full bg-stone-100 font-medium text-stone-600 ring-2 ring-white" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.length > 2 ? name.slice(-2) : name}
    </span>
  );
}
