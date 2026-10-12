import Link from "next/link";
import { get } from "@/lib/db";
import type { User } from "@/lib/auth";
import { accounts } from "@/lib/queries";
import { accountReview, accountWeek, canReviewAccount, latestAccountJob, snapshotHash, workerOnline } from "@/lib/account-weekly";
import { validateAccountReport, type AiAccountReport } from "@/lib/account-review-report";
import { fmtNum } from "@/lib/rules";
import { generateAccountReviewForm, saveAccountReviewForm } from "@/app/(main)/weekly/account-actions";
import { ActionForm } from "./action-form";
import { AccountReviewForm } from "./account-review-form";
import { Section, Stat, Tag } from "./ui";
import { Submit } from "./submit";

export function AccountWeekly({ week, accountId, me }: { week: string; accountId?: number; me: User }) {
  const accs = accounts(), selected = accs.find((a) => a.id === accountId) ?? accs.find((a) => a.editor_id === me.id) ?? accs[0];
  if (!selected) return <div className="card p-8 text-sm text-stone-500">先在设置中添加账号，即可按账号复盘。</div>;
  const snapshot = accountWeek(selected.id, week)!;
  const value = accountReview(selected.id, week), job = latestAccountJob(selected.id, week);
  const videoLabels = new Map<number, string>();
  let report: AiAccountReport | undefined;
  try { if (job?.status === "done" && job.report_json) {
    const input = JSON.parse(job.input_json);
    for (const group of [input.current, input.previous, input.performance, input.previous_performance]) for (const v of group.videos) videoLabels.set(v.id, v.code);
    const ids = new Set<number>([input.current, input.previous, input.performance, input.previous_performance].flatMap((p) => p.videos.map((v: { id: number }) => v.id)));
    report = validateAccountReport(JSON.parse(job.report_json), ids);
  } } catch { /* Retain manual review when a report cannot be read. */ }
  const canEdit = canReviewAccount(me, selected), online = workerOnline(), perf = snapshot.performance;
  const accountSummary = accs.map((a) => ({ account: a, saved: !!get("SELECT account_id FROM account_weekly WHERE account_id=? AND week=?", a.id, week) }));
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2" aria-label="选择复盘账号">{accountSummary.map(({ account, saved }) => <Link key={account.id} href={`/weekly?week=${week}&account=${account.id}`} className={`btn ${selected.id === account.id ? "btn-primary" : ""}`}>{account.name}<span className="text-xs opacity-70">{saved ? "已填" : "未填"}</span></Link>)}</div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="本周发布" value={`${snapshot.current.published} 条`} sub={`截至 ${(snapshot.as_of < snapshot.end ? snapshot.as_of : snapshot.end).slice(5)} · 上周 ${snapshot.previous.published} 条`} />
      <Stat label="双平台分发完成率" value={snapshot.current.published ? `${Math.round(snapshot.current.dual / snapshot.current.published * 100)}%` : "—"} sub="抖音 + 视频号" />
      <Stat label="成熟作品平均播放" value={fmtNum(perf.average_plays)} sub={`已满7天 · 完整 ${perf.complete} 条`} />
      <Stat label="当前已过审储备" value={`${snapshot.reserve} 条`} sub="按当前状态统计，可继续拍摄/剪辑/发布" />
    </div>
    <Section title="作品表现与数据完整度">
      <p className="mb-4 text-sm leading-relaxed text-stone-500">本周满 7 天的作品：{perf.start}—{perf.end} 发布。可统计播放 {perf.applicable} 条，数据完整 {perf.complete} 条，待补 {perf.missing} 条；已登记合计播放 {fmtNum(perf.plays)}，爆款 {perf.hits} 条。未到 7 天或未登记的数据保留为未知。</p>
      <div className="overflow-x-auto"><table className="tbl min-w-[680px]"><thead><tr><th>作品</th><th>发布</th><th>抖音7天</th><th>视频号7天</th><th>合计</th><th>状态</th></tr></thead><tbody>{perf.videos.map((v) => <tr key={v.id}><td className="min-w-48"><Link href={`/videos/${v.id}`} className="text-brand-700 hover:underline">{v.code} · {v.title}</Link></td><td className="whitespace-nowrap">{v.published_at}</td><td>{fmtNum(v.douyin_plays_d7)}</td><td>{fmtNum(v.wechat_plays_d7)}</td><td>{fmtNum(v.total_plays_d7)}</td><td><Tag tone={v.plays_complete ? "green" : v.plays_applicable ? "amber" : "gray"}>{v.plays_complete ? "完整" : v.plays_applicable ? "待补数据" : "仅其他平台"}</Tag></td></tr>)}{!perf.videos.length && <tr><td colSpan={6} className="text-stone-400">该周期暂无已满 7 天的作品</td></tr>}</tbody></table></div>
      <details className="mt-4 text-sm"><summary className="cursor-pointer text-stone-500">本周新发布的作品（{snapshot.current.published}）</summary><ul className="mt-3 space-y-2">{snapshot.current.videos.map((v) => <li key={v.id}><Link href={`/videos/${v.id}`} className="text-brand-700 hover:underline">{v.code} · {v.title}</Link><span className="ml-3 text-xs text-stone-500">{v.published_at} · {v.platforms.join(" / ") || "历史记录无平台链接"}</span></li>)}{!snapshot.current.published && <li className="text-stone-400">暂无</li>}</ul></details>
    </Section>
    <Section title={<span className="flex items-center gap-3">AI 账号复盘<Tag tone={online ? "green" : "gray"}>{online ? "可生成" : "服务待连接"}</Tag></span>}>
      {!online && <p className="mb-3 text-sm text-amber-700">生成服务离线，请保持运行 Codex 的办公电脑开机并联网，恢复后刷新此页。</p>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-stone-500">使用公司账号已有数据，生成发现、待验证原因和下周行动。采纳后由负责人确认保存。</p>{canEdit && <ActionForm action={generateAccountReviewForm}><input type="hidden" name="account_id" value={selected.id} /><input type="hidden" name="week" value={week} /><Submit done={null} disabled={!online || !!job && ["queued", "running"].includes(job.status)} className="btn btn-primary">{job?.status === "queued" ? "等待生成" : job?.status === "running" ? "正在分析…" : report ? "更新 AI 复盘" : "生成 AI 复盘"}</Submit></ActionForm>}</div>
      {job && ["queued", "running"].includes(job.status) && <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-700">已提交分析，请稍后<Link href={`/weekly?week=${week}&account=${selected.id}`} className="ml-1 underline">刷新查看结果</Link>。不会覆盖手动填写的内容。</p>}
      {job?.status === "failed" && <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{job.error || "生成失败，可重试或继续手动复盘"}</p>}
      {report ? <div className="space-y-4 text-sm"><p className="leading-relaxed">{report.overview}</p>{job!.input_hash !== snapshotHash(snapshot) && <p className="text-amber-700">报告生成后账号数据有变化，可重新生成；已有手动复盘仍保留。</p>}
        <div className="rounded-lg bg-stone-50 p-4"><h3 className="mb-2 font-medium">下周行动</h3><ul className="list-disc space-y-2 pl-4">{report.actions.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
        <details><summary className="cursor-pointer text-stone-500">查看数据发现、待验证原因与数据局限</summary><div className="mt-4 grid gap-5 md:grid-cols-2"><div><h3 className="mb-2 font-medium">数据发现</h3><ul className="space-y-2">{report.observations.map((o, i) => <li key={i}>{o.point}{o.video_ids.map((id) => <Link key={id} href={`/videos/${id}`} className="ml-2 text-xs text-brand-700 underline">{videoLabels.get(id) || `作品 ${id}`}</Link>)}</li>)}</ul></div>{[["待验证原因", report.hypotheses], ["数据局限", report.limits]].map(([label, items]) => <div key={label as string}><h3 className="mb-2 font-medium">{label as string}</h3><ul className="list-disc space-y-2 pl-4">{(items as string[]).map((item, i) => <li key={i}>{item}</li>)}</ul></div>)}</div></details>
        <p className="text-xs text-stone-400">生成时间 {job!.completed_at} · AI 建议，尚需负责人确认</p></div> : !job || job.status === "failed" ? <p className="text-sm text-stone-400">数字由系统汇总。AI 只根据现有数据提出建议，缺失的完播率、画像及同行数据会明确标注。</p> : null}
    </Section>
    <Section title={`${selected.name} · 负责人复盘`}>
      {canEdit ? <AccountReviewForm key={`${selected.id}:${week}:${value?.revision ?? 0}`} accountId={selected.id} week={week} value={value ? { ...value } : undefined} report={report} action={saveAccountReviewForm} /> : value ? <dl className="space-y-4 text-sm">{[["本周结论", value.summary], ["有效做法", value.successes], ["问题", value.issues], ["下周计划", value.next_plan]].map(([label, text]) => <div key={label}><dt className="font-medium text-stone-500">{label}</dt><dd className="mt-2 whitespace-pre-wrap">{text || "暂未填写"}</dd></div>)}</dl> : <p className="text-sm text-stone-400">该账号负责人暂未填写复盘</p>}
    </Section>
  </div>;
}
