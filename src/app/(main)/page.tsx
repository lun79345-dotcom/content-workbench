import Link from "next/link";
import { AlarmClock, BookOpen, ChartColumn, ChevronRight, ClipboardCheck, Clapperboard, Plus, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { leaderId, listVideos } from "@/lib/queries";
import { currentDue, diffDays, fmtNum, monthOf, overdueDays, stageOwner, today, needsMetrics, type VideoRow } from "@/lib/rules";
import { Empty, Section, Stat, Tag } from "@/components/ui";
import { DueTag, STAGE_COLOR } from "@/components/video";

/** 当前阶段该做的下一步（给负责人的提示） */
const NEXT_HINT: Record<string, string> = {
  选题: "开始写脚本",
  脚本: "写完提交脚本审核",
  拍摄: "拍完交给剪辑",
  剪辑: "剪完提交成片审核",
  待发布: "发布后登记链接",
};

function greet() {
  const h = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}

export default async function Home() {
  const me = await requireUser();
  const t = today();
  const boss = me.role === "boss";
  const leader = leaderId();

  const active = listVideos("v.stage!='已发布'");
  const mine = active.filter((v) => boss ? overdueDays(v) > 0 : stageOwner(v, leader) === me.id && !["脚本审核", "成片审核"].includes(v.stage));
  const urgent = mine
    .map((v) => ({ v, due: currentDue(v)?.date }))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));

  const toReview = all<{ id: number; node: string; video_id: number; code: string; title: string; submitted_at: string; submitter: string }>(
    `SELECT r.id, r.node, r.video_id, v.code, v.title, r.submitted_at, s.name submitter FROM reviews r JOIN videos v ON v.id=r.video_id LEFT JOIN users s ON s.id=r.submitter_id
     WHERE r.status='待审' AND r.reviewer_id=? ORDER BY r.id`, me.id);

  // 需要登记数据：第7天/第30天已到但未登记完整（编导负责）
  const pub = listVideos("v.stage='已发布'" + (boss ? "" : " AND v.editor_id=" + me.id));
  const needData: { v: VideoRow; cp: string }[] = [];
  for (const v of pub) {
    const age = diffDays(t, v.published_at!);
    for (const [cp, d] of [["d7", 7], ["d30", 30]] as const) {
      if (age >= d && needsMetrics(v.id, cp)) needData.push({ v, cp });
    }
  }

  const month = monthOf(t);
  const myBonus = get<{ s: number }>("SELECT COALESCE(sum(amount),0) s FROM bonuses WHERE user_id=? AND month=?", me.id, month)!.s;
  const myPublished = get<{ n: number }>(`SELECT count(*) n FROM videos WHERE stage='已发布' AND substr(published_at,1,7)=? AND (editor_id=? OR cutter_id=?)`, month, me.id, me.id)!.n;
  const myOverdue = active.filter((v) => stageOwner(v, leader) === me.id && overdueDays(v) > 0).length;
  const overdueCount = boss ? urgent.length : myOverdue;
  const isNew = get<{ n: number }>("SELECT count(*) n FROM videos WHERE editor_id=? OR cutter_id=?", me.id, me.id)!.n === 0 && !boss;
  const todo = urgent.length + toReview.length + needData.length;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-stone-500">{t.replace(/-/g, "/")} · {greet()}</div>
          <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight">
            {me.name}，{todo === 0 ? "今天没有待办" : <>今天有 <span className="text-brand-600">{todo}</span> 件事等你</>}
          </h1>
        </div>
        {me.role !== "cutter" && <Link href="/videos/new" className="btn btn-primary"><Plus size={16} />新建需求单</Link>}
      </div>

      {isNew && (
        <Link href="/guide" className="mb-5 flex items-center gap-3 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100/60">
          <BookOpen size={18} className="shrink-0" />
          <span className="flex-1">第一次使用？花 3 分钟看看你这个岗位的操作步骤。</span>
          <span className="flex items-center font-medium">使用指南<ChevronRight size={16} /></span>
        </Link>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={boss ? "全部逾期" : "我的逾期"} value={overdueCount} tone={overdueCount > 0 ? "red" : "default"} icon={<AlarmClock size={15} />} href="/board" sub={overdueCount > 0 ? "点开看板处理" : "保持住"} />
        <Stat label="待我审核" value={toReview.length} tone={toReview.length ? "amber" : "default"} icon={<ClipboardCheck size={15} />} href="/reviews" sub={toReview.length ? "脚本 4 小时内审完" : "暂无"} />
        <Stat label="本月发布（我参与）" value={myPublished} tone="blue" icon={<Clapperboard size={15} />} href="/data" />
        <Stat label="本月奖金" value={`¥${fmtNum(myBonus)}`} tone="green" icon={<Wallet size={15} />} href="/bonus" sub="公示后锁定" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Section title={boss ? "逾期中的视频" : "我手上的活"} className="lg:row-span-2" actions={<Link href="/board" className="text-xs text-brand-600 hover:underline">看板 →</Link>}>
          {urgent.length === 0 ? <Empty icon={<Clapperboard size={20} />}>{boss ? "没有逾期的视频" : "手上没有要推进的视频"}</Empty> : (
            <ul className="-mx-2 space-y-1">
              {urgent.map(({ v }) => (
                <li key={v.id}>
                  <Link href={`/videos/${v.id}`} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-stone-50">
                    <span className={`h-9 w-1 shrink-0 rounded-full ${overdueDays(v) > 0 ? "bg-red-500" : STAGE_COLOR[v.stage]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{v.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-400">
                        <span>{v.account_name}</span><span>·</span><span>{v.stage}</span>
                        {!boss && NEXT_HINT[v.stage] && <><span>·</span><span className="text-stone-600">下一步：{NEXT_HINT[v.stage]}</span></>}
                      </div>
                    </div>
                    <DueTag v={v} />
                    <ChevronRight size={16} className="shrink-0 text-stone-300 group-hover:text-stone-500" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="待我审核" icon={<ClipboardCheck size={16} />} actions={<Link href="/reviews" className="text-xs text-brand-600 hover:underline">全部 →</Link>}>
          {toReview.length === 0 ? <p className="text-sm text-stone-400">暂无待审内容</p> : (
            <ul className="-mx-2 space-y-1">
              {toReview.map((r) => {
                const hours = (Date.now() - Date.parse(r.submitted_at.replace(" ", "T") + "+08:00")) / 3600000;
                return (
                  <li key={r.id}>
                    <Link href={`/videos/${r.video_id}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-stone-50">
                      <div className="min-w-0"><div className="truncate text-sm">{r.title}</div><div className="text-xs text-stone-400">{r.node} · {r.submitter} 提交</div></div>
                      <Tag tone={r.node === "脚本审核" && hours > 4 ? "red" : "amber"}>{hours < 1 ? "刚刚" : `${Math.floor(hours)} 小时前`}</Tag>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="待登记播放数据" icon={<ChartColumn size={16} />}>
          {needData.length === 0 ? <p className="text-sm text-stone-400">暂无，发布满 7 天 / 30 天会出现在这里</p> : (
            <ul className="-mx-2 space-y-1">
              {needData.map(({ v, cp }) => (
                <li key={v.id + cp}>
                  <Link href={`/videos/${v.id}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-stone-50">
                    <div className="min-w-0 truncate text-sm">{v.title}</div>
                    <Tag tone="amber">{cp === "d7" ? "第 7 天定档" : "第 30 天升档"}</Tag>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
