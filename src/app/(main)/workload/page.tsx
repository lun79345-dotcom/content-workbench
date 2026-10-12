import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { addDays, isoWeek, monthOf, today, weekRange } from "@/lib/rules";
import { month as validMonth, week as validWeek } from "@/lib/validation";
import { cutterRange } from "@/lib/workload";
import { Empty, Field, PageHeader, Section, Stat, Tag } from "@/components/ui";
const num = (n: number) => Number(n.toFixed(2));
const pct = (n: number | null) => n == null ? "—" : `${Math.round(n * 100)}%`;
export default async function WorkloadPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  if (me.role !== "boss" && me.role !== "cutter") redirect("/weekly");
  const params = await searchParams, mode = params.mode === "month" ? "month" : "week";
  let period: string;
  try { period = mode === "week" ? validWeek(params.period ?? isoWeek(today())) : validMonth(params.period ?? monthOf(today())); }
  catch { period = mode === "week" ? isoWeek(today()) : monthOf(today()); }
  const [start, end] = mode === "week" ? weekRange(period) : [period + "-01", addDays(period === `${period.slice(0, 4)}-12` ? `${Number(period.slice(0, 4)) + 1}-01-01` : `${period.slice(0, 4)}-${String(Number(period.slice(5)) + 1).padStart(2, "0")}-01`, -1)];
  const people = me.role === "boss" ? all<{ id: number; name: string; role: string }>(`SELECT id,name,role FROM users WHERE role='cutter' OR EXISTS(SELECT 1 FROM work_deliveries w WHERE w.cutter_id=users.id) ORDER BY id`) : [me];
  const rows = people.map((person) => ({ person, ...cutterRange(person.id, start, end) }));
  const total = rows.reduce((n, r) => n + r.units, 0), count = rows.reduce((n, r) => n + r.delivered, 0);
  return <>
    <PageHeader title={me.role === "boss" ? "剪辑工作量" : "我的工作量"} desc="按首次提交成片统计。折算件数 = 当时定档件数 + 已确认加件；返工重提不重复计件，代提交计入指定剪辑。" />
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Link href="/workload?mode=week" className={`btn ${mode === "week" ? "btn-primary" : ""}`}>按周</Link>
      <Link href="/workload?mode=month" className={`btn ${mode === "month" ? "btn-primary" : ""}`}>按月</Link>
      <form key={`${mode}-${period}`} className="flex items-end gap-2"><input type="hidden" name="mode" value={mode} /><Field label={mode === "week" ? "选择周次" : "选择月份"}><input name="period" type={mode} defaultValue={period} className="input" required /></Field><button className="btn">查看</button></form>
      <span className="pb-2 text-sm text-stone-500">{start} ~ {end}</span>
    </div>
    <div className="mb-4 grid grid-cols-2 gap-3"><Stat label="实际出片" value={`${count} 条`} /><Stat label="折算工作量" value={`${num(total)} 件`} sub="含已确认加件" /></div>
    <Section title="按人汇总" className="mb-4">
      <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>剪辑</th><th>实际条数</th><th>定档件数</th><th>加件</th><th>合计件数</th><th>准时 / 考核条数</th><th>准时率</th><th>返工次数</th><th>免责 / 无截止</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.person.id}><td><a href={`#person-${r.person.id}`} className="hover:underline">{r.person.name}</a>{r.person.role === "disabled" && <span className="ml-1 text-xs text-stone-400">已停用</span>}</td><td>{r.delivered}</td><td>{num(r.baseUnits)}</td><td>{num(r.extraUnits)}</td><td className="font-semibold">{num(r.units)}</td><td>{r.onTime} / {r.eligible}</td><td>{pct(r.onTimeRate)}</td><td>{r.rework}</td><td>{r.exempt} / {r.missingDue}</td></tr>)}
      </tbody></table></div>
      <p className="mt-3 text-xs text-stone-500">准时率仅统计有截止日期且未免责的交付。返工按本期审核打回次数统计，仅计剪辑责任；复核免责后不计。没有自动扣分或工时估算。</p>
    </Section>
    <div className="space-y-4">{rows.map((r) => <section key={r.person.id} id={`person-${r.person.id}`} className="scroll-mt-4"><Section title={`${r.person.name} · 交付明细`}>
      {!r.deliveries.length ? <Empty>本期没有首次交付记录</Empty> : <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>首次提交</th><th>视频 / 账号</th><th>定档</th><th>基本件数</th><th>加件</th><th>合计</th><th>初剪截止</th><th>准时考核</th></tr></thead><tbody>
        {r.deliveries.map((v) => <tr key={v.video_id}><td className="whitespace-nowrap">{v.submitted_at.slice(5, 16)}</td><td><Link href={`/videos/${v.video_id}`} className="hover:underline">{v.code} {v.title}</Link><div className="text-xs text-stone-400">{v.account_name}{v.provenance === "legacy" ? " · 历史回填" : ""}</div></td><td>{v.cut_level}</td><td>{num(v.base_units)}</td><td>{num(v.extra_units)}</td><td className="font-medium">{num(v.base_units + v.extra_units)}</td><td>{v.due_rough ?? "未设置"}</td><td>{v.late_exempt_reason ? <Tag tone="purple">免责</Tag> : !v.due_rough ? <Tag>不计准时率</Tag> : v.submitted_at.slice(0, 10) <= v.due_rough ? <Tag tone="green">准时</Tag> : <Tag tone="red">逾期</Tag>}{v.late_exempt_reason && <div className="mt-1 text-xs text-stone-500">{v.late_exempt_reason}</div>}</td></tr>)}
      </tbody></table></div>}
    </Section></section>)}</div>
    <p className="mt-4 text-xs text-stone-500">新交付保存负责人、定档件数、截止和需求变更记录；经确认的后续调整会留痕。历史回填使用现存审核记录和视频字段，无法还原此前已被覆盖的档位或负责人。</p>
  </>;
}
