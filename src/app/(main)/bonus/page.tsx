import Link from "next/link";
import { Submit } from "@/components/submit";
import { requireUser } from "@/lib/auth";
import { withBase } from "@/lib/paths";
import { all } from "@/lib/db";
import { people } from "@/lib/queries";
import { recentMonths } from "@/lib/stats";
import { BONUS_KINDS, monthOf, today } from "@/lib/rules";
import { Field, PageHeader, Section, Select, Stat, Tag } from "@/components/ui";
import { addBonus, deleteBonus, publishMonth } from "./actions";

type B = { id: number; month: string; user_id: number; name: string; kind: string; amount: number; description: string | null; auto: number; published: number; video_id: number | null; created_at: string };

export default async function BonusPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  const boss = me.role === "boss";
  const month = (await searchParams).month ?? monthOf(today());
  const rows = all<B>(`SELECT b.*, u.name FROM bonuses b JOIN users u ON u.id=b.user_id WHERE b.month=? ${boss ? "" : "AND b.user_id=?"} ORDER BY u.id, b.kind, b.id`,
    ...(boss ? [month] : [month, me.id]));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const unpublished = rows.filter((r) => !r.published).length;
  const byPerson = Object.values(rows.reduce<Record<number, { name: string; byKind: Record<string, number>; total: number }>>((acc, r) => {
    const p = (acc[r.user_id] ??= { name: r.name, byKind: {}, total: 0 });
    p.byKind[r.kind] = (p.byKind[r.kind] ?? 0) + r.amount;
    p.total += r.amount;
    return acc;
  }, {}));
  const kinds = BONUS_KINDS.filter((k) => byPerson.some((p) => p.byKind[k]));

  return (
    <>
      <PageHeader title={boss ? "奖金清算" : "我的奖金"}
        desc={boss ? "爆款奖、升档补差按播放数据自动计算；其他奖项手动登记。公示后金额锁定，并通知到每个人。" : "只显示你自己的奖金明细。"}
        actions={<div className="flex gap-1">{recentMonths(6, monthOf(today())).map((m) => <Link key={m} href={`/bonus?month=${m}`} className={`btn btn-sm ${m === month ? "btn-primary" : ""}`}>{m.slice(5)}月</Link>)}</div>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`${month} 合计`} value={`¥${total.toLocaleString()}`} />
        <Stat label="条目" value={rows.length} sub={unpublished ? `${unpublished} 条待公示` : "已全部公示"} />
      </div>

      {boss && byPerson.length > 0 && (
        <Section title="按人汇总" className="mb-4" actions={
          <div className="flex gap-2">
            <a href={withBase(`/api/export/bonus?month=${month}`)} className="btn btn-sm">导出 CSV</a>
            {unpublished > 0 && <form action={publishMonth}><input type="hidden" name="month" value={month} /><Submit done={null} className="btn btn-sm btn-primary">确认并公示 {month}</Submit></form>}
          </div>}>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>姓名</th>{kinds.map((k) => <th key={k} className="text-right">{k}</th>)}<th className="text-right">合计</th></tr></thead>
              <tbody>
                {byPerson.map((p) => (
                  <tr key={p.name}><td>{p.name}</td>{kinds.map((k) => <td key={k} className="text-right tabular-nums">{p.byKind[k] ? `¥${p.byKind[k]}` : ""}</td>)}<td className="text-right font-medium tabular-nums">¥{p.total}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Section title="明细">
          {rows.length === 0 ? <p className="text-sm text-stone-400">本月暂无奖金</p> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr>{boss && <th>姓名</th>}<th>类型</th><th>说明</th><th className="text-right">金额</th><th>状态</th>{boss && <th />}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      {boss && <td className="whitespace-nowrap">{r.name}</td>}
                      <td className="whitespace-nowrap">{r.kind}{r.auto ? <span className="ml-1 text-xs text-stone-400">自动</span> : null}</td>
                      <td className="min-w-48 text-stone-600">{r.video_id ? <Link href={`/videos/${r.video_id}`} className="hover:underline">{r.description}</Link> : r.description}</td>
                      <td className="text-right tabular-nums">¥{r.amount}</td>
                      <td>{r.published ? <Tag tone="green">已公示</Tag> : <Tag tone="amber">待公示</Tag>}</td>
                      {boss && <td>{!r.published && <form action={deleteBonus}><input type="hidden" name="id" value={r.id} /><Submit done={null} className="text-xs text-red-500 hover:underline">删除</Submit></form>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        {boss && (
          <Section title="登记其他奖项">
            <form action={addBonus} className="space-y-3">
              <input type="hidden" name="month" value={month} />
              <Field label="获奖人"><Select name="user_id" required placeholder="选择" options={people().filter((p) => p.role !== "boss").map((p) => ({ value: p.id, label: p.name }))} /></Field>
              <Field label="类型"><Select name="kind" options={BONUS_KINDS.filter((k) => k !== "爆款奖" && k !== "升档补差")} /></Field>
              <Field label="金额（元）"><input name="amount" type="number" required className="input" /></Field>
              <Field label="说明"><input name="description" className="input" placeholder="如：抖音单条52w播放" /></Field>
              <p className="text-xs text-stone-400">示例：平台单项奖、创意采用奖；金额按自己的规则登记。</p>
              <Submit done={null} className="btn btn-primary w-full">登记</Submit>
            </form>
          </Section>
        )}
      </div>
    </>
  );
}
