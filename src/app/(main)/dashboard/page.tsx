import Link from "next/link";
import { requireBoss } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { leaderId, listVideos } from "@/lib/queries";
import { accountMonthly, recentMonths } from "@/lib/stats";
import { STAGES, fmtNum, monthOf, overdueDays, stageOwner, today } from "@/lib/rules";
import { PageHeader, Section, Stat, Tag } from "@/components/ui";

export default async function Dashboard() {
  await requireBoss();
  const month = monthOf(today());
  const acc = accountMonthly(month);
  const plays = acc.reduce((s, a) => s + a.plays, 0);
  const target = acc.reduce((s, a) => s + (a.target ?? 0), 0);
  const hits = acc.reduce((s, a) => s + a.hits, 0);
  const published = acc.reduce((s, a) => s + a.count, 0);
  const fans = acc.reduce((s, a) => s + a.fans, 0);
  const active = listVideos("v.stage!='已发布'");
  const leader = leaderId();
  const overdue = active.filter((v) => overdueDays(v) > 0);
  const bonus = get<{ s: number }>("SELECT COALESCE(sum(amount),0) s FROM bonuses WHERE month=?", month)!.s;
  const pendingReview = get<{ n: number }>("SELECT count(*) n FROM reviews WHERE status='待审'")!.n;

  const users = all<{ id: number; name: string }>("SELECT id,name FROM users");
  const overdueByPerson = Object.entries(overdue.reduce<Record<string, number>>((m, v) => {
    const o = stageOwner(v, leader);
    const n = users.find((u) => u.id === o)?.name ?? "未分配";
    m[n] = (m[n] ?? 0) + 1;
    return m;
  }, {})).sort((a, b) => b[1] - a[1]);
  const rejects = all<{ who: string; reason: string; n: number }>(`
    SELECT CASE WHEN reason LIKE '剪辑%' THEN '剪辑' WHEN reason LIKE '编导%' THEN '编导' ELSE '其他' END who, reason, count(*) n
    FROM reviews WHERE status='打回' AND date(done_at) >= date('now','-30 day') GROUP BY reason ORDER BY n DESC`);
  const trend = recentMonths(6, month).reverse().map((m) => ({ m, plays: accountMonthly(m).reduce((s, a) => s + a.plays, 0) }));
  const maxTrend = Math.max(1, ...trend.map((t) => t.plays));

  return (
    <>
      <PageHeader title="老板驾驶舱" desc={`${month} · 数据为已登记的第7天双平台播放`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="本月播放" value={fmtNum(plays)} sub={target ? `目标 ${fmtNum(target)} · 达成 ${Math.round((plays / target) * 100)}%` : "未设目标"} tone={target ? (plays >= target ? "green" : undefined) : undefined} />
        <Stat label="爆款数" value={hits} />
        <Stat label="发布条数" value={published} />
        <Stat label="涨粉" value={fmtNum(fans)} />
        <Stat label="逾期中" value={overdue.length} tone={overdue.length ? "red" : undefined} sub={`待审 ${pendingReview}`} />
        <Stat label="本月奖金" value={`¥${bonus.toLocaleString()}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="账号表现" className="lg:col-span-2" actions={<Link href="/data?tab=accounts" className="text-xs text-brand-600">设目标 →</Link>}>
          <div className="space-y-2.5">
            {acc.map((a) => {
              const pctv = a.target ? Math.min(1, a.plays / a.target) : null;
              return (
                <div key={a.account.id} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate">{a.account.name}{a.isNew && <Tag tone="purple">新</Tag>}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                    {pctv != null && <div className={`h-full rounded-full ${pctv >= 1 ? "bg-emerald-500" : "bg-brand-500"}`} style={{ width: `${pctv * 100}%` }} />}
                  </div>
                  <span className="w-48 text-right text-xs tabular-nums text-stone-500">{fmtNum(a.plays)}{a.target ? ` / ${fmtNum(a.target)}` : ""} · {a.count}条 · 爆{a.hits}</span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="近6个月播放">
          <div className="flex h-36 items-end gap-2">
            {trend.map((t) => (
              <div key={t.m} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] tabular-nums text-stone-500">{fmtNum(t.plays)}</span>
                <div className="w-full rounded-t bg-brand-500" style={{ height: `${(t.plays / maxTrend) * 100}px`, minHeight: 2 }} />
                <span className="text-[10px] text-stone-400">{t.m.slice(5)}月</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="生产流水线">
          <ul className="space-y-1.5 text-sm">
            {STAGES.slice(0, -1).map((st) => {
              const vs = active.filter((v) => v.stage === st);
              const od = vs.filter((v) => overdueDays(v) > 0).length;
              return <li key={st} className="flex justify-between"><span>{st}</span><span className="tabular-nums">{vs.length}{od > 0 && <span className="ml-2 text-red-600">逾期{od}</span>}</span></li>;
            })}
          </ul>
        </Section>

        <Section title="谁在拖期">
          {overdueByPerson.length === 0 ? <p className="text-sm text-stone-400">无逾期 👍</p> : (
            <ul className="space-y-1.5 text-sm">{overdueByPerson.map(([n, c]) => <li key={n} className="flex justify-between"><span>{n}</span><span className="text-red-600 tabular-nums">{c} 条</span></li>)}</ul>
          )}
          {overdue.length > 0 && <Link href="/board" className="mt-3 block text-xs text-brand-600">去看板 →</Link>}
        </Section>

        <Section title="近30天打回原因">
          {rejects.length === 0 ? <p className="text-sm text-stone-400">暂无</p> : (
            <ul className="space-y-1.5 text-sm">
              {rejects.map((r) => <li key={r.reason} className="flex justify-between gap-2"><span><Tag tone={r.who === "剪辑" ? "amber" : r.who === "编导" ? "purple" : "gray"}>{r.who}</Tag> {r.reason.split("-")[1] ?? r.reason}</span><span className="tabular-nums">{r.n}</span></li>)}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
