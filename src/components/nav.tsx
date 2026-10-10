"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell, BookOpen, ChartColumn, ClipboardCheck, Gauge, GraduationCap, House, KanbanSquare, Lightbulb, LogOut, Menu,
  NotebookPen, Settings, Wallet, X, type LucideIcon,
} from "lucide-react";
import { withBase } from "@/lib/paths";

export type NavItem = { href: string; label: string; icon: string; badge?: number; group: string };

const ICONS: Record<string, LucideIcon> = {
  home: House, board: KanbanSquare, review: ClipboardCheck, data: ChartColumn, bonus: Wallet, idea: Lightbulb,
  student: GraduationCap, weekly: NotebookPen, dashboard: Gauge, settings: Settings, guide: BookOpen, bell: Bell,
};

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return <span className="min-w-5 rounded-full bg-red-500 px-1.5 text-center text-[11px] leading-5 font-medium text-white">{n > 99 ? "99+" : n}</span>;
}

function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- 飞书头像为外链小图
  if (src) return <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-brand-100 font-medium text-brand-700" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.slice(-2, -1) || name.slice(0, 1)}{name.slice(-1)}
    </span>
  );
}

export function Nav({ items, user, unread }: { items: NavItem[]; user: { name: string; role: string; avatar?: string | null }; unread: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  const groups = [...new Set(items.map((i) => i.group))];

  const link = (it: NavItem, onClick?: () => void) => {
    const Icon = ICONS[it.icon] ?? House;
    const on = active(it.href);
    return (
      <Link key={it.href} href={it.href} onClick={onClick}
        className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${on ? "bg-brand-50 font-medium text-brand-700" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"}`}>
        <Icon size={17} strokeWidth={on ? 2.2 : 1.8} className={on ? "text-brand-600" : "text-stone-400 group-hover:text-stone-600"} />
        <span className="flex-1">{it.label}</span>
        <Badge n={it.badge} />
      </Link>
    );
  };

  const list = (onClick?: () => void) => (
    <nav className="space-y-4">
      {groups.map((g) => (
        <div key={g}>
          {g && <div className="mb-1 px-2.5 text-[11px] font-medium tracking-wide text-stone-400">{g}</div>}
          <div className="space-y-0.5">{items.filter((i) => i.group === g).map((i) => link(i, onClick))}</div>
        </div>
      ))}
    </nav>
  );

  const userBlock = (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
      <Avatar name={user.name} src={user.avatar} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">{user.name}</div>
        <div className="text-xs text-stone-400">{user.role}</div>
      </div>
      <form action={withBase("/api/logout")} method="post">
        <button title="退出登录" className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><LogOut size={16} /></button>
      </form>
    </div>
  );

  // 手机底部常用入口
  const tabs = ["/", "/board", "/reviews", "/notifications"];
  const tabItems = [...items, { href: "/notifications", label: "通知", icon: "bell", badge: unread, group: "" }].filter((i) => tabs.includes(i.href));

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-stone-200/80 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 pt-5 pb-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">内</span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">内容工作台</div>
            <div className="text-[11px] text-stone-400">内容工作台</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">{list()}</div>
        <div className="space-y-0.5 border-t border-stone-100 p-3">
          {link({ href: "/notifications", label: "通知", icon: "bell", badge: unread, group: "" })}
          {userBlock}
        </div>
      </aside>

      {/* 手机：底部标签栏 + 抽屉 */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {tabItems.map((it) => {
          const Icon = ICONS[it.icon] ?? House;
          const on = active(it.href);
          return (
            <Link key={it.href} href={it.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "text-brand-600" : "text-stone-500"}`}>
              <Icon size={21} strokeWidth={on ? 2.2 : 1.8} />
              {it.label.replace("我的", "")}
              {!!it.badge && <span className="absolute top-1 left-1/2 ml-2 rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white">{it.badge}</span>}
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-stone-500">
          <Menu size={21} strokeWidth={1.8} />更多
        </button>
      </nav>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold">全部功能</span>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-stone-500"><X size={20} /></button>
            </div>
            {list(() => setOpen(false))}
            <div className="mt-3 border-t border-stone-100 pt-2">{userBlock}</div>
          </div>
        </div>
      )}
    </>
  );
}
