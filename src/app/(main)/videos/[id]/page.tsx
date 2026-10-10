import Link from "next/link";
import { ArrowRight, Check, ChevronLeft } from "lucide-react";
import { Submit } from "@/components/submit";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { accounts, getVideo, people } from "@/lib/queries";
import {
  STAGES, addDays, combinedPlays, diffDays, fmtNum, getRules, isFrozen, isNewAccountAt, tierIndex, tierLabel, tierThresholds, today,
} from "@/lib/rules";
import { Field, PageHeader, Section, Tag } from "@/components/ui";
import { DueTag, VideoForm } from "@/components/video";
import { ReviewDecision } from "@/components/review";
import { advance, deleteVideo, publishVideo, saveMetrics, setStage, updateVideo } from "../actions";

const NEXT_ACTION: Record<string, string> = {
  选题: "开始写脚本",
  脚本: "提交脚本审核",
  拍摄: "拍完了，素材交剪辑",
  剪辑: "提交成片审核",
};
const NEXT_TIP: Record<string, string> = {
  选题: "点击后进入「脚本」阶段",
  脚本: "提交后自动发给轮值组长审核（组长自己的视频发给老板）",
  拍摄: "提交后剪辑会收到飞书通知",
  剪辑: "提交后编导会收到飞书通知来审成片",
};
const PLATFORM = { douyin: "抖音", wechat: "视频号", xhs: "小红书" } as const;

type Review = { id: number; node: string; status: string; reason: string | null; comment: string | null; recheck: string | null; submitted_at: string; done_at: string | null; reviewer_id: number; submitter: string; reviewer: string };
type Metric = { checkpoint: string; platform: keyof typeof PLATFORM; plays: number | null; likes: number | null; comments: number | null; collects: number | null; shares: number | null; fans: number | null; source: string; updated_at: string };

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const v = getVideo(Number((await params).id));
  if (!v) notFound();
  const canEdit = me.role === "boss" || me.id === v.editor_id || me.id === v.cutter_id;
  const reviews = all<Review>(`SELECT r.*, s.name submitter, u.name reviewer FROM reviews r LEFT JOIN users s ON s.id=r.submitter_id LEFT JOIN users u ON u.id=r.reviewer_id WHERE video_id=? ORDER BY r.id DESC`, v.id);
  const pending = reviews.find((r) => r.status === "待审");
  const log = all<{ from_stage: string; to_stage: string; at: string; name: string }>(`SELECT l.*, u.name FROM stage_log l LEFT JOIN users u ON u.id=l.user_id WHERE video_id=? ORDER BY l.id DESC LIMIT 20`, v.id);
  const metrics = all<Metric>("SELECT * FROM metrics WHERE video_id=?", v.id);
  const m = (cp: string, p: string) => metrics.find((x) => x.checkpoint === cp && x.platform === p);
  const stageIdx = STAGES.indexOf(v.stage);

  return (
    <>
      <Link href="/board" className="mb-3 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"><ChevronLeft size={16} />生产看板</Link>
      <PageHeader
        title={v.title}
        desc={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">{v.code} · {v.account_name} · 编导 {v.editor_name} · 剪辑 {v.cutter_name ?? "待定"} <DueTag v={v} />{isFrozen(v) && <Tag tone="purple">已冻结：改需求不算剪辑拖期</Tag>}</span>}
      />

      <div className="card mb-4 p-5">
        {/* 进度条 */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <ol className="flex min-w-[640px] items-start">
            {STAGES.map((st, i) => (
              <li key={st} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                <div className="flex w-full items-center">
                  <span className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : i <= stageIdx ? "bg-emerald-400" : "bg-stone-200"}`} />
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium ${i < stageIdx ? "bg-emerald-500 text-white" : i === stageIdx ? "bg-brand-500 text-white ring-4 ring-brand-100" : "bg-stone-100 text-stone-400"}`}>
                    {i < stageIdx ? <Check size={14} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={`h-0.5 flex-1 ${i === STAGES.length - 1 ? "opacity-0" : i < stageIdx ? "bg-emerald-400" : "bg-stone-200"}`} />
                </div>
                <span className={`text-xs ${i === stageIdx ? "font-semibold text-brand-700" : i < stageIdx ? "text-stone-600" : "text-stone-400"}`}>{st}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* 下一步 */}
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-stone-50 p-4">
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">
              {v.stage === "已发布" ? "已发布，第 7 / 30 天在下方登记播放数据"
                : pending ? `等待 ${pending.reviewer} ${pending.node}`
                : NEXT_ACTION[v.stage] ? `下一步：${NEXT_ACTION[v.stage]}` : v.stage === "待发布" ? "下一步：发布后在下方登记链接" : v.stage}
            </div>
            <div className="mt-0.5 text-xs text-stone-500">
              {pending ? `${pending.submitted_at.slice(5, 16)} 提交，审核人会收到飞书通知` : NEXT_TIP[v.stage] ?? ""}
            </div>
          </div>
          {canEdit && NEXT_ACTION[v.stage] && (
            <form action={advance}><input type="hidden" name="id" value={v.id} /><Submit done={null} className="btn btn-primary">{NEXT_ACTION[v.stage]}<ArrowRight size={15} /></Submit></form>
          )}
        </div>

        {pending && (me.id === pending.reviewer_id || me.role === "boss") && (
          <div className="mt-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
            <div className="mb-2.5 text-sm font-medium text-amber-900">{pending.node}：轮到你审了。打回请选原因归类并写清修改意见。</div>
            <ReviewDecision reviewId={pending.id} />
          </div>
        )}

        {(me.role === "boss" || me.id === v.editor_id) && (
          <details className="mt-3 text-xs text-stone-500">
            <summary className="cursor-pointer select-none hover:text-stone-700">点错了？手动调整阶段</summary>
            <form key={v.stage} action={setStage} className="mt-2 flex items-center gap-2">
              <input type="hidden" name="id" value={v.id} />
              <select name="stage" defaultValue={v.stage} className="input h-8 w-auto text-xs">{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
              <Submit done={null} className="btn btn-sm">调整</Submit>
              <span>待审的审核会自动撤回</span>
            </form>
          </details>
        )}
      </div>

      {v.stage === "待发布" && canEdit && (
        <Section title="登记发布" className="mb-4">
          <form action={publishVideo} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="id" value={v.id} />
            <Field label="实际发布日期"><input type="date" name="published_at" defaultValue={v.publish_date ?? today()} className="input" /></Field>
            <Field label="抖音链接"><input name="douyin_url" defaultValue={v.douyin_url ?? ""} className="input" placeholder="分享链接" /></Field>
            <Field label="视频号链接"><input name="wechat_url" defaultValue={v.wechat_url ?? ""} className="input" placeholder="https://weixin.qq.com/sph/…" /></Field>
            <Field label="小红书链接"><input name="xhs_url" defaultValue={v.xhs_url ?? ""} className="input" /></Field>
            <div className="flex items-end"><Submit done={null} className="btn btn-primary w-full">确认已发布</Submit></div>
          </form>
        </Section>
      )}

      {v.published_at && <MetricsSection v={v} m={m} canEdit={canEdit} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="需求单" className="lg:col-span-2">
          {canEdit ? (
            <form action={updateVideo}>
              <VideoForm v={v} accounts={accounts()} editors={people("editor")} cutters={people("cutter")} />
              <div className="mt-4 flex justify-between">
                {me.role === "boss" ? <Submit formAction={deleteVideo} className="btn btn-danger" done={null}>删除</Submit> : <span />}
                <Submit className="btn btn-primary">保存</Submit>
              </div>
            </form>
          ) : (
            <p className="whitespace-pre-wrap text-sm">{v.brief || "（无需求说明）"}</p>
          )}
        </Section>
        <div className="space-y-4">
          <Section title={`审核记录（${reviews.length}）`}>
            {reviews.length === 0 ? <p className="text-sm text-stone-400">暂无</p> : (
              <ul className="space-y-3 text-sm">
                {reviews.map((r) => (
                  <li key={r.id} className="border-l-2 border-stone-200 pl-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{r.node}</span>
                      <Tag tone={r.status === "通过" ? "green" : r.status === "打回" ? "red" : r.status === "待审" ? "amber" : "gray"}>{r.status}</Tag>
                    </div>
                    {r.reason && <div className="text-red-600">{r.reason}</div>}
                    {r.comment && <div className="text-stone-600">{r.comment}</div>}
                    <div className="text-xs text-stone-400">{r.submitter} 提交 {r.submitted_at.slice(5, 16)} · {r.reviewer} {r.done_at ? `审于 ${r.done_at.slice(5, 16)}` : ""}{r.recheck ? ` · 复审：${r.recheck}` : ""}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="流转记录">
            <ul className="space-y-1 text-xs text-stone-500">
              {log.map((l, i) => <li key={i}>{l.at.slice(5, 16)} {l.name}：{l.from_stage} → {l.to_stage}</li>)}
              {log.length === 0 && <li>暂无</li>}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}

function MetricsSection({ v, m, canEdit }: { v: NonNullable<ReturnType<typeof getVideo>>; m: (cp: string, p: string) => Metric | undefined; canEdit: boolean }) {
  const r = getRules();
  const isNew = isNewAccountAt(v.account_new_since, v.published_at!, r);
  const age = diffDays(today(), v.published_at!);
  const live = (["douyin", "wechat", "xhs"] as const).map((p) => ({ p, x: m("live", p) })).filter((o) => o.x);
  return (
    <Section title={`播放数据 · 发布第 ${age} 天`} className="mb-4"
      actions={<span className="text-xs text-stone-400">{isNew ? "新号折扣档" : "老号档"}：{tierThresholds(isNew, r).map(fmtNum).join(" / ")}</span>}>
      <div className="grid gap-4 md:grid-cols-2">
        {(["d7", "d30"] as const).map((cp) => {
          const due = addDays(v.published_at!, cp === "d7" ? 7 : 30);
          const c = combinedPlays(v.id, cp);
          const idx = c.complete ? tierIndex(c.total, isNew, r) : -1;
          return (
            <form key={cp} action={saveMetrics} className="rounded-lg bg-stone-50 p-3">
              <input type="hidden" name="id" value={v.id} /><input type="hidden" name="checkpoint" value={cp} />
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{cp === "d7" ? "第7天（定档）" : "第30天（看升档）"} <span className="text-xs font-normal text-stone-400">{due}</span></span>
                {c.complete ? <Tag tone={idx >= 0 ? "green" : "gray"}>合计 {fmtNum(c.total)} · {tierLabel(idx, isNew, r)}</Tag> : <Tag tone={age >= (cp === "d7" ? 7 : 30) ? "amber" : "gray"}>{age >= (cp === "d7" ? 7 : 30) ? "待登记" : "未到时间"}</Tag>}
              </div>
              <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-xs">
                <span /><span className="text-stone-500">播放</span><span className="text-stone-500">涨粉</span>
                {(["douyin", "wechat"] as const).map((p) => (
                  <Row key={p} label={PLATFORM[p]} p={p} x={m(cp, p)} disabled={!canEdit} />
                ))}
              </div>
              {cp === "d7" && (
                <div className="mt-2 grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-xs">
                  <span className="w-12 text-stone-600">小红书</span>
                  <input name="xhs_likes" placeholder="赞" defaultValue={m(cp, "xhs")?.likes ?? ""} className="input h-8" disabled={!canEdit} />
                  <input name="xhs_collects" placeholder="藏" defaultValue={m(cp, "xhs")?.collects ?? ""} className="input h-8" disabled={!canEdit} />
                </div>
              )}
              {canEdit && <div className="mt-2 flex justify-end"><Submit className="btn btn-sm btn-primary">保存{cp === "d7" ? "并定档" : "并算补差"}</Submit></div>}
            </form>
          );
        })}
      </div>
      {live.length > 0 && (
        <div className="mt-3 text-xs text-stone-500">
          实时互动（TikHub 自动抓取）：
          {live.map(({ p, x }) => <span key={p} className="ml-3">{PLATFORM[p]} 赞{fmtNum(x!.likes)} 评{fmtNum(x!.comments)} 藏{fmtNum(x!.collects)} 转{fmtNum(x!.shares)}</span>)}
          <span className="ml-3 text-stone-400">更新于 {live[0].x!.updated_at.slice(5, 16)}</span>
        </div>
      )}
    </Section>
  );
}

function Row({ label, p, x, disabled }: { label: string; p: string; x?: Metric; disabled: boolean }) {
  return (
    <>
      <span className="w-12 text-stone-600">{label}</span>
      <input name={`${p}_plays`} inputMode="numeric" defaultValue={x?.plays ?? ""} className="input h-8" disabled={disabled} />
      <input name={`${p}_fans`} inputMode="numeric" defaultValue={x?.fans ?? ""} className="input h-8" disabled={disabled} />
    </>
  );
}
