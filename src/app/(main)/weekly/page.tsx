import Link from "next/link";
import { Submit } from "@/components/submit";
import { ActionForm } from "@/components/action-form";
import { actionResult } from "@/lib/action-errors";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { all, get, run } from "@/lib/db";
import { addDays, fmtNum, isoWeek, today, weekRange } from "@/lib/rules";
import { week as validWeek, text, number } from "@/lib/validation";
import { cutterWeek, editorWeek } from "@/lib/weekly";
import { Field, PageHeader, Section, Stat, Tabs } from "@/components/ui";
import { AccountWeekly } from "@/components/account-weekly";

type W = { user_id: number; best: string | null; best_why: string | null; worst: string | null; worst_why: string | null; insight: string | null; self_score: number | null; blockers: string | null; next_plan: string | null; updated_at: string };

async function saveWeekly(fd: FormData) {
  "use server";
  const me = await requireUser();
  const f = (k: string) => text(fd, k);
  const score = number(fd, "self_score", { min: 1, max: 10, integer: true });
  run(`INSERT INTO weekly(week,user_id,best,best_why,worst,worst_why,insight,self_score,blockers,next_plan) VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(week,user_id) DO UPDATE SET best=excluded.best,best_why=excluded.best_why,worst=excluded.worst,worst_why=excluded.worst_why,
       insight=excluded.insight,self_score=excluded.self_score,blockers=excluded.blockers,next_plan=excluded.next_plan,updated_at=datetime('now','+8 hours')`,
    validWeek(f("week")), me.id, f("best"), f("best_why"), f("worst"), f("worst_why"), f("insight"), score, f("blockers"), f("next_plan"));
  revalidatePath("/weekly");
}

async function saveWeeklyForm(fd: FormData) {
  "use server";
  return actionResult(() => saveWeekly(fd));
}

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export default async function WeeklyPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  const sp = await searchParams, rawWeek = sp.week;
  const tab = sp.tab === "people" ? "people" : "accounts";
  let week: string;
  try { week = validWeek(rawWeek ?? isoWeek(today())); } catch { week = isoWeek(today()); }
  const [s, e] = weekRange(week);
  const prev = isoWeek(addDays(s, -7)), next = isoWeek(addDays(s, 7));
  const nav = (
    <div className="flex gap-1">
      <Link href={`/weekly?week=${prev}&tab=${tab}${sp.account ? `&account=${encodeURIComponent(sp.account)}` : ""}`} className="btn btn-sm">← {prev.slice(5)}</Link>
      <span className="btn btn-sm btn-primary">{week.slice(5)}（{s.slice(5)}~{e.slice(5)}）</span>
      <Link href={`/weekly?week=${next}&tab=${tab}${sp.account ? `&account=${encodeURIComponent(sp.account)}` : ""}`} className="btn btn-sm">{next.slice(5)} →</Link>
    </div>
  );
  const tabs = <Tabs current={tab} items={[{ key: "accounts", label: "账号周复盘", href: `/weekly?week=${week}` }, { key: "people", label: "个人周复盘", href: `/weekly?week=${week}&tab=people` }]} />;
  if (tab === "accounts") return <><PageHeader title="账号周复盘" desc="按账号汇总产出与成熟作品表现，形成可执行的下周计划。" actions={nav} />{tabs}<AccountWeekly week={week} accountId={Number(sp.account)} me={me} /></>;

  if (me.role === "boss") {
    const members = all<{ id: number; name: string; role: string }>("SELECT id,name,role FROM users WHERE role IN ('editor','cutter') ORDER BY role DESC, id");
    const ws = all<W>("SELECT * FROM weekly WHERE week=?", week);
    return (
      <>
        <PageHeader title="周复盘" desc="周五复盘会前，每人填好自己的部分；数字部分系统自动统计。" actions={nav} />
        {tabs}
        <div className="space-y-4">
          {members.map((m) => {
            const w = ws.find((x) => x.user_id === m.id);
            const auto = m.role === "editor" ? editorWeek(m.id, week) : null;
            const cut = m.role === "cutter" ? cutterWeek(m.id, week) : null;
            return (
              <Section key={m.id} title={<>{m.name} <span className="font-normal text-stone-400">{m.role === "editor" ? "编导" : "剪辑"}{w ? ` · 已填 ${w.updated_at.slice(5, 16)}` : " · 未填"}</span></>}>
                <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-stone-600">
                  {auto && <><span>产出 {auto.produced}（人设{auto.persona}/剧情{auto.drama}）</span><span>分发完成率 {pct(auto.distRate)}</span><span>储备 {auto.reserve}</span><span>创意投递 {auto.ideas}</span></>}
                  {cut && <><span>出片 {cut.delivered} 条 / {cut.units} 件（加件 {cut.extraUnits}）</span><span>准时率 {pct(cut.onTimeRate)}</span><span>返工 {cut.rework}{cut.reworkReason ? `（${cut.reworkReason}）` : ""}</span><span>创意投递 {cut.ideas}</span>{w?.self_score && <span>自评 {w.self_score}/10</span>}</>}
                </div>
                {w ? (
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {[["最佳", w.best, w.best_why], ["最差", w.worst, w.worst_why], ["心得", w.insight, null], ["卡点/需支持", w.blockers, null], ["下周计划", w.next_plan, null]].filter((x) => x[1]).map(([k, a, b]) => (
                      <div key={k as string}><dt className="inline text-stone-400">{k}：</dt><dd className="inline">{a}{b ? ` —— ${b}` : ""}</dd></div>
                    ))}
                  </dl>
                ) : <p className="text-sm text-stone-400">尚未填写</p>}
              </Section>
            );
          })}
        </div>
      </>
    );
  }

  const w = get<W>("SELECT * FROM weekly WHERE week=? AND user_id=?", week, me.id);
  const ed = me.role === "editor" ? editorWeek(me.id, week) : null;
  const cu = me.role === "cutter" ? cutterWeek(me.id, week) : null;
  return (
    <>
      <PageHeader title="我的周复盘" desc="数字系统已经统计好了，你只需要填分析和计划。" actions={nav} />
      {tabs}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {ed && <>
          <Stat label="本周产出" value={ed.produced} sub={`人设${ed.persona} / 剧情${ed.drama}`} />
          <Stat label="分发完成率" value={pct(ed.distRate)} sub="抖音+视频号都发了" />
          <Stat label="脚本储备" value={ed.reserve} sub="已过审未发布" />
          <Stat label="创意投递" value={ed.ideas} />
          <Stat label="本周最佳" value={ed.best ? fmtNum(ed.best.plays) : "—"} sub={ed.best?.title} />
        </>}
        {cu && <>
          <Stat label="出片条数" value={cu.delivered} />
          <Stat label="折算工作量" value={`${cu.units} 件`} sub={`基本${cu.baseUnits} + 加件${cu.extraUnits}`} />
          <Stat label="准时交付率" value={pct(cu.onTimeRate)} sub={`考核${cu.eligible}条 / 免责${cu.exempt} / 无截止${cu.missingDue}`} />
          <Stat label="返工次数" value={cu.rework} tone={cu.rework ? "red" : undefined} sub={cu.reworkReason ?? undefined} />
          <Stat label="创意投递" value={cu.ideas} />
        </>}
      </div>
      <ActionForm action={saveWeeklyForm} className="card grid gap-3 p-5 sm:grid-cols-2">
        <input type="hidden" name="week" value={week} />
        {ed ? <>
          <Field label="本周最佳（标题+数据）"><input name="best" defaultValue={w?.best ?? (ed.best ? `《${ed.best.title}》${fmtNum(ed.best.plays)}` : "")} className="input" /></Field>
          <Field label="最佳原因分析"><input name="best_why" defaultValue={w?.best_why ?? ""} className="input" placeholder="前3秒冲突钩子+评论区争议引导" /></Field>
          <Field label="本周最差（标题+数据）"><input name="worst" defaultValue={w?.worst ?? (ed.worst ? `《${ed.worst.title}》${fmtNum(ed.worst.plays)}` : "")} className="input" /></Field>
          <Field label="最差原因分析"><input name="worst_why" defaultValue={w?.worst_why ?? ""} className="input" /></Field>
        </> : <>
          <Field label="本周最满意作品"><input name="best" defaultValue={w?.best ?? ""} className="input" /></Field>
          <Field label="自我评分（1-10）"><input type="number" min={1} max={10} name="self_score" defaultValue={w?.self_score ?? ""} className="input" /></Field>
          <Field label="包装/节奏心得" className="sm:col-span-2"><input name="insight" defaultValue={w?.insight ?? ""} className="input" placeholder="前3秒放大字幕+音效卡点有效" /></Field>
        </>}
        <Field label="卡点与所需支持"><textarea name="blockers" rows={2} defaultValue={w?.blockers ?? ""} className="input" /></Field>
        <Field label="下周计划"><textarea name="next_plan" rows={2} defaultValue={w?.next_plan ?? ""} className="input" /></Field>
        <div className="flex items-center justify-end gap-3 sm:col-span-2">
          {w && <span className="text-xs text-stone-400">上次保存 {w.updated_at.slice(5, 16)}</span>}
          <Submit className="btn btn-primary">保存</Submit>
        </div>
      </ActionForm>
    </>
  );
}
