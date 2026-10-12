import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { ArrowRight, Check, ChevronLeft } from "lucide-react";
import { Submit } from "@/components/submit";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { checkpointSnapshot, playHistory } from "@/lib/metric-snapshots";
import { accounts, getVideo, people } from "@/lib/queries";
import {
  STAGES, addDays, combinedPlays, diffDays, fmtNum, getRules, isFrozen, isNewAccountAt, tierIndex, tierLabel, tierThresholds, today, needsMetrics, bonusPlatforms,
} from "@/lib/rules";
import { Field, PageHeader, Section, Tag } from "@/components/ui";
import { canAdvanceVideo, canManageVideo } from "@/lib/permissions";
import { DemandBrief, DueTag, VideoForm } from "@/components/video";
import { ReviewDecision } from "@/components/review";
import { PublicationForm } from "@/components/publication-form";
import { advanceForm as advance, deleteVideoForm as deleteVideo, publishVideoForm as publishVideo, saveMetricsForm as saveMetrics, setStageForm as setStage, updateVideoForm as updateVideo, requestWorkloadForm as requestWorkload, decideWorkloadForm as decideWorkload } from "../actions";

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
  const canEdit = canManageVideo(me, v);
  const isCutter = !v.archived_at && me.role === "cutter" && me.id === v.cutter_id;
  const requests = all<{ id: number; status: string; cut_level: string; extra_units: number; due_rough: string | null; reason: string; comment: string | null; created_at: string }>("SELECT * FROM workload_requests WHERE video_id=? ORDER BY id DESC", v.id);
  const audits = all<{ action: string; name: string; reason: string | null; created_at: string; before_json: string | null; after_json: string | null }>("SELECT l.*,u.name FROM audit_log l LEFT JOIN users u ON u.id=l.actor_id WHERE l.entity='video' AND l.entity_id=? ORDER BY l.id DESC LIMIT 30", v.id);
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

      {v.archived_at && <p className="mb-4 rounded-xl bg-stone-100 p-4 text-sm">此视频已归档（{v.archived_at}）。历史工作量、审核、数据和奖金仍保留。</p>}
      <div className="card mb-4 p-5">
        {/* 进度条 */}
        <div className="sm:hidden">
          <div className="flex items-center justify-between text-sm"><span>当前阶段：<strong className="text-brand-700">{v.stage}</strong></span><span className="text-xs text-stone-500">{stageIdx + 1} / {STAGES.length}</span></div>
          <div role="progressbar" aria-label="流程进度" aria-valuemin={1} aria-valuemax={STAGES.length} aria-valuenow={stageIdx + 1} aria-valuetext={v.stage} className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${((stageIdx + 1) / STAGES.length) * 100}%` }} /></div>
        </div>
        <div className="-mx-1 hidden overflow-x-auto px-1 pb-1 sm:block">
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
          {canAdvanceVideo(me, v) && NEXT_ACTION[v.stage] && (
            <ActionForm action={advance}><input type="hidden" name="id" value={v.id} /><input type="hidden" name="revision" value={v.revision} /><Submit done={null} className="btn btn-primary">{NEXT_ACTION[v.stage]}<ArrowRight size={15} /></Submit></ActionForm>
          )}
        </div>

        {!v.archived_at && pending && (me.id === pending.reviewer_id || me.role === "boss") && (
          <div className="mt-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-100">
            <div className="mb-2.5 text-sm font-medium text-amber-900">{pending.node}：轮到你审了。打回请选原因归类并写清修改意见。</div>
            <ReviewDecision reviewId={pending.id} />
          </div>
        )}

        {canEdit && !v.published_at && STAGES.indexOf(v.stage) > 0 && (
          <details className="mt-3 text-xs text-stone-500">
            <summary className="cursor-pointer select-none hover:text-stone-700">回退阶段（需填写原因）</summary>
            <ActionForm key={v.stage} action={setStage} className="mt-2 flex items-center gap-2">
              <input type="hidden" name="id" value={v.id} />
              <input type="hidden" name="revision" value={v.revision} />
              <select name="stage" defaultValue="" className="input h-8 w-auto text-xs"><option value="">选择回退阶段</option>{STAGES.filter((s, i) => i < stageIdx && ["选题", "脚本", "拍摄", "剪辑"].includes(s)).map((s) => <option key={s}>{s}</option>)}</select>
              <input name="reason" required placeholder="回退原因" className="input h-8" />
              <Submit done={null} className="btn btn-sm">回退</Submit>
              <span>待审的审核会自动撤回</span>
            </ActionForm>
          </details>
        )}
      </div>

      {v.stage === "待发布" && canEdit && (
        <Section title="登记发布" className="mb-5">
          <PublicationForm id={v.id} revision={v.revision} date={today()} links={{ douyin: v.douyin_url, wechat: v.wechat_url, xhs: v.xhs_url }} action={publishVideo} />
        </Section>
      )}

      {v.published_at && <MetricsSection v={v} m={m} canEdit={canEdit} />}

      {(isCutter || requests.length > 0) && <Section title="工作量调整" className="mb-4">
        {isCutter && !requests.some((r) => r.status === "pending") && <ActionForm action={requestWorkload} className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="id" value={v.id} />
          <Field label="申请定档"><select name="cut_level" defaultValue={v.cut_level} className="input">{[...new Set([...Object.keys(getRules().cut_levels), v.cut_level])].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="申请加件"><input type="number" name="extra_units" min="0" max="100" step="0.5" required defaultValue={v.extra_units} className="input" /></Field>
          <Field label="申请初剪截止"><input type="date" name="due_rough" defaultValue={v.due_rough ?? ""} className="input" /></Field>
          <Field label="调整原因"><input name="reason" required className="input" placeholder="说明新增工作或排期变化" /></Field>
          <Submit className="btn btn-primary">提交给编导确认</Submit>
        </ActionForm>}
        <div className="space-y-3">{requests.map((r) => <div key={r.id} className="mt-3 rounded-lg bg-stone-50 p-3 text-sm">
          <Tag tone={r.status === "pending" ? "amber" : r.status === "approved" ? "green" : "red"}>{r.status === "pending" ? "待确认" : r.status === "approved" ? "已确认" : "已拒绝"}</Tag>
          <span className="ml-2">{r.cut_level} · 加件 {r.extra_units} · 截止 {r.due_rough ?? "未设置"}</span>
          <p className="mt-1 text-stone-500">{r.reason}{r.comment ? ` · 确认意见：${r.comment}` : ""}</p>
          {canEdit && r.status === "pending" && <ActionForm action={decideWorkload} className="mt-2 flex gap-2"><input type="hidden" name="request_id" value={r.id} /><input name="comment" className="input" placeholder="确认意见（拒绝时必填）" /><Submit name="decision" value="approve" className="btn btn-primary">确认</Submit><Submit name="decision" value="reject" className="btn">拒绝</Submit></ActionForm>}
        </div>)}</div>
      </Section>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="需求单" className="lg:col-span-2">
          <div className="mb-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <p><span className="text-stone-500">编导</span><span className="ml-3 font-medium">{v.editor_name}</span></p>
            <p><span className="text-stone-500">剪辑</span><span className="ml-3 font-medium">{v.cutter_name ?? "待定"}</span></p>
            <p><span className="text-stone-500">工作量</span><span className="ml-3">{v.cut_level} · 加件 {v.extra_units}</span></p>
            <p><span className="text-stone-500">初剪截止</span><span className="ml-3">{v.due_rough ?? "未设置"}</span></p>
          </div>
          <div className="whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-4 text-sm leading-relaxed text-stone-700"><DemandBrief text={v.brief} /></div>
          {canEdit ? (
            <><details data-form-expand-on-error open={v.stage === "拍摄" && !v.cutter_id} className="mt-4 border-t border-stone-100 pt-4">
              <summary className="cursor-pointer text-sm font-medium text-brand-700">编辑需求 / 排期 / 负责人</summary>
              <ActionForm action={updateVideo} className="workflow-form mt-5">
              <VideoForm v={v} accounts={accounts()} editors={people("editor")} cutters={people("cutter")} />
              <p className="mt-3 text-xs text-stone-500">审核中修改标题或需求说明会撤回旧审核；待发布时修改核心需求，需要重新成片审核。</p>
              <div className="mt-4 flex justify-end">
                <Submit className="btn btn-primary">保存</Submit>
              </div>
              </ActionForm>
            </details>
            {me.role === "boss" && <details className="mt-4 border-t border-stone-100 pt-4"><summary className="cursor-pointer text-xs text-stone-500">归档管理</summary><ActionForm action={deleteVideo} className="mt-3"><input type="hidden" name="id" value={v.id} /><Submit className="btn btn-danger" done={null}>归档（保留记录）</Submit></ActionForm></details>}</>
          ) : isCutter ? <div>
            <ActionForm action={updateVideo} className="workflow-form mt-4"><input type="hidden" name="id" value={v.id} /><input type="hidden" name="revision" value={v.revision} /><Field label="剪辑备注"><input name="note" defaultValue={v.note ?? ""} className="input" /></Field><Submit className="btn mt-3">保存备注</Submit></ActionForm>
          </div> : null}
        </Section>
        <Section title="处理记录">
          <details className="border-b border-stone-100 pb-4" open={!!pending}>
            <summary className="cursor-pointer text-sm font-medium">审核记录（{reviews.length}）{reviews[0] && <span className="ml-2 font-normal text-stone-500">最近：{reviews[0].status}</span>}</summary>
            <div className="mt-4">
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
            </div>
          </details>
          <details className="border-b border-stone-100 py-4">
            <summary className="cursor-pointer text-sm font-medium">需求变更（{audits.length}）</summary>
            <div className="mt-4">
            <ul className="space-y-2 text-xs text-stone-500">{audits.map((a, i) => <li key={i}>{a.created_at.slice(5, 16)} {a.name}：{a.action}{a.reason ? ` · ${a.reason}` : ""}<details className="mt-1"><summary className="cursor-pointer">查看变更内容</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify({ 修改前: a.before_json ? JSON.parse(a.before_json) : null, 修改后: a.after_json ? JSON.parse(a.after_json) : null }, null, 2)}</pre></details></li>)}{!audits.length && <li>暂无</li>}</ul>
            </div>
          </details>
          <details className="pt-4">
            <summary className="cursor-pointer text-sm font-medium">阶段流转（{log.length}）</summary>
            <div className="mt-4">
            <ul className="space-y-1 text-xs text-stone-500">
              {log.map((l, i) => <li key={i}>{l.at.slice(5, 16)} {l.name}：{l.from_stage} → {l.to_stage}</li>)}
              {log.length === 0 && <li>暂无</li>}
            </ul>
            </div>
          </details>
        </Section>
      </div>
    </>
  );
}

function MetricsSection({ v, m, canEdit }: { v: NonNullable<ReturnType<typeof getVideo>>; m: (cp: string, p: string) => Metric | undefined; canEdit: boolean }) {
  const basis = v.bonus_snapshot ? JSON.parse(v.bonus_snapshot) : null;
  const r = basis?.rules ?? getRules();
  const isNew = isNewAccountAt(basis ? basis.new_since : v.account_new_since, v.published_at!, r);
  const age = diffDays(today(), v.published_at!);
  const live = (["douyin", "wechat", "xhs"] as const).map((p) => ({ p, x: m("live", p) })).filter((o) => o.x);
  const history = playHistory(v.id);
  return (
    <Section title={`播放数据 · 发布第 ${age} 天`} className="mb-4"
      actions={<span className="text-xs text-stone-400">{isNew ? "新号7折档" : "老号档"}：{tierThresholds(isNew, r).map(fmtNum).join(" / ")}</span>}>
      <div className="grid gap-4 md:grid-cols-2">
        {(["d7", "d30"] as const).filter((cp) => cp === "d7" || combinedPlays(v.id, cp, bonusPlatforms(basis)).applicable).map((cp) => {
          const due = addDays(v.published_at!, cp === "d7" ? 7 : 30);
          const c = combinedPlays(v.id, cp, bonusPlatforms(basis));
          const missing = needsMetrics(v.id, cp);
          const idx = c.complete ? tierIndex(c.total, isNew, r) : -1;
          const suggested = m(cp, "douyin")?.plays == null ? checkpointSnapshot(v.id, cp) : undefined;
          return (
            <ActionForm key={cp} action={saveMetrics} className="rounded-lg bg-stone-50 p-3">
              <input type="hidden" name="id" value={v.id} /><input type="hidden" name="checkpoint" value={cp} />
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium">{cp === "d7" ? "第7天（定档）" : "第30天（看升档）"} <span className="text-xs font-normal text-stone-400">{due}</span></span>
                {c.complete ? <Tag tone={idx >= 0 ? "green" : "gray"}>合计 {fmtNum(c.total)} · {tierLabel(idx, isNew, r)}</Tag> : <Tag tone={missing && age >= (cp === "d7" ? 7 : 30) ? "amber" : "gray"}>{!missing ? "已登记赞藏" : age >= (cp === "d7" ? 7 : 30) ? "待登记" : "未到时间"}</Tag>}
              </div>
              <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-xs">
                <span /><span className="text-stone-500">播放</span><span className="text-stone-500">涨粉</span>
                {c.platforms.map((p) => (
                  <Row key={p} label={PLATFORM[p]} p={p} x={m(cp, p)} suggested={p === "douyin" ? suggested?.plays : undefined} disabled={!canEdit || age < (cp === "d7" ? 7 : 30)} />
                ))}
              </div>
              {suggested && <p className="mt-2 text-xs text-brand-700">已预填抖音播放量 {fmtNum(suggested.plays)}，采集于 {suggested.collected_at}。请核对后保存，才会计入复盘与定档。</p>}
              {cp === "d7" && (v.xhs_url || m(cp, "xhs")) && (
                <div className="mt-2 grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-xs">
                  <span className="w-12 text-stone-600">小红书</span>
                  <input name="xhs_likes" placeholder="赞" defaultValue={m(cp, "xhs")?.likes ?? ""} className="input h-8" disabled={!canEdit || age < (cp === "d7" ? 7 : 30)} />
                  <input name="xhs_collects" placeholder="藏" defaultValue={m(cp, "xhs")?.collects ?? ""} className="input h-8" disabled={!canEdit || age < (cp === "d7" ? 7 : 30)} />
                </div>
              )}
              {!c.applicable && <p className="mt-2 text-xs text-stone-500">仅发布小红书，登记赞藏数据；抖音与视频号爆款奖不适用。</p>}
              {c.platforms.length === 1 && <p className="mt-2 text-xs text-stone-500">按已发布平台统计，未发布的平台无需填写。</p>}
              {canEdit && age >= (cp === "d7" ? 7 : 30) && <div className="mt-2 flex justify-end"><Submit className="btn btn-sm btn-primary">{suggested ? "确认" : "保存"}{!c.applicable ? "赞藏" : cp === "d7" ? "并定档" : "并算补差"}</Submit></div>}
            </ActionForm>
          );
        })}
      </div>
      {live.length > 0 && (
        <div className="mt-3 text-xs text-stone-500">
          最新数据（TikHub 每日采集）：
          {live.map(({ p, x }) => <span key={p} className="ml-3">{PLATFORM[p]} {p === "douyin" && x!.plays != null && <>播放{fmtNum(x!.plays)} · </>}赞{fmtNum(x!.likes)} 评{fmtNum(x!.comments)} 藏{fmtNum(x!.collects)} 转{fmtNum(x!.shares)}</span>)}
          <span className="ml-3 text-stone-400">更新于 {live[0].x!.updated_at.slice(5, 16)}</span>
        </div>
      )}
      {history.length > 0 && <details className="mt-4 rounded-lg border border-stone-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">抖音播放量每日记录（{history.length}天）</summary>
        <p className="mt-2 text-xs text-stone-500">每条记录为采集时的累计播放量；第7、30天以当天记录核对，历史缺失不自动补填。</p>
        <div className="mt-3 overflow-x-auto"><table className="tbl min-w-[420px]"><thead><tr><th>采集时间</th><th className="text-right">累计播放</th><th className="text-right">较前次记录增加</th></tr></thead>
          <tbody>{history.map((x, i) => { const previous = history[i + 1]; const delta = previous?.plays != null && x.plays != null ? x.plays - previous.plays : null;
            return <tr key={x.id}><td>{x.collected_at}</td><td className="text-right tabular-nums">{fmtNum(x.plays)}</td><td className="text-right tabular-nums">{delta == null ? "—" : delta >= 0 ? `+${fmtNum(delta)}` : fmtNum(delta)}</td></tr>;
          })}</tbody></table></div>
      </details>}
    </Section>
  );
}

function Row({ label, p, x, suggested, disabled }: { label: string; p: string; x?: Metric; suggested?: number | null; disabled: boolean }) {
  return (
    <>
      <span className="w-12 text-stone-600">{label}</span>
      <input name={`${p}_plays`} inputMode="numeric" defaultValue={x?.plays ?? suggested ?? ""} className="input h-8" disabled={disabled} />
      <input name={`${p}_fans`} inputMode="numeric" defaultValue={x?.fans ?? ""} className="input h-8" disabled={disabled} />
    </>
  );
}
