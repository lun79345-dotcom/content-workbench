import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { benchmarkRun, benchmarkVideos } from "@/lib/benchmark";
import { validateAiInput, validateAiReport } from "@/lib/ai-analysis";
import { ActionForm } from "@/components/action-form";
import { Field, PageHeader, Section, Tag } from "@/components/ui";
import { Submit } from "@/components/submit";
import { AiJobPoller } from "@/components/ai-job-poller";
import { fmtNum } from "@/lib/rules";
import { queryAccountForm, analyzeHitForm } from "./actions";

export default async function BenchmarkPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser(); if (!["boss", "editor"].includes(me.role)) redirect("/");
  const sp = await searchParams, run = benchmarkRun(Number(sp.run)), videos = run ? benchmarkVideos(run.id) : [];
  const top = videos.filter(v => v.plays != null).slice(0, 10);
  const job = get<{ id: number; status: string; transcript: string | null; report_json: string | null; input_json: string; error: string | null }>("SELECT * FROM ai_jobs WHERE id=? AND requested_by=? AND kind='hit_analysis'", Number(sp.job) || 0, me.id);
  let report;
  try { if (job?.status === "done") report = validateAiReport(JSON.parse(job.report_json!), validateAiInput({ ...JSON.parse(job.input_json), transcript: job.transcript ?? JSON.parse(job.input_json).transcript ?? "" })); } catch { /* Invalid output is never displayed as a trusted report. */ }
  return <>
    <PageHeader title="抖音账号爆款研究" desc="查询账号近期作品，按播放量选出前10条，再选择需要转录和拆解的作品。" />
    <Section title="查询目标账号" className="mb-5">
      <ActionForm action={queryAccountForm} className="space-y-3"><Field label="抖音账号主页链接 / 分享文案"><textarea name="account_link" rows={2} required className="input" placeholder="粘贴抖音账号主页链接，不是单条视频链接" /></Field><p className="text-xs leading-relaxed text-stone-500">查询近90天，最多翻3页、采集60条作品，单次最多6个TikHub请求；结果缓存24小时。与每日播放采集共用额度。仅选中视频才下载转录，每条最多追加1个详情请求。</p><Submit done={null} className="btn btn-primary">查询账号作品</Submit></ActionForm>
    </Section>
    {run && <Section title={`${run.nickname ?? "目标账号"} · 近期播放前10条`} className="mb-5">
      <p className="mb-3 text-sm text-stone-600">范围：{run.cutoff}起发布 · 已获取{videos.length}条 · 有播放量{videos.filter(v=>v.plays!=null).length}条 · 查询于{run.created_at}</p>
      {run.truncated > 0 && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">已到查询页数上限，以下为已采集作品中的排名，不能代表该账号全部作品。</p>}
      {run.status === "failed" && <p role="alert">{run.error}</p>}
      <div className="space-y-4">{top.map((v, i) => <article key={v.id} className="rounded-xl border border-stone-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><a href={`https://www.douyin.com/video/${v.aweme_id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-700 hover:underline">{i+1}. {v.caption || "未提供标题"}</a><p className="mt-2 text-xs text-stone-500">{v.published_at} · 播放 {fmtNum(v.plays)} · 赞 {fmtNum(v.likes)} · 评论 {fmtNum(v.comments)} · 收藏 {fmtNum(v.collects)} · 分享 {fmtNum(v.shares)}</p></div><Tag tone="blue">第{i+1}名</Tag></div>
        <ActionForm action={analyzeHitForm} className="mt-3 space-y-3"><input type="hidden" name="run_id" value={run.id} /><input type="hidden" name="video_id" value={v.id} /><details><summary className="cursor-pointer text-xs text-stone-500">已有逐字稿？粘贴后可跳过自动转录</summary><Field label="逐字稿"><textarea name="transcript" rows={4} maxLength={40000} className="input" /></Field></details><Submit done={null} className="btn btn-sm">转录并拆解这条视频</Submit></ActionForm>
      </article>)}{!top.length && <p className="text-sm text-stone-500">暂无可按播放量排名的作品。播放量缺失会保持未知，不按0处理。</p>}</div>
    </Section>}
    {job && <Section title="AI 结构拆解">
      <AiJobPoller active={["queued","transcribing","ready","running"].includes(job.status)} />
      {["queued","transcribing","ready","running"].includes(job.status) && <p role="status" className="text-sm text-brand-700">{({queued:"已排队，等待转录 / 本机分析",transcribing:"服务器正在转录",ready:"转录已完成，等待本机 Codex",running:"本机 Codex 正在分析"}[job.status] ?? "正在处理")}，结果会自动刷新。</p>}
      {job.status === "failed" && <p role="alert" className="text-sm text-amber-700">{job.error}</p>}
      {report && <div className="space-y-4 text-sm"><h3 className="font-medium">{report.title}</h3><p className="whitespace-pre-wrap leading-relaxed">{report.summary}</p>{report.sections.map((section,i)=><div key={i} className="rounded-lg bg-stone-50 p-4"><h4 className="font-medium">{section.title}</h4>{section.evidence && <blockquote className="my-2 border-l-2 border-stone-300 pl-3 text-stone-500">{section.evidence}</blockquote>}<p className="whitespace-pre-wrap">{section.analysis}</p></div>)}<div><h3 className="mb-2 font-medium">可迁移的结构提纲</h3><p className="whitespace-pre-wrap">{report.draft}</p></div><ul className="list-disc space-y-2 pl-5">{report.actions.map((s,i)=><li key={i}>{s}</li>)}</ul><div className="rounded-lg bg-amber-50 p-3"><h3 className="mb-2 font-medium">分析依据与局限</h3><ul className="list-disc space-y-1 pl-4">{report.limits.map((s,i)=><li key={i}>{s}</li>)}</ul></div><details><summary className="cursor-pointer text-stone-500">查看自动转录 / 提供的逐字稿</summary><p className="mt-3 whitespace-pre-wrap">{job.transcript}</p></details></div>}
    </Section>}
  </>;
}
