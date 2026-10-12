import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { Submit } from "@/components/submit";
import { requireUser } from "@/lib/auth";
import { accountMonthly, bonusByVideo, dataRows, recentMonths, dataCheckpoint } from "@/lib/stats";
import { fmtNum, getRules, isNewAccountAt, monthOf, shortDate, tierIndex, tierLabel, today } from "@/lib/rules";
import { PageHeader, Tabs, Tag } from "@/components/ui";
import { saveTargetForm as saveTarget } from "./actions";

export default async function DataPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const month = sp.month ?? monthOf(today());
  const tab = sp.tab ?? "videos";
  const r = getRules();
  const months = recentMonths(6, monthOf(today()));

  return (
    <>
      <PageHeader title="播放数据"
        desc={<>KPI = 视频号 + 抖音 双平台第7天合计。老号档 {r.tiers.map(fmtNum).join("/")}，新号前{r.new_months}个月按 {r.new_discount * 10} 折档。</>}
        actions={<div className="flex gap-1">{months.map((m) => <Link key={m} href={`/data?tab=${tab}&month=${m}`} className={`btn btn-sm ${m === month ? "btn-primary" : ""}`}>{m.slice(5)}月</Link>)}</div>} />
      <Tabs current={tab} items={[
        { key: "videos", label: "单条视频", href: `/data?month=${month}` },
        { key: "accounts", label: "账号月度汇总", href: `/data?tab=accounts&month=${month}` },
      ]} />
      {tab === "videos" ? <VideoTable month={month} /> : <AccountTable month={month} canEdit={me.role === "boss"} />}
    </>
  );
}

function VideoTable({ month }: { month: string }) {
  const currentRules = getRules();
  const rows = dataRows(month);
  const bonus = bonusByVideo();
  if (!rows.length) return <div className="card p-8 text-center text-sm text-stone-400">{month} 还没有已发布的视频</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr>
          <th>编号</th><th>发布</th><th>账号</th><th>标题</th><th>编导/剪辑</th><th>折算件数</th>
          <th className="text-right">视频号7天</th><th className="text-right">抖音7天</th><th className="text-right">合计</th><th className="text-right">涨粉</th>
          <th>爆款档</th><th className="text-right">爆款奖</th><th>30天档</th><th className="text-right">补差</th><th className="text-right">小红书赞藏</th>
        </tr></thead>
        <tbody>
          {rows.map((x) => {
            const basis = x.bonus_snapshot ? JSON.parse(x.bonus_snapshot) : null;
            const r = basis?.rules ?? currentRules;
            const isNew = isNewAccountAt(basis ? basis.new_since : x.new_since, x.published_at, r);
            const c7 = dataCheckpoint(x, "d7"), c30 = dataCheckpoint(x, "d30");
            const has7 = c7.complete, has30 = c30.complete;
            const i7 = has7 ? tierIndex(c7.total, isNew, r) : -1;
            const i30 = has30 ? tierIndex(c30.total, isNew, r) : -1;
            const b = bonus.get(x.id);
            return (
              <tr key={x.id}>
                <td><Link href={`/videos/${x.id}`} className="text-brand-600 hover:underline">{x.code}</Link></td>
                <td className="text-stone-500">{shortDate(x.published_at)}</td>
                <td className="whitespace-nowrap">{x.account_name}{isNew && <Tag tone="purple">新</Tag>}</td>
                <td className="min-w-48">{x.title}</td>
                <td className="whitespace-nowrap text-stone-600">{x.editor_name} / {x.cutter_name ?? "—"}</td>
                <td className="tabular-nums">{x.work_units ?? "未计件"}<span className="text-xs text-stone-400"> {x.cut_level}</span></td>
                <td className="text-right tabular-nums">{fmtNum(x.wx7)}</td>
                <td className="text-right tabular-nums">{fmtNum(x.dy7)}</td>
                <td className="text-right font-medium tabular-nums">{has7 ? fmtNum(c7.total) : "—"}</td>
                <td className="text-right tabular-nums">{fmtNum(x.fans7)}</td>
                <td>{has7 ? <Tag tone={i7 >= 0 ? "green" : "gray"}>{tierLabel(i7, isNew, r)}</Tag> : c7.applicable ? <Tag tone="amber">待登记</Tag> : <Tag>不适用</Tag>}</td>
                <td className="text-right tabular-nums">{b?.hit ? `¥${b.hit}` : ""}</td>
                <td>{has30 ? <Tag tone={i30 > i7 ? "green" : "gray"}>{tierLabel(i30, isNew, r)}</Tag> : ""}</td>
                <td className="text-right tabular-nums">{b?.diff ? `¥${b.diff}` : ""}</td>
                <td className="text-right tabular-nums">{x.xhs_likes != null || x.xhs_collects != null ? fmtNum((x.xhs_likes ?? 0) + (x.xhs_collects ?? 0)) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AccountTable({ month, canEdit }: { month: string; canEdit: boolean }) {
  const rows = accountMonthly(month);
  const sum = rows.reduce((s, x) => ({ count: s.count + x.count, plays: s.plays + x.plays, fans: s.fans + x.fans, hits: s.hits + x.hits }), { count: 0, plays: 0, fans: 0, hits: 0 });
  return (
    <div className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>账号</th><th>阶段</th><th>负责编导</th><th className="text-right">发布条数</th><th className="text-right">双平台播放</th><th className="text-right">涨粉</th><th className="text-right">爆款数</th><th>本月播放目标</th><th className="text-right">达成率</th><th className="text-right">下月建议</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.account.id}>
              <td className="font-medium">{x.account.name}</td>
              <td>{x.isNew ? <Tag tone="purple">新号</Tag> : <Tag>老号</Tag>}</td>
              <td>{x.editor}</td>
              <td className="text-right tabular-nums">{x.count}</td>
              <td className="text-right tabular-nums">{fmtNum(x.plays)}</td>
              <td className="text-right tabular-nums">{fmtNum(x.fans)}</td>
              <td className="text-right tabular-nums">{x.hits}</td>
              <td>
                {canEdit ? (
                  <ActionForm action={saveTarget} className="flex gap-1">
                    <input type="hidden" name="month" value={month} /><input type="hidden" name="account_id" value={x.account.id} />
                    <input name="target" defaultValue={x.target ?? ""} placeholder={x.suggestThis ? `建议 ${x.suggestThis}` : "首月只记基线"} className="input h-7 w-32 text-xs" />
                    <Submit done="已存" className="btn btn-sm">存</Submit>
                  </ActionForm>
                ) : fmtNum(x.target)}
              </td>
              <td className={`text-right tabular-nums ${x.rate == null ? "" : x.rate >= 1 ? "text-emerald-600" : "text-red-600"}`}>{x.rate == null ? "—" : `${Math.round(x.rate * 100)}%`}</td>
              <td className="text-right tabular-nums text-stone-500">{fmtNum(x.suggestNext)}</td>
            </tr>
          ))}
          <tr className="font-medium"><td>合计</td><td /><td /><td className="text-right">{sum.count}</td><td className="text-right">{fmtNum(sum.plays)}</td><td className="text-right">{fmtNum(sum.fans)}</td><td className="text-right">{sum.hits}</td><td /><td /><td /></tr>
        </tbody>
      </table>
    </div>
  );
}
