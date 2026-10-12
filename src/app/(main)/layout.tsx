import { requireUser, ROLE_LABEL } from "@/lib/auth";
import { get } from "@/lib/db";
import { Nav, type NavItem } from "@/components/nav";

export const dynamic = "force-dynamic";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const boss = me.role === "boss";
  const unread = get<{ n: number }>("SELECT count(*) n FROM notifications WHERE user_id=? AND read=0", me.id)!.n;
  const pendingReviews = get<{ n: number }>("SELECT count(*) n FROM reviews WHERE status='待审' AND reviewer_id=?", me.id)!.n;

  const items: NavItem[] = [
    { href: "/", label: "我的工作台", icon: "home", group: "" },
    { href: "/board", label: "生产看板", icon: "board", group: "" },
    { href: "/reviews", label: "审核", icon: "review", badge: pendingReviews, group: "" },
    { href: "/data", label: "播放数据", icon: "data", group: "数据与复盘" },
    { href: "/bonus", label: boss ? "奖金清算" : "我的奖金", icon: "bonus", group: "数据与复盘" },
    ...(["boss", "cutter"].includes(me.role) ? [{ href: "/workload", label: boss ? "剪辑工作量" : "我的工作量", icon: "data", group: "数据与复盘" }] : []),
    { href: "/weekly", label: "周复盘", icon: "weekly", group: "数据与复盘" },
    { href: "/ideas", label: "创意库", icon: "idea", group: "创意" },
    { href: "/students", label: "学生征集", icon: "student", group: "创意" },
    ...(boss ? [
      { href: "/dashboard", label: "老板驾驶舱", icon: "dashboard", group: "管理" },
      { href: "/settings", label: "设置", icon: "settings", group: "管理" },
    ] : []),
    { href: "/guide", label: "使用指南", icon: "guide", group: "帮助" },
  ];

  return (
    <div className="min-h-screen">
      <Nav items={items} user={{ name: me.name, role: ROLE_LABEL[me.role], avatar: me.avatar }} unread={unread} />
      <main className="mx-auto max-w-[1400px] px-4 pt-5 pb-24 md:ml-56 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
